import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, readdir, chmod, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { startResponseArchive } from "./ai-quality-response-archive.mjs";

test("archives only authenticated loopback POSTs as private immutable files; no read route", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "biblequiz-synthetic-archive-"));
  const a = await startResponseArchive(dir), id = randomUUID();
  const body = JSON.stringify({ body: "synthetic private response", status: 200 });
  const send = (headers = {}, pathname = `/capture/${id}/response`) => fetch(a.origin + pathname, {
    method: "POST", body, headers: { Authorization: `Bearer ${a.token}`, ...headers },
  });
  try {
    assert.equal((await send({ Authorization: "Bearer wrong" })).status, 403);
    assert.equal((await send({ Origin: "https://untrusted.invalid" })).status, 403);
    assert.equal((await send({}, "/capture/../response")).status, 404);
    assert.deepEqual(await readdir(dir), []);
    assert.equal((await send()).status, 201);
    const file = path.join(dir, id + ".response.json");
    assert.equal(await readFile(file, "utf8"), body);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal((await send()).status, 409);
    assert.equal((await fetch(a.origin + `/capture/${id}/response`, { headers: { Authorization: `Bearer ${a.token}` } })).status, 404);
    assert.equal(await readFile(file, "utf8"), body);
  } finally { await a.close(); await rm(dir, { recursive: true }); }
});
test("refuses a directory readable by other users", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "biblequiz-synthetic-archive-"));
  try { await chmod(dir, 0o755); await assert.rejects(startResponseArchive(dir), /ARCHIVE_DIRECTORY_NOT_PRIVATE/); }
  finally { await rm(dir, { recursive: true }); }
});

test("offline CLI reads private files, reports unverified evidence without network or private text", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "biblequiz-synthetic-replay-"));
  try {
    const fields = ["centralMessage", "purpose", "bibleRelationship", "argumentFlow", "repeatedEmphasis", "illustrations", "audienceResponse", "warnings", "uncertainties"];
    const analysis = Object.fromEntries(fields.map(f => [f, []]));
    analysis.centralMessage = [{ id: "synthetic", text: "PRIVATE_SYNTHETIC", origin: "transcript", evidence: [{ segmentId: null, start: null, duration: null, from: 0, to: 4, quote: "TEXT" }] }];
    const req = path.join(dir, "request.json"), res = path.join(dir, "response.json");
    await writeFile(req, JSON.stringify({ body: JSON.stringify({ model: "gpt-5.6-terra", input: JSON.stringify({ transcript: { format: "plain_text", text: "TEXT" } }), text: { format: { name: "intent_analysis_v1" } } }) }), { mode: 0o600 });
    const cli = fileURLToPath(new URL("./replay-ai-quality-response.mjs", import.meta.url));
    for (const invalid of [false, true]) {
      if (invalid) analysis.centralMessage[0].evidence[0].quote = "SECRET_WRONG_QUOTE";
      await writeFile(res, JSON.stringify({ status: 200, body: JSON.stringify({ id: "synthetic", model: "gpt-5.6-terra", status: "completed", usage: { input_tokens: 100, output_tokens: 30 }, output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ draft: analysis }) }] }] }) }), { mode: 0o600 });
      const result = spawnSync(process.execPath, [cli, req, res], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).stage, "content_valid_only");
      assert.equal(JSON.parse(result.stdout).unverifiedEvidenceCount, invalid ? 1 : 0);
      assert.ok(!result.stdout.includes("PRIVATE_SYNTHETIC") && !result.stdout.includes("SECRET_WRONG_QUOTE"));
    }
  } finally { await rm(dir, { recursive: true }); }
});
