// Read a saved Preview export into memory. Never opens a live local or remote DB,
// reads credentials, calls a provider, or changes the saved fixture/export files.
import assert from "node:assert/strict";
import { readFile, realpath, writeFile, mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { localRecoveryD1, databaseFingerprint } from "./local-recovery-d1.mjs";

const [mode, input] = process.argv.slice(2);
assert.equal(mode, "--local-existing-copy");
assert.ok(input);
const root = resolve(input), repo = resolve(import.meta.dirname, "..");
const require = createRequire(await realpath(`${repo}/node_modules/wrangler/package.json`));
const temporary = await mkdtemp("/tmp/p571-display-reuse-");
const build = await require("esbuild").build({ stdin: { contents: `
  export {readContentGenerationView} from "./workers/_shared/services/content-generation-view";
  export {prepareDisplayEvent,prepareDisplayFinalPart,verifyPreparedDisplayFinal} from "./workers/_shared/services/content-display-preparation";`,
  resolveDir: repo, loader: "ts" }, bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent" });
await writeFile(`${temporary}/runtime.mjs`, build.outputFiles[0].text, { mode: 0o600 });
const runtime = await import(`${temporary}/runtime.mjs`);
globalThis.fetch = async () => { throw new Error("NETWORK_DISABLED_IN_LOCAL_VERIFICATION"); };
const handle = localRecoveryD1(":memory:", false), db = handle.db;
try {
  handle.native.exec("PRAGMA foreign_keys=OFF");
  handle.native.exec(await readFile(`${root}/free-cpu/after-split-reads.sql`, "utf8"));
  handle.native.exec("PRAGMA foreign_keys=ON");
  const original = databaseFingerprint(handle.native);
  const originalSequence = JSON.stringify(handle.native.prepare("SELECT * FROM sqlite_sequence ORDER BY name").all());
  const tableCount = handle.native.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'").get().n;
  handle.native.exec(await readFile(`${repo}/migrations/0036_generation_display_projections.sql`, "utf8"));
  const displayTables = ["generation_display_snapshots", "generation_display_finals"];
  assert.equal(databaseFingerprint(handle.native, displayTables), original);
  assert.equal(JSON.stringify(handle.native.prepare("SELECT * FROM sqlite_sequence ORDER BY name").all()), originalSequence);
  for (const profile of ["11715", "30000", "invalid_output"]) {
    const fixture = JSON.parse(await readFile(`${root}/fixture-${profile}.json`, "utf8"));
    const job = handle.native.prepare("SELECT id,sermon_id,quiz_set_id FROM generation_jobs WHERE id=?").get(fixture.jobId);
    assert.ok(job && job.sermon_id === fixture.sermonId);
    const owner = { sermonId: job.sermon_id, quizSetId: job.quiz_set_id, jobId: job.id };
    const events = handle.native.prepare("SELECT e.event_id FROM sermon_content_events e JOIN sermon_content_domain_lineage l ON l.sermon_id=e.sermon_id AND l.event_id=e.event_id WHERE e.sermon_id=? AND e.state='sealed' ORDER BY e.content_sequence").all(owner.sermonId);
    for (const event of events) await runtime.prepareDisplayEvent(db, owner, event.event_id);
    const proof = handle.native.prepare("SELECT ticket_id FROM generation_final_validation_proofs WHERE job_id=?").get(owner.jobId);
    if (proof) {
      for (const difficulty of ["child", "adult"]) await runtime.prepareDisplayFinalPart(db, owner, proof.ticket_id, difficulty);
      await runtime.verifyPreparedDisplayFinal(db, owner, proof.ticket_id);
    }
    const expected = JSON.parse(await readFile(`${root}/free-cpu/display-before-${profile}.json`, "utf8")).body.data;
    const combined = await runtime.readContentGenerationView(db, owner.sermonId, false);
    assert.deepEqual(combined, expected);
    const queryLog = [], observed = new Proxy(db, { get(target, key) {
      if (key === "prepare") return sql => { queryLog.push(sql); return target.prepare(sql); };
      const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
    } });
    const parts = {};
    for (let repeat = 0; repeat < 3; repeat++) for (const section of ["state", "content", "costs", "activity", "placement"])
      parts[section] = await runtime.readContentGenerationView(observed, owner.sermonId, false, undefined, section);
    assert.ok(queryLog.every(sql => !/^\s*(INSERT|UPDATE|DELETE)/iu.test(sql)));
    assert.ok(queryLog.every(sql => !/sermon_input_chunks|sermon_content_chunks|final_check_ticket_chunks/u.test(sql)));
    const after = { ...parts.state }; delete after.viewRevision;
    const keys = { content: ["content", "snapshots", "quality", "historyCursor", "recoveredAnalysisId", "recoveredCritiqueId"],
      costs: ["weekCostMicroUsd", "weekUnknownCalls", "jobCostMicroUsd", "jobUnknownCalls", "quizCostMicroUsd", "quizUnknownCalls"],
      activity: ["regenerations"], placement: ["placement", "preview", "reviewLayouts"] };
    for (const [section, fields] of Object.entries(keys)) {
      assert.equal(parts[section].viewRevision, parts.state.viewRevision);
      for (const key of fields) if (Object.hasOwn(parts[section], key)) after[key] = parts[section][key];
    }
    assert.deepEqual(after, expected);
    console.log(JSON.stringify({ profile, equal: true, snapshots: combined.snapshots.length, preview: !!combined.preview,
      preparedEvents: events.length, repeatedGetCount: 15, originalChunkReads: 0, getWrites: 0, paidCalls: 0 }));
  }
  assert.equal(databaseFingerprint(handle.native, displayTables), original);
  assert.equal(JSON.stringify(handle.native.prepare("SELECT * FROM sqlite_sequence ORDER BY name").all()), originalSequence);
  assert.equal(handle.native.prepare("PRAGMA foreign_key_check").all().length, 0);
  assert.equal(handle.native.prepare("PRAGMA quick_check").get().quick_check, "ok");
  console.log(JSON.stringify({ originalTables: tableCount, originalFingerprintPreserved: true, foreignKeyErrors: 0,
    quickCheck: "ok", snapshotCopies: handle.native.prepare("SELECT count(*) n FROM generation_display_snapshots").get().n,
    gridCopies: handle.native.prepare("SELECT count(*) n FROM generation_display_finals").get().n,
    remoteWrites: 0, originalFileWrites: 0, cpuEvidence: "local correctness only; native Preview CPU still pending" }));
} finally { handle.close(); }
