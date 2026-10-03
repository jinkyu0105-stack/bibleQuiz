import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, open, readFile, realpath, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schema = "biblequiz-local-quality-session-v1";
const safeError = code => new Error(code);

// Keep trial data outside both Git and OS temporary-directory cleanup.
export const qualityStorageRoot = path.join(homedir(), ".local", "state", "biblequiz");
export async function createSessionDirectory(parent = qualityStorageRoot) {
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const info = await lstat(parent);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid() || (info.mode & 0o077)) {
    throw safeError("PRIVATE_DIRECTORY_REQUIRED");
  }
  const directory = await mkdtemp(path.join(parent, "quality-session-"));
  await chmod(directory, 0o700);
  return directory;
}

// Secrets are explicitly supplied private files, never inherited env or CLI values.
export async function readPrivateFile(file) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || (info.mode & 0o077) || info.uid !== process.getuid() || info.size > 1_048_576) {
      throw safeError("PRIVATE_FILE_REQUIRED");
    }
    return await handle.readFile("utf8");
  } finally { await handle.close(); }
}
export function validateSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw safeError("SETTINGS_INVALID");
  const allowed = new Set(["accessTeamDomain", "accessAudience", "paidExecutionApproved", "localPublicationApproved", "openAiKeyFile", "savedTranscriptFile"]);
  if (Object.keys(value).some(k => !allowed.has(k)) ||
      !/^[a-z0-9-]+\.cloudflareaccess\.com$/u.test(value.accessTeamDomain ?? "") ||
      typeof value.accessAudience !== "string" || !value.accessAudience.trim() || value.accessAudience.length > 256 ||
      (value.paidExecutionApproved !== undefined && typeof value.paidExecutionApproved !== "boolean") ||
      (value.localPublicationApproved !== undefined && typeof value.localPublicationApproved !== "boolean")) {
    throw safeError("SETTINGS_INVALID");
  }
  if (value.paidExecutionApproved === true) {
    if (typeof value.openAiKeyFile !== "string" || !path.isAbsolute(value.openAiKeyFile)) throw safeError("PAID_KEY_FILE_REQUIRED");
  } else if (value.openAiKeyFile !== undefined) throw safeError("PAID_EXECUTION_NOT_APPROVED");
  if (value.savedTranscriptFile !== undefined && (typeof value.savedTranscriptFile !== "string" || !path.isAbsolute(value.savedTranscriptFile))) throw safeError("SAVED_SOURCE_PATH_INVALID");
  return { ...value, paidExecutionApproved: value.paidExecutionApproved === true, localPublicationApproved: value.localPublicationApproved === true };
}
export function validateCommand(value, paidEnabled, localPublicationApproved = false) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some(k => !["method", "path", "body"].includes(k)) ||
      !["GET", "POST", "PATCH"].includes(value.method) || typeof value.path !== "string") throw safeError("COMMAND_INVALID");
  // No URL, query, traversal, public-caption refetch, cleanup or remote controls.
  // Local publication has its own explicit permission, independent of paid AI.
  const id = "[A-Za-z0-9_-]+";
  const read = new RegExp(`^/api/admin/(?:sermon-drafts(?:/${id})?|quiz-sets/${id}/ai-costs|sermons/${id}/(?:input|input/history|generation/(?:content|correction|${id})))$`, "u");
  const write = new RegExp(`^/api/admin/(?:sermon-drafts|quiz-sets/${id}/publish|sermons/${id}/(?:input(?:/saved-captions)?|generation/(?:content|correction|regenerate|${id}/(?:review|quality|resume|resume-stored|finish|placement-trial|placement-select))))$`, "u");
  const patch = new RegExp(`^/api/admin/sermon-drafts/${id}$`, "u");
  if (!(value.method === "GET" ? read : value.method === "PATCH" ? patch : write).test(value.path)) throw safeError("COMMAND_PATH_NOT_ALLOWED");
  if (/\/publish$/u.test(value.path) && localPublicationApproved !== true) throw safeError("LOCAL_PUBLICATION_NOT_APPROVED");
  if (value.method === "GET" && value.body !== undefined) throw safeError("COMMAND_INVALID");
  if (value.method !== "GET" && (value.body === undefined || typeof value.body !== "object" || value.body === null)) throw safeError("COMMAND_INVALID");
  if (!paidEnabled && value.method === "POST" && /\/generation\/(?:content|correction|regenerate|[^/]+\/resume)$/u.test(value.path)) {
    throw safeError("PAID_EXECUTION_NOT_APPROVED");
  }
  return value;
}
async function privateJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(file, 0o600);
}
export async function requestSession(directory, commandFile, tokenFile) {
  const session = JSON.parse(await readPrivateFile(path.join(directory, "session.json")));
  if (session.schema !== schema || session.running !== true ||
      !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/u.test(session.origin)) throw safeError("SESSION_NOT_RUNNING");
  const command = validateCommand(JSON.parse(await readPrivateFile(commandFile)), session.paidEnabled === true, session.localPublicationApproved === true);
  const token = (await readPrivateFile(tokenFile)).trim();
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(token) || token.length > 16_384) throw safeError("ACCESS_TOKEN_INVALID");
  // The unchanged Worker validates real Access issuer/audience/signature/expiry.
  const response = await fetch(`${session.origin}${command.path}`, {
    method: command.method, redirect: "error", signal: AbortSignal.timeout(60_000),
    headers: { "Cf-Access-Jwt-Assertion": token, Origin: session.origin, "Content-Type": "application/json" },
    ...(command.method === "GET" ? {} : { body: JSON.stringify(command.body) }),
  });
  const responsePath = path.join(directory, `response-${crypto.randomUUID()}.json`);
  await privateJson(responsePath, { status: response.status, receivedAt: new Date().toISOString(), data: await response.json() });
  // No automatic retry on 401, timeout or uncertain mutation; inspect state first.
  return { status: response.status, responsePath, retryPerformed: false };
}
export async function startSession(settingsFile, onReady = report => console.log(JSON.stringify(report))) {
  const settings = validateSettings(JSON.parse(await readPrivateFile(settingsFile)));
  let apiKey;
  if (settings.paidExecutionApproved) {
    apiKey = (await readPrivateFile(settings.openAiKeyFile)).trim();
    if (!apiKey || /[\r\n]/u.test(apiKey)) throw safeError("API_KEY_INVALID");
  }
  const directory = await createSessionDirectory();
  await chmod(directory, 0o700);
  const persistPath = path.join(directory, "state");
  await mkdir(persistPath, { mode: 0o700 });
  const config = JSON.parse(await readFile(path.join(root, "wrangler.generation-local.jsonc"), "utf8"));
  assert.equal(config.d1_databases.length, 1);
  assert.equal(config.d1_databases[0].database_id, "00000000-0000-0000-0000-000000000001");
  config.name = "biblequiz-quality-session-local";
  config.main = path.join(root, "workers/app/index.ts");
  config.$schema = path.join(root, "node_modules/wrangler/config-schema.json");
  config.d1_databases[0].migrations_dir = path.join(root, "migrations");
  let savedSourceSha256 = null;
  if (settings.savedTranscriptFile) {
    const saved = JSON.parse(await readPrivateFile(settings.savedTranscriptFile));
    const source = saved?.result?.transcript;
    if (saved?.result?.outcome !== "fetched" || !Array.isArray(source?.segments)) throw safeError("SAVED_SOURCE_INVALID");
    const segments = source.segments.map(({ text, start, duration }) => ({ text, start, duration }));
    savedSourceSha256 = createHash("sha256").update(JSON.stringify(segments)).digest("hex");
    if (savedSourceSha256 !== source.sourceSha256) throw safeError("SAVED_SOURCE_HASH_MISMATCH");
    await privateJson(path.join(directory, "saved-transcript.json"), saved);
    const entry = `import capture from "./saved-transcript.json";\nimport { createQualityTrialWorker } from ${JSON.stringify(path.join(root, "scripts/quality-trial-worker.ts"))};\nexport { ContentWorkflow } from ${JSON.stringify(path.join(root, "workers/content/index.ts"))};\nexport default createQualityTrialWorker(capture);\n`;
    config.main = path.join(directory, "entry.ts");
    await writeFile(config.main, entry, { mode: 0o600 });
  }
  config.vars = { ACCESS_TEAM_DOMAIN: settings.accessTeamDomain, ACCESS_AUD: settings.accessAudience,
    AI_GENERATION_ENABLED: String(settings.paidExecutionApproved), DRAFT_CLEANUP_ENABLED: "false" };
  await privateJson(path.join(directory, "wrangler.json"), config);
  await writeFile(path.join(directory, ".dev.vars"), apiKey ? `OPENAI_API_KEY=${JSON.stringify(apiKey)}\n` : "", { mode: 0o600 });
  await writeFile(path.join(directory, ".env"), "", { mode: 0o600 });
  const childEnv = { PATH: process.env.PATH, LANG: "C.UTF-8", CI: "true", WRANGLER_SEND_METRICS: "false",
    WRANGLER_LOG_PATH: path.join(directory, "wrangler.log"), CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false", CLOUDFLARE_INCLUDE_PROCESS_ENV: "false" };
  const cli = path.join(root, "node_modules/wrangler/wrangler-dist/cli.js");
  let server, report, stopping = false;
  const children = new Set();
  const start = args => {
    const child = spawn(process.execPath, [cli, "--config", path.join(directory, "wrangler.json"), ...args], {
      cwd: directory, env: childEnv, stdio: "ignore",
    });
    child.once("error", () => {});
    children.add(child); child.once("exit", () => children.delete(child));
    return child;
  };
  const stop = () => { stopping = true; for (const child of children) child.kill("SIGTERM"); };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    await new Promise((resolve, reject) => {
      const child = start(["d1", "migrations", "apply", config.d1_databases[0].database_name, "--local", "--persist-to", persistPath]);
      child.once("error", () => reject(safeError("LOCAL_MIGRATION_FAILED")));
      child.once("exit", code => code === 0 ? resolve() : reject(safeError("LOCAL_MIGRATION_FAILED")));
    });
    if (stopping) throw safeError("SESSION_STOPPED");
    const socket = createServer();
    await new Promise((resolve, reject) => { socket.once("error", reject); socket.listen(0, "127.0.0.1", resolve); });
    const port = socket.address().port;
    await new Promise(resolve => socket.close(resolve));
    const origin = `http://127.0.0.1:${port}`;
    server = start(["dev", "--local", "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", "0", "--persist-to", persistPath, "--log-level", "none"]);
    const exited = new Promise(resolve => { server.once("exit", resolve); server.once("error", () => resolve(-1)); });
    let ready = false;
    for (let attempt = 0; attempt < 120 && !stopping; attempt++) {
      if (server.exitCode !== null) break;
      try { ready = (await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(500) })).ok; } catch { /* Boot only; never retry a mutation. */ }
      if (ready) break;
      await delay(250);
    }
    if (!ready || stopping) throw safeError("LOCAL_BOOT_FAILED");
    const unauthorized = await fetch(`${origin}/api/admin/sermon-drafts`);
    assert.equal(unauthorized.status, 401, "ACCESS_BOUNDARY_FAILED");
    report = { schema, directory, origin, persistPath, running: true,
      paidEnabled: settings.paidExecutionApproved, localPublicationApproved: settings.localPublicationApproved, cleanupEnabled: false, realSourceImported: false,
      savedSourceSha256, authenticatedUserVerified: false, unauthenticatedAdmin: unauthorized.status, remoteMode: false };
    await privateJson(path.join(directory, "session.json"), report);
    await onReady(report);
    const code = await exited;
    if (!stopping && code !== 0) throw safeError("LOCAL_SERVER_EXITED");
    return { directory, stopped: true };
  } finally {
    stop();
    for (const child of [...children]) {
      await Promise.race([new Promise(resolve => child.once("exit", resolve)), delay(5_000)]);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
    await writeFile(path.join(directory, ".dev.vars"), "", { mode: 0o600 });
    if (report) await privateJson(path.join(directory, "session.json"), { ...report, running: false });
    process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop);
    // Retain this trial's state. Do not resume an interrupted paid Workflow automatically.
  }
}

if (process.argv[1] && await realpath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command === "start" && args.length === 1) await startSession(args[0]);
    else if (command === "request" && args.length === 3) console.log(JSON.stringify(await requestSession(...args)));
    else throw safeError("USAGE: start PRIVATE_SETTINGS_JSON | request SESSION_DIR PRIVATE_COMMAND_JSON PRIVATE_ACCESS_TOKEN_FILE");
  } catch {
    // Raw error causes may include private request data, paths or credentials.
    console.error("LOCAL_QUALITY_SESSION_FAILED: check private settings, command, authentication and local session state; no automatic retry.");
    process.exitCode = 1;
  }
}
