// Local synthetic workerd only. Uses already-installed Wrangler transitive tools.
// Never loads Wrangler credentials/config, creates remote resources, or deploys.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const output = process.argv[2];
if (!output || !path.isAbsolute(output)) throw new Error("Absolute new output directory required");
await mkdir(output); // Fail rather than overwrite earlier evidence.
const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare, Log, LogLevel, convertV4MiniflareOptions } = wranglerRequire("miniflare");
const { build } = wranglerRequire("esbuild");
const { unstable_splitSqlQuery } = await import("wrangler");
const bundle = await build({ entryPoints: [path.join(root, "workers/app/p5-27-local-diagnostic.ts")],
  bundle: true, write: false, format: "esm", platform: "neutral", target: "es2023", sourcemap: "inline" });
const mf = new Miniflare(convertV4MiniflareOptions({ inspectorPort: 0, port: 0, host: "127.0.0.1", log: new Log(LogLevel.ERROR),
  workers: [{ name: "p527-local-diagnostic", modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-08-25", d1Databases: { DB: "p527-local-synthetic" },
    outboundService: () => new Response("Outbound disabled", { status: 403 }) }] }));
let socket;
const pending = new Map();
let serial = 0;
function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++serial;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15_000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

function summarize(profile) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const byFrame = new Map();
  for (const id of profile.samples ?? []) {
    const frame = nodes.get(id).callFrame;
    const key = JSON.stringify({ name: frame.functionName || "(anonymous)", url: frame.url,
      line: frame.lineNumber + 1 });
    byFrame.set(key, (byFrame.get(key) ?? 0) + 1);
  }
  return { samples: profile.samples?.length ?? 0,
    selfFrames: [...byFrame].map(([key, samples]) => ({ ...JSON.parse(key), samples }))
      .sort((a, b) => b.samples - a.samples) };
}

try {
  await mf.ready;
  const db = await mf.getD1Database("DB");
  for (const file of (await readdir(path.join(root, "migrations"))).filter((f) => /^\d{4}.*\.sql$/u.test(f)).sort()) {
    const sql = await readFile(path.join(root, "migrations", file), "utf8");
    for (const part of unstable_splitSqlQuery(sql)) await db.prepare(part).run();
  }
  await db.prepare(`INSERT INTO bible_translations
    (id,display_name,edition,publisher_or_rightsholder,mode,status,created_at,updated_at)
    VALUES ('p527-local','TEST_ONLY','TEST_ONLY','TEST_ONLY','reference_only','pending','2026-09-15','2026-09-15')`).run();
  async function seed(id) {
    await db.prepare(`INSERT INTO sermons
      (id,slug_suffix,church_name,youtube_url,youtube_video_id,sermon_title,sermon_date,bible_translation_id,
        bible_reference_json,bible_reference_label,created_at,updated_at)
      VALUES (?,?,'TEST_ONLY','https://example.invalid',?,'TEST_ONLY','2026-09-15','p527-local','[]','TEST_ONLY','2026-09-15','2026-09-15')`)
      .bind(id, id, id).run();
  }
  const inspector = await mf.getInspectorURL();
  inspector.protocol = "http:";
  const targets = await (await fetch(new URL("/json/list", inspector))).json();
  const target = targets.find((t) => t.title.includes("p527-local-diagnostic"));
  assert(target, "Worker inspector target missing");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true }); });
  socket.addEventListener("message", (event) => {
    const value = JSON.parse(event.data), waiter = pending.get(value.id);
    if (!waiter) return;
    pending.delete(value.id); clearTimeout(waiter.timeout);
    if (value.error) waiter.reject(new Error(JSON.stringify(value.error))); else waiter.resolve(value.result);
  });
  await cdp("Profiler.enable");
  await cdp("Profiler.setSamplingInterval", { interval: 1000 });
  const groups = [];
  async function invoke(mode, profile, index, sermonId) {
    const response = await mf.dispatchFetch(`https://p5-27-local.invalid/${mode}`, {
      method: "POST", body: JSON.stringify({ profile, index, sermonId }) });
    return { status: response.status, ...await response.json() };
  }
  async function group(mode, profile, count, existing = false) {
    const name = `${mode}-${profile}`;
    const ids = Array.from({ length: count }, (_, i) => mode === "baseline"
      ? `p527-${profile}-${String(i).padStart(3, "0")}` : `p527-${name}-${i}`);
    for (let i = 0; i < count; i++) {
      await seed(ids[i]);
      if (existing) assert.equal((await invoke("operation", profile, i, ids[i])).outcome, "updated");
    }
    const heapBefore = await cdp("Runtime.getHeapUsage");
    await cdp("Profiler.start");
    const results = [];
    for (let i = 0; i < count; i++) results.push(await invoke(mode, profile, i, ids[i]));
    const { profile: cpuProfile } = await cdp("Profiler.stop");
    const heapAfter = await cdp("Runtime.getHeapUsage");
    await writeFile(path.join(output, `${name}.cpuprofile`), JSON.stringify(cpuProfile), { flag: "wx" });
    const summary = { name, count, results, heapBefore, heapAfter, profile: summarize(cpuProfile) };
    groups.push(summary);
    console.log(JSON.stringify({ name, outcomes: results.map((r) => r.failureCode ?? r.outcome),
      topSelf: summary.profile.selfFrames.slice(0, 8) }));
    return summary;
  }
  await group("wrapper", "boundary", 30);
  await group("payload", "boundary", 30);
  await group("baseline", "typical", 10);
  await group("baseline", "boundary", 10);
  await group("operation", "typical", 10);
  await group("operation", "boundary", 10);
  await group("read", "boundary", 10, true);
  const races = await group("race", "boundary", 4);
  for (const r of races.results) {
    assert.equal(r.failureCode, "HISTORY_READ_CHANGED");
    assert.equal(r.phase, "read"); assert.equal(r.winner, "updated");
    assert.equal(r.spans.length, 2);
  }
  await seed("p527-local-concurrent");
  await cdp("Profiler.start");
  const concurrent = await Promise.all(Array.from({ length: 20 }, (_, i) =>
    invoke("operation", "concurrent", i, "p527-local-concurrent")));
  const { profile: concurrentProfile } = await cdp("Profiler.stop");
  await writeFile(path.join(output, "concurrent.cpuprofile"), JSON.stringify(concurrentProfile), { flag: "wx" });
  const tables = ["commits", "records", "payloads", "chunks", "references", "heads"];
  const counts = [];
  for (const table of tables) counts.push((await db.prepare(`SELECT count(*) AS n FROM sermon_history_${table} WHERE sermon_id=?`)
    .bind("p527-local-concurrent").first()).n);
  assert.equal(concurrent.filter((r) => r.outcome === "updated").length, 1);
  assert.deepEqual(counts, [1, 2, 2, 8, 1, 1]);
  assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results, []);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM sermon_history_commits WHERE state<>'sealed'").first()).n, 0);
  const report = { kind: "local-v8-sampling-not-remote-billing-or-peak", intervalUs: 1000,
    recordedAt: new Date().toISOString(), groups, concurrent: { results: concurrent, counts, profile: summarize(concurrentProfile) } };
  await writeFile(path.join(output, "summary.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ concurrent: concurrent.map((r) => r.failureCode ?? r.outcome), counts, output }));
} finally {
  if (socket) socket.close();
  for (const waiter of pending.values()) { clearTimeout(waiter.timeout); waiter.reject(new Error("Inspector closed")); }
  await mf.dispose(); // In-memory synthetic database, Worker and inspector are disposed together.
}
