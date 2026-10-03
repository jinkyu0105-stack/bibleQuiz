import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdir, open, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export async function startResponseArchive(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const real = await realpath(directory);
  assert.equal((await stat(real)).mode & 0o077, 0, "ARCHIVE_DIRECTORY_NOT_PRIVATE");
  const token = randomBytes(32).toString("hex");
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    const finish = status => { response.writeHead(status); response.end(); };
    if (request.headers.authorization !== `Bearer ${token}` || request.headers.origin) return finish(403);
    const match = /^\/capture\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(request|response)$/u.exec(request.url ?? "");
    if (request.method !== "POST" || !match) return finish(404);
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const bytes = Buffer.concat(chunks), value = JSON.parse(bytes.toString("utf8"));
      assert.ok(value && typeof value.body === "string");
      assert.deepEqual(Object.keys(value).sort(), match[2] === "request" ? ["body"] : ["body", "status"]);
      if (match[2] === "response") assert.ok(Number.isInteger(value.status) && value.status >= 100 && value.status <= 599);
      const file = await open(path.join(real, `${match[1]}.${match[2]}.json`), "wx", 0o600);
      try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
      const dir = await open(real, "r");
      try { await dir.sync(); } finally { await dir.close(); }
      // Acknowledge only after bytes are flushed. Failed/partial files are never overwritten.
      finish(201);
    } catch { finish(409); }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, token, directory: real, close: () => new Promise(resolve => server.close(resolve)) };
}

if (process.argv[1] && await realpath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let archive;
  try {
    process.umask(0o077);
    const directory = process.argv[2];
    assert.ok(directory && path.isAbsolute(directory));
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const real = await realpath(directory);
    // Real trial artifacts must survive reboot and remain outside Git.
    for (const forbidden of [root, "/tmp", "/var/tmp"]) assert.ok(real !== forbidden && !real.startsWith(forbidden + path.sep));
    archive = await startResponseArchive(real);
    await writeFile(path.join(real, "client.json"), JSON.stringify({ origin: archive.origin, token: archive.token }), { mode: 0o600, flag: "wx" });
    const workflow = `import config from "./client.json";\nimport { createArchivedQualityWorkflow } from ${JSON.stringify(path.join(root, "scripts/quality-trial-response-archive.ts"))};\nexport const ContentWorkflow = createArchivedQualityWorkflow(config);\n`;
    await writeFile(path.join(real, "workflow.ts"), workflow, { mode: 0o600, flag: "wx" });
    console.log(JSON.stringify({ directory: real, listening: true, paidCalls: 0 }));
    const stop = () => { void archive.close(); };
    process.once("SIGINT", stop); process.once("SIGTERM", stop);
  } catch {
    if (archive) await archive.close();
    console.error("LOCAL_ARCHIVE_START_FAILED"); process.exitCode = 1;
  }
}
