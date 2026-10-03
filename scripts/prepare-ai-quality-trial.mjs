import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { createSessionDirectory } from "./local-ai-quality-session.mjs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

// Preparation only: no real source, API key, provider call or remote mode.
// Each invocation gets an empty DB. Never open the development .wrangler/state.
if (process.argv.length !== 2) throw new Error("NO_ARGUMENTS_ALLOWED");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const trial = await createSessionDirectory();
const configPath = path.join(trial, "wrangler.json");
const persistPath = path.join(trial, "state");
const cli = path.join(root, "node_modules/wrangler/wrangler-dist/cli.js");
const logPath = path.join(trial, "preparation.log");
const config = JSON.parse(await readFile(path.join(root, "wrangler.generation-local.jsonc"), "utf8"));
assert.equal(config.vars.AI_GENERATION_ENABLED, "false");
assert.equal(config.d1_databases.length, 1);
assert.equal(config.d1_databases[0].database_id, "00000000-0000-0000-0000-000000000001");
config.name = "biblequiz-ai-trial-local";
config.main = path.join(root, "workers/app/index.ts");
config.$schema = path.join(root, "node_modules/wrangler/config-schema.json");
config.d1_databases[0].migrations_dir = path.join(root, "migrations");
// Synthetic identifiers let unauthenticated requests return 401 without JWKS fetch.
config.vars = {
  AI_GENERATION_ENABLED: "false",
  DRAFT_CLEANUP_ENABLED: "false",
  ACCESS_TEAM_DOMAIN: "test-team.cloudflareaccess.com",
  ACCESS_AUD: "test-access-audience",
};
await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
await writeFile(path.join(trial, ".dev.vars"), "# Intentionally empty: preparation has no secrets.\n", { mode: 0o600 });
await writeFile(path.join(trial, ".env"), "", { mode: 0o600 });
await mkdir(persistPath, { mode: 0o700 });
const childEnv = {
  PATH: process.env.PATH,
  LANG: "C.UTF-8",
  CI: "true",
  WRANGLER_SEND_METRICS: "false",
  WRANGLER_LOG_PATH: path.join(trial, "wrangler.log"),
  CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
  CLOUDFLARE_INCLUDE_PROCESS_ENV: "false",
};
let log = "";
function start(args) {
  const child = spawn(process.execPath, [cli, "--config", configPath, ...args], {
    cwd: trial, env: childEnv, stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", chunk => { log += chunk; });
  child.stderr.on("data", chunk => { log += chunk; });
  return child;
}
function wait(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`LOCAL_COMMAND_FAILED:${signal ?? code}`)));
  });
}
const database = config.d1_databases[0].database_name;
let server;
try {
  await wait(start(["d1", "migrations", "apply", database, "--local", "--persist-to", persistPath]));
  // Reserve a currently free loopback port, without exposing the trial on the LAN.
  const reservation = createServer();
  await new Promise((resolve, reject) => { reservation.once("error", reject); reservation.listen(0, "127.0.0.1", resolve); });
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  server = start(["dev", "--local", "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", "0", "--persist-to", persistPath, "--log-level", "error"]);
  let spawnError;
  server.once("error", error => { spawnError = error; });
  const origin = `http://127.0.0.1:${port}`;
  let health;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (spawnError) throw spawnError;
    if (server.exitCode !== null) throw new Error("LOCAL_SERVER_EXITED");
    try { health = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) }); } catch { /* Wait for local boot. */ }
    if (health?.ok) break;
    await delay(250);
  }
  assert.equal(health?.status, 200, "LOCAL_HEALTH_FAILED");
  const dbHealth = await fetch(`${origin}/api/health/database`);
  assert.equal(dbHealth.status, 200, "LOCAL_DB_HEALTH_FAILED");
  const admin = await fetch(`${origin}/api/admin/sermon-drafts`);
  assert.equal(admin.status, 401, "ADMIN_MUST_REQUIRE_AUTHENTICATION");
  const generation = await fetch(`${origin}/api/admin/sermons/unregistered/generation/content`, {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: "{}",
  });
  assert.equal(generation.status, 401, "UNAUTHENTICATED_GENERATION_MUST_BE_BLOCKED");
  const report = { scope: "empty_local_preparation_only", checkedAt: new Date().toISOString(),
    trialPath: trial, configPath, persistPath, health: 200, databaseHealth: 200,
    unauthenticatedAdmin: 401, unauthenticatedGeneration: 401,
    aiEnabled: false, cleanupEnabled: false, apiKeyProvided: false,
    realSourceImported: false, realProviderCallsRequested: 0, remoteMode: false,
    liveTrialReady: false, remaining: ["source_and_permission", "human_reviewer", "local_authenticated_review_path", "paid_call_approval"],
  };
  await writeFile(path.join(trial, "preparation.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(JSON.stringify({ code: "LOCAL_PREPARATION_FAILED", trialPath: trial, error: error instanceof Error ? error.message : "unknown" }));
  process.exitCode = 1;
} finally {
  if (server && server.exitCode === null) {
    const ended = new Promise(resolve => server.once("exit", resolve));
    server.kill("SIGTERM");
    await Promise.race([ended, delay(5_000)]);
    if (server.exitCode === null) { server.kill("SIGKILL"); await ended; }
  }
  await writeFile(logPath, log, { mode: 0o600 });
  // Keep this empty rehearsal directory for inspection. It contains no real input.
}
