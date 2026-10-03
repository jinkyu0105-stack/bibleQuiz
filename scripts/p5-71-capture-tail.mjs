// Retain numeric native metrics only; never persist raw tail events or request/log content.
import { appendFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const scripts = ["biblequiz-app-preview", "biblequiz-content-preview"];
const unitName = /^(receive|input-stage|transcript-wait|input-resume|input-confirm|intent-wait|content-review|task-correction|(?:stage|task)-(?:intent_analysis|intent_critique|summary|child_candidates|adult_candidates))$/u;
const numeric = value => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
export function sanitizeTail(event, scriptName, version) {
  if (!scripts.includes(scriptName) || !uuid.test(version)) throw new Error("Exact Preview script and version required");
  if (event?.scriptName !== scriptName || event.scriptVersion?.id !== version) return null;
  const outcome = ["ok", "exception", "exceededCpu", "exceededMemory", "exceededResources", "canceled"].includes(event.outcome) ? event.outcome : "unknown";
  const cpuMs = numeric(event.cpuTime), wallMs = numeric(event.wallTime);
  const measurements = [];
  for (const log of event.logs ?? []) for (const message of log.message ?? []) {
    if (typeof message !== "string") continue;
    let data;
    try { data = JSON.parse(message); } catch { continue; }
    if (data?.code !== "P571_MEASUREMENT" && !(data?.code === "P571_MEASUREMENT_UNIT" && typeof data.unit === "string" && unitName.test(data.unit))) continue;
    measurements.push({ ...(data.code === "P571_MEASUREMENT_UNIT" ? { unit: data.unit } : {}),
      ...Object.fromEntries(["preflightD1Calls", "d1Calls", "sqlStatements", "largestBatch", "blockedCalls",
      "syntheticResponses", "requestBytes", "responseBytes", "paidCalls"].map(key => [key, numeric(data[key])])) });
  }
  return { at: numeric(event.eventTimestamp), scriptName, version, outcome, invocationCpuMs: cpuMs, wallMs,
    truncated: event.truncated === true, exceptionCount: Array.isArray(event.exceptions) ? event.exceptions.length : null,
    completeCpuSample: outcome === "ok" && cpuMs !== null && event.truncated === false && Array.isArray(event.exceptions) && event.exceptions.length === 0,
    measurements };
}
async function main() {
  const [output, scriptName, version] = process.argv.slice(2);
  if (!output) throw new Error("New output path required");
  sanitizeTail({}, scriptName, version);
  writeFileSync(output, "", { flag: "wx", mode: 0o600 });
  let buffer = "", depth = 0, quoted = false, escaped = false;
  for await (const chunk of process.stdin) for (const char of chunk.toString()) {
    if (depth === 0 && char !== "{") continue;
    buffer += char;
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "{") depth++;
    else if (char === "}") depth--;
    if (depth !== 0) continue;
    let event;
    try { event = JSON.parse(buffer); } catch { throw new Error("Malformed tail event; raw content suppressed"); }
    const record = sanitizeTail(event, scriptName, version);
    buffer = "";
    if (record) appendFileSync(output, JSON.stringify(record) + "\n");
  }
  if (buffer) throw new Error("Incomplete tail event; do not treat as a completed measurement");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
