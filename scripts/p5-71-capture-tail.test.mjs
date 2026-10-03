import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeTail } from "./p5-71-capture-tail.mjs";
const script = "biblequiz-content-preview", version = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
test("tail capture discards bodies, credentials, private logs and mismatched deployments", () => {
  const event = { scriptName: script, scriptVersion: { id: version }, eventTimestamp: 123, cpuTime: 4.5, wallTime: 800,
    outcome: "ok", truncated: false, exceptions: [], event: { request: { headers: { Cookie: "PRIVATE" }, body: "PRIVATE" } },
    logs: [{ message: ["PRIVATE", JSON.stringify({ code: "P571_MEASUREMENT", d1Calls: 12, paidCalls: 0, sql: "PRIVATE", body: "PRIVATE" }),
      JSON.stringify({ code: "P571_MEASUREMENT_UNIT", unit: "task-summary", d1Calls: 49, sql: "PRIVATE" }),
      JSON.stringify({ code: "P571_MEASUREMENT_UNIT", unit: "PRIVATE", d1Calls: 49 })] }] };
  const safe = sanitizeTail(event, script, version);
  assert.equal(safe.invocationCpuMs, 4.5);
  assert.equal(safe.completeCpuSample, true);
  assert.equal(safe.measurements[0].d1Calls, 12);
  assert.equal(safe.measurements.length, 2);
  assert.equal(safe.measurements[1].unit, "task-summary");
  assert.equal(safe.measurements[1].d1Calls, 49);
  assert.ok(!JSON.stringify(safe).includes("PRIVATE"));
  assert.equal(sanitizeTail(event, "biblequiz-app-preview", version), null);
  assert.equal(sanitizeTail(event, script, "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"), null);
});
test("missing CPU, truncation and errors are not complete samples or a zero CPU measurement", () => {
  const event = { scriptName: script, scriptVersion: { id: version }, outcome: "exceededCpu", truncated: false, exceptions: [] };
  assert.equal(sanitizeTail(event, script, version).invocationCpuMs, null);
  assert.equal(sanitizeTail(event, script, version).completeCpuSample, false);
  assert.equal(sanitizeTail({ ...event, cpuTime: 5, truncated: true }, script, version).completeCpuSample, false);
  assert.equal(sanitizeTail({ ...event, cpuTime: 5, exceptions: [{ message: "PRIVATE" }] }, script, version).completeCpuSample, false);
  assert.throws(() => sanitizeTail(event, "biblequiz-content", version));
});
