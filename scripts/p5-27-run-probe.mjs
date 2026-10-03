import { appendFile, readFile, writeFile } from "node:fs/promises";

const output = process.argv[2];
const tailOutput = process.argv[3];
const expectedVersion = process.argv[4];
if (!output || !tailOutput || !expectedVersion) throw new Error("New output path, numeric tail path and expected deployed version are required");
const origin = "http://127.0.0.1:8797";
const tailBefore = (await readFile(tailOutput, "utf8")).length;
const readyResponse = await fetch(`${origin}/ready`, { method: "POST", body: "{}" });
const ready = await readyResponse.json();
if (!readyResponse.ok || ready.code !== "P5_27_READY" || ready.sermons !== 201 || ready.heads !== 0) {
  throw new Error("Probe is not ready with exactly 201 empty synthetic sermons");
}
// A live tail is a precondition, not an assumption. The old positional name plus
// --env combination targeted a doubled '-preview' name and lost all CPU samples.
// Verify this read-only readiness request on the exact version before any write.
let readyTail;
const deadline = Date.now() + 15_000;
while (!readyTail && Date.now() < deadline) {
  const appended = (await readFile(tailOutput, "utf8")).slice(tailBefore);
  const completeLines = appended.slice(0, appended.lastIndexOf("\n") + 1).split("\n").filter(Boolean);
  readyTail = completeLines.map(line => JSON.parse(line)).find(row => row.version === expectedVersion &&
    row.path === "/__p5-27/ready" && row.outcome === "ok" && row.status === 200 &&
    Number.isFinite(row.cpuMs) && row.cpuMs >= 0 && row.truncated === false && row.exceptionCount === 0);
  if (!readyTail) await new Promise(resolve => setTimeout(resolve, 100));
}
if (!readyTail) throw new Error("No complete CPU readiness sample for the expected version; storage trial not started");
await writeFile(output, `${JSON.stringify({ event: "start", at: Date.now(), ready, readyTail })}\n`, { flag: "wx" });

async function invoke(profile, index) {
  let record;
  try {
    const response = await fetch(`${origin}/leaf?profile=${profile}&index=${index}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile, index }), signal: AbortSignal.timeout(60000),
    });
    const raw = await response.text();
    let result;
    try { result = JSON.parse(raw); } catch { result = { code: "NON_JSON_RESPONSE" }; }
    record = { profile, index, status: response.status, result };
  } catch {
    record = { profile, index, status: 0, result: { code: "TRANSPORT_FAILED_NO_RETRY" } };
  }
  await appendFile(output, `${JSON.stringify(record)}\n`);
  return record;
}

function summary(profile, records) {
  return {
    profile, count: records.length,
    updated: records.filter(r => r.result.outcome === "updated").length,
    failed: records.filter(r => r.result.outcome === "failed").length,
    transportOrProbeFailed: records.filter(r => !r.result.outcome).length,
    maxQueries: Math.max(0, ...records.map(r => r.result.queries ?? 0)),
  };
}

for (const profile of ["typical", "boundary"]) {
  const records = [];
  for (let index = 0; index < 100; index++) records.push(await invoke(profile, index));
  console.log(JSON.stringify(summary(profile, records)));
}
const concurrent = await Promise.all(Array.from({ length: 20 }, (_, index) => invoke("concurrent", index)));
console.log(JSON.stringify(summary("concurrent", concurrent)));
await appendFile(output, `${JSON.stringify({ event: "end", at: Date.now() })}\n`);
