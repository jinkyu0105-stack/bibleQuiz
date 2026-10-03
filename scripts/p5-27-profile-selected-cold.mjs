// Local synthetic workerd only. No Wrangler config, credentials or remote binding.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const output = process.argv[2];
const variant = process.argv[3] ?? "baseline";
const comparisonBundle = process.argv[4];
assert(["baseline", "prepared", "minified"].includes(variant));
assert(!comparisonBundle || (variant === "baseline" && path.isAbsolute(comparisonBundle)), "Comparison bundle must be an absolute local file and use baseline mode");
assert(output && path.isAbsolute(output), "New absolute output directory required");
await mkdir(output);
const require = createRequire(import.meta.url);
const installed = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare, Log, LogLevel, convertV4MiniflareOptions } = installed("miniflare");
const { build } = installed("esbuild");
const { unstable_splitSqlQuery } = await import("wrangler");
// Diagnostic-only alternative: exercise pure schema initialization at startup,
// never issue a warm-up request/DB call and never remove a measured first request.
const preparedEntry = `
import probe from './workers/app/p5-27-selected-probe';
import { sermonInputCommandSchema } from './workers/_shared/services/sermon-input';
import { inputEventSchema } from './workers/_shared/repositories/sermon-input-store';
import { transcriptHumanContextSchema } from './workers/_shared/services/transcript-input-contract';
const sha='0'.repeat(64), now='2026-09-16T00:00:00.000Z';
sermonInputCommandSchema.parse({action:'import_source',expectedVersion:0,payload:{sourceMode:'manual_paste',manualSourceKind:'youtube_visible_transcript',sourceCoverage:'full_transcript',rawTranscriptText:'TEST_ONLY',checksumFormat:'sha256:utf8-raw-text:v1',rawTranscriptSha256:sha}});
transcriptHumanContextSchema.parse({kind:'human',adminId:'synthetic',now});
inputEventSchema.parse({sermon_id:'synthetic',version:1,id:'synthetic',kind:'source',source_type:'caption_plain',source_id:'synthetic',document_id:'synthetic',confirmation_id:null,parent_document_id:null,related_id:null,document_sha256:sha,payload_sha256:sha,chunk_count:1,byte_length:1,actor_id:'synthetic',created_at:now,state:'sealed',required_state:'sealed'});
export default probe;
`;
const entry = variant !== "prepared" ? {entryPoints:[path.join(root,"workers/app/p5-27-selected-probe.ts")]} :
  {stdin:{contents:preparedEntry,resolveDir:root,sourcefile:"p527-prepared-experiment.ts",loader:"ts"}};
const bundle = await build({ ...entry,
  bundle: true, minify: variant === "minified", write: false, format: "esm", platform: "neutral", target: "es2023" });
const script = comparisonBundle ? await readFile(comparisonBundle, "utf8") : bundle.outputFiles[0].text;
const bundleSha256 = createHash("sha256").update(script).digest("hex");
await writeFile(path.join(output, "probe.js"), script, { flag: "wx" });
const statements = [];
for (const f of (await readdir(path.join(root, "migrations"))).filter(f => /^\d{4}.*\.sql$/u.test(f)).sort()) {
  statements.push(...unstable_splitSqlQuery(await readFile(path.join(root, "migrations", f), "utf8")));
}
function summarize(profile) {
  const nodes = new Map(profile.nodes.map(n => [n.id, n]));
  const counts = new Map();
  for (const id of profile.samples ?? []) {
    const f = nodes.get(id).callFrame;
    const key = JSON.stringify({ name: f.functionName || "(anonymous)", url: f.url, line: f.lineNumber + 1 });
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return { samples: profile.samples?.length ?? 0,
    selfFrames: [...counts].map(([k, samples]) => ({ ...JSON.parse(k), samples })).sort((a,b) => b.samples-a.samples) };
}
const trials = [];
for (let round = 0; round < 3; round++) for (const profile of ["typical", "boundary"]) {
  const name = `p527-cold-${profile}-${round}`;
  const readyStarted = performance.now();
  const mf = new Miniflare(convertV4MiniflareOptions({ inspectorPort: 0, port: 0, host: "127.0.0.1", log: new Log(LogLevel.ERROR),
    workers: [{ name, modules: true, script, compatibilityDate: "2026-08-25", d1Databases: { DB: "synthetic-only" },
      outboundService: () => new Response("Outbound disabled", { status: 403 }) }] }));
  let socket;
  const pending = new Map(); let serial = 0;
  function cdp(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++serial;
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
      pending.set(id, { resolve, reject, timeout }); socket.send(JSON.stringify({ id, method, params }));
    });
  }
  try {
    await mf.ready;
    const localReadyWallMs = performance.now() - readyStarted;
    const db = await mf.getD1Database("DB");
    for (const sql of statements) await db.prepare(sql).run();
    await db.prepare("INSERT INTO bible_translations (id,display_name,edition,publisher_or_rightsholder,mode,status,created_at,updated_at) VALUES ('cold','TEST_ONLY','TEST_ONLY','TEST_ONLY','reference_only','pending','2026-09-16','2026-09-16')").run();
    const ids = [...Array.from({ length: 5 }, (_, i) => `p527-${profile}-${String(i).padStart(3,"0")}`), "p527-concurrent"];
    for (const id of ids) await db.prepare("INSERT INTO sermons (id,slug_suffix,church_name,youtube_url,youtube_video_id,sermon_title,sermon_date,bible_translation_id,bible_reference_json,bible_reference_label,created_at,updated_at) VALUES (?,?,'TEST_ONLY','https://example.invalid',?,'TEST_ONLY','2026-09-16','cold','[]','TEST_ONLY','2026-09-16','2026-09-16')").bind(id,id,id).run();
    const inspector = await mf.getInspectorURL(); inspector.protocol = "http:";
    const targets = await (await fetch(new URL("/json/list", inspector))).json();
    const target = targets.find(t => t.title.includes(name)); assert(target);
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve,reject) => { socket.addEventListener("open",resolve,{once:true}); socket.addEventListener("error",reject,{once:true}); });
    socket.addEventListener("message", e => { const v=JSON.parse(e.data), w=pending.get(v.id); if(!w)return;
      pending.delete(v.id);clearTimeout(w.timeout);if(v.error)w.reject(new Error(JSON.stringify(v.error)));else w.resolve(v.result); });
    await cdp("Profiler.enable"); await cdp("Profiler.setSamplingInterval", { interval: 100 });
    async function invoke(p, index) {
      const response = await mf.dispatchFetch("https://p5-27.invalid/__p5-27/leaf", { method:"POST",
        headers:{"x-p5-27-internal":"p5-27-service-binding-only"},body:JSON.stringify({profile:p,index}) });
      assert.equal(response.status,200);return response.json();
    }
    const samples = [];
    for(let index=0;index<5;index++) {
      const heapBefore=await cdp("Runtime.getHeapUsage");await cdp("Profiler.start");
      const started=performance.now();const result=await invoke(profile,index);const wallMs=performance.now()-started;
      const { profile: cpu }=await cdp("Profiler.stop");const heapAfter=await cdp("Runtime.getHeapUsage");
      assert.equal(result.outcome,"updated");
      // Historical comparison bundles retain their original preflight read.
      assert.equal(result.queries,(profile==="typical"?4:5)+(comparisonBundle?1:0));
      await writeFile(path.join(output,`${name}-${index}.cpuprofile`),JSON.stringify(cpu),{flag:"wx"});
      samples.push({index,result,wallMs,heapBefore,heapAfter,profile:summarize(cpu)});
    }
    assert.equal(new Set(samples.map(s=>s.result.isolate)).size,1);
    let concurrent=null;
    if(round===2 && profile==="boundary") {
      const heapSamples=[await cdp("Runtime.getHeapUsage")];let active=true;
      const poll=(async()=>{while(active){heapSamples.push(await cdp("Runtime.getHeapUsage"));await new Promise(r=>setTimeout(r,5));}})();
      let results;try {results=await Promise.all(Array.from({length:20},(_,i)=>invoke("concurrent",i)));}finally{active=false;await poll;}
      heapSamples.push(await cdp("Runtime.getHeapUsage"));
      assert.equal(new Set(results.map(r=>r.isolate)).size,1);
      assert.equal(results.filter(r=>r.outcome==="updated").length,1);
      assert.equal(results.filter(r=>r.failureCode==="INPUT_CONFLICT").length,19);
      const counts=await db.prepare("SELECT (SELECT count(*) FROM sermon_input_events WHERE sermon_id='p527-concurrent') AS events,(SELECT count(*) FROM sermon_input_chunks WHERE sermon_id='p527-concurrent') AS chunks").first();
      assert.deepEqual(counts,{events:1,chunks:13});concurrent={results,counts,heapSamples};
    }
    assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results,[]);
    trials.push({name,round,profile,localReadyWallMs,samples,concurrent});
    console.log(JSON.stringify({name,firstTop:samples[0].profile.selfFrames.slice(0,10),laterTop:samples[1].profile.selfFrames.slice(0,5)}));
  } finally {
    socket?.close();for(const w of pending.values()){clearTimeout(w.timeout);w.reject(new Error("Inspector closed"));}
    await mf.dispose();
  }
}
await writeFile(path.join(output,"summary.json"),JSON.stringify({kind:"local-sampled-cpu-and-observed-heap-not-remote-billing-or-peak",variant,bundleSha256,comparisonBundle:comparisonBundle ?? null,intervalUs:100,recordedAt:new Date().toISOString(),trials},null,2),{flag:"wx"});
console.log(JSON.stringify({completed:trials.length,requests:50,output}));
