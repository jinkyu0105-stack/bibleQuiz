import assert from "node:assert/strict";
import { readFile, realpath, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  const [requestPath, responsePath] = process.argv.slice(2);
  assert.ok(requestPath && responsePath && process.argv.length === 4);
  const read = async filename => {
    assert.ok(path.isAbsolute(filename));
    assert.equal((await stat(filename)).mode & 0o077, 0, "ARCHIVE_NOT_PRIVATE");
    return JSON.parse(await readFile(filename, "utf8"));
  };
  const request = await read(requestPath), response = await read(responsePath);
  // Bundled build dependency only; no package installation or network lookup.
  const require = createRequire(await realpath(path.join(root, "node_modules/wrangler/package.json")));
  const { outputFiles } = await require("esbuild").build({ entryPoints: [path.join(root, "scripts/quality-trial-response-replay.ts")],
    bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent" });
  globalThis.fetch = async () => { throw new Error("OFFLINE_NETWORK_FORBIDDEN"); };
  const { replayArchivedIntent } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`);
  const result = await replayArchivedIntent(request, response);
  console.log(JSON.stringify(result));
  if (result.stage !== "content_valid_only") process.exitCode = 1;
} catch { console.error("OFFLINE_ARCHIVE_REPLAY_FAILED"); process.exitCode = 1; }
