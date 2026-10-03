// D-032: local synthetic memory observations, never remote CPU or exact peak.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const output = process.argv[2];
const minify = process.argv[3] === "minified";
assert(process.argv[3] === undefined || minify, "Unsupported bundle variant");
assert(output && path.isAbsolute(output), "A new absolute output directory is required");
await mkdir(output);
const require = createRequire(import.meta.url);
const installed = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare, Log, LogLevel, convertV4MiniflareOptions } = installed("miniflare");
const { build } = installed("esbuild");
const { unstable_splitSqlQuery } = await import("wrangler");
const bundle = await build({
  stdin: { contents: `
import probe from './workers/app/p5-27-selected-probe';
const counters = { active: 0, maximumActive: 0, completed: 0 };
// Align the start of all 20 requests, without pausing inside storage or forcing GC.
let startReleased = false;
export default { async fetch(request, env, ctx) {
  counters.active++; counters.maximumActive = Math.max(counters.maximumActive, counters.active);
  if (counters.active === 20) startReleased = true;
  // Timers belong to their request; do not await another request's promise.
  while (!startReleased) await scheduler.wait(1);
  let response;
  try { response = await probe.fetch(request, env, ctx); }
  finally { counters.active--; counters.completed++; }
  const headers = new Headers(response.headers);
  headers.set('x-p527-local-counters', JSON.stringify(counters));
  return new Response(response.body, { status: response.status, headers });
} };`, resolveDir: root, sourcefile: "p527-local-memory-only.ts", loader: "ts" },
  bundle: true, minify, write: false, format: "esm", platform: "neutral", target: "es2023",
});
const script = bundle.outputFiles[0].text;
const migrations = [];
for (const file of (await readdir(path.join(root, "migrations"))).filter(f => /^\d{4}.*\.sql$/u.test(f)).sort()) {
  const sql = await readFile(path.join(root, "migrations", file), "utf8");
  migrations.push({ file, sha256: createHash("sha256").update(sql).digest("hex"), statements: unstable_splitSqlQuery(sql) });
}
const trials = [];
for (let round = 0; round < 3; round++) for (const profile of ["typical", "boundary", "concurrent"]) {
  const name = `p527-memory-${profile}-${round}`;
  const mf = new Miniflare(convertV4MiniflareOptions({
    inspectorPort: 0, port: 0, host: "127.0.0.1", log: new Log(LogLevel.ERROR),
    workers: [{ name, modules: true, script, compatibilityDate: "2026-08-25",
      d1Databases: { DB: "synthetic-only" },
      outboundService: () => new Response(null, { status: 403 }) }],
  }));
  let socket;
  const pending = new Map();
  let serial = 0;
  function cdp(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++serial;
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error("CDP_TIMEOUT")); }, 15_000);
      pending.set(id, { resolve, reject, timeout, method });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  try {
    await mf.ready;
    const db = await mf.getD1Database("DB");
    for (const migration of migrations) for (const sql of migration.statements) await db.prepare(sql).run();
    await db.prepare("INSERT INTO bible_translations (id,display_name,edition,publisher_or_rightsholder,mode,status,created_at,updated_at) VALUES ('memory','TEST_ONLY','TEST_ONLY','TEST_ONLY','reference_only','pending','2026-09-16','2026-09-16')").run();
    const ids = profile === "concurrent" ? ["p527-concurrent"] :
      Array.from({ length: 20 }, (_, i) => `p527-${profile}-${String(i).padStart(3, "0")}`);
    for (const id of ids) await db.prepare("INSERT INTO sermons (id,slug_suffix,church_name,youtube_url,youtube_video_id,sermon_title,sermon_date,bible_translation_id,bible_reference_json,bible_reference_label,created_at,updated_at) VALUES (?,?,'TEST_ONLY','https://example.invalid',?,'TEST_ONLY','2026-09-16','memory','[]','TEST_ONLY','2026-09-16','2026-09-16')").bind(id,id,id).run();
    const inspector = await mf.getInspectorURL(); inspector.protocol = "http:";
    const targets = await (await fetch(new URL("/json/list", inspector))).json();
    const target = targets.find(t => t.title.includes(name)); assert(target);
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("CDP_CONNECT_TIMEOUT")), 15_000);
      socket.addEventListener("open", () => { clearTimeout(timeout); resolve(); }, { once: true });
      socket.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("CDP_CONNECT_FAILED")); }, { once: true });
    });
    socket.addEventListener("message", e => {
      const v = JSON.parse(e.data), w = pending.get(v.id); if (!w) return;
      pending.delete(v.id); clearTimeout(w.timeout);
      if (v.error) w.reject(new Error(`CDP_COMMAND_FAILED:${w.method}:${v.error.code}`)); else w.resolve(v.result);
    });
    await cdp("Runtime.enable");
    const started = performance.now();
    const observations = [];
    async function observe(phase) {
      const heap = await cdp("Runtime.getHeapUsage");
      for (const key of ["usedSize", "totalSize", "embedderHeapUsedSize", "backingStorageSize"]) {
        assert(Number.isFinite(heap[key]) && heap[key] >= 0, `Missing heap field: ${key}`);
      }
      // Keep separate components; this conservative envelope is NOT process RSS
      // or a complete/instantaneous measurement of platform isolate memory.
      observations.push({ phase, elapsedMs: performance.now() - started, ...heap,
        conservativeEnvelopeBytes: heap.totalSize + heap.embedderHeapUsedSize + heap.backingStorageSize });
    }
    await observe("before");
    let running = true;
    const resultsPromise = Promise.all(Array.from({ length: 20 }, async (_, index) => {
      const response = await mf.dispatchFetch("https://p5-27.invalid/__p5-27/leaf", {
        method: "POST", headers: { "x-p5-27-internal": "p5-27-service-binding-only" },
        body: JSON.stringify({ profile, index }),
      });
      assert.equal(response.status, 200);
      return { ...await response.json(), localCounters: JSON.parse(response.headers.get("x-p527-local-counters")) };
    })).finally(() => { running = false; });
    // Observe both promises even if either fails; never leave rejection unhandled.
    const samplingPromise = (async () => {
      while (running) { await observe("during"); await new Promise(r => setTimeout(r, 1)); }
    })();
    const [resultState, samplingState] = await Promise.allSettled([resultsPromise, samplingPromise]);
    assert.equal(resultState.status, "fulfilled", "INVOCATIONS_FAILED");
    assert.equal(samplingState.status, "fulfilled", "SAMPLING_FAILED");
    const results = resultState.value;
    await observe("after");
    const counters = results.find(r => r.localCounters.completed === 20)?.localCounters;
    assert.deepEqual(counters, { active: 0, maximumActive: 20, completed: 20 });
    assert.equal(new Set(results.map(r => r.isolate)).size, 1);
    const expectedSuccess = profile === "concurrent" ? 1 : 20;
    assert.equal(results.filter(r => r.outcome === "updated").length, expectedSuccess);
    assert.equal(results.filter(r => r.failureCode === "INPUT_CONFLICT").length, 20 - expectedSuccess);
    for (const result of results) {
      assert(result.queries <= 40); assert.equal(result.replayCount, 0); assert.equal(result.operationReads, 0);
    }
    const counts = await db.prepare("SELECT (SELECT count(*) FROM sermon_input_events) AS events,(SELECT count(*) FROM sermon_input_chunks) AS chunks,(SELECT count(*) FROM sermon_input_heads) AS heads,(SELECT count(*) FROM sermon_input_events WHERE state != 'sealed') AS unsealed").first();
    // D-033: 30,000 Hangul code points now occupy two 16,384-code-unit chunks.
    assert.deepEqual(counts, { events: expectedSuccess, chunks: expectedSuccess * (profile === "typical" ? 1 : 2), heads: expectedSuccess, unsealed: 0 });
    assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results, []);
    assert.equal((await db.prepare("PRAGMA quick_check").first()).quick_check, "ok");
    assert(observations.some(o => o.phase === "during"));
    const maxima = Object.fromEntries(["usedSize", "totalSize", "embedderHeapUsedSize", "backingStorageSize", "conservativeEnvelopeBytes"].map(key => [key, Math.max(...observations.map(o => o[key]))]));
    const withinLocalBudget = maxima.conservativeEnvelopeBytes <= 96 * 1024 * 1024;
    trials.push({ name, round, profile, counters, counts, results, observations, maxima, withinLocalBudget });
    console.log(JSON.stringify({ name, samples: observations.length, maxima, withinLocalBudget }));
  } finally {
    socket?.close();
    for (const w of pending.values()) { clearTimeout(w.timeout); w.reject(new Error("INSPECTOR_CLOSED")); }
    await mf.dispose();
  }
}
const summary = { kind: "D032-local-concurrent-observations-not-remote-peak", startAlignment: "20-request-entry-barrier-no-in-operation-pause", recordedAt: new Date().toISOString(),
  bundleSha256: createHash("sha256").update(script).digest("hex"),
  migrations: migrations.map(({ file, sha256 }) => ({ file, sha256 })),
  invocations: trials.length * 20, trials, allWithinLocalBudget: trials.every(t => t.withinLocalBudget),
  remoteMetrics: null, remoteMemoryGate: "not_measured", remoteCpuGate: "unchanged_not_passed" };
await writeFile(path.join(output, "summary.json"), JSON.stringify(summary, null, 2), { flag: "wx" });
console.log(JSON.stringify({ completed: trials.length, invocations: summary.invocations, allWithinLocalBudget: summary.allWithinLocalBudget }));
if (!summary.allWithinLocalBudget) process.exitCode = 1;
