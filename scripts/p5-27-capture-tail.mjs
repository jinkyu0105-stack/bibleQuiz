// Keep only numeric measurements and synthetic identifiers; discard request headers, cf and raw errors.
import { appendFileSync, writeFileSync } from "node:fs";
const output = process.argv[2];
if (!output) throw new Error("A new output path is required");
writeFileSync(output, "", { flag: "wx" });
let buffer = "";
let depth = 0;
let quoted = false;
let escaped = false;
for await (const chunk of process.stdin) {
  for (const char of chunk.toString()) {
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
    const event = JSON.parse(buffer);
    buffer = "";
    if (event.scriptName !== "biblequiz-app-preview") continue;
    const url = new URL(event.event?.request?.url ?? "https://unknown.invalid");
    const safe = {
      at: event.eventTimestamp, version: event.scriptVersion?.id,
      cpuMs: event.cpuTime ?? null, wallMs: event.wallTime ?? null,
      outcome: event.outcome, status: event.event?.response?.status ?? null,
      path: url.pathname, profile: url.searchParams.get("profile"),
      index: url.searchParams.get("index"), truncated: event.truncated,
      exceptionCount: event.exceptions?.length ?? 0,
    };
    appendFileSync(output, `${JSON.stringify(safe)}\n`);
    console.log(JSON.stringify(safe));
  }
}
