import assert from "node:assert/strict";
import { open, readFile, realpath, stat, mkdir, readdir, chmod } from "node:fs/promises";
import { createRequire } from "node:module";
import { backup } from "node:sqlite";
import { homedir, userInfo } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { localRecoveryD1, databaseFingerprint, digest } from "./local-recovery-d1.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationNames = ["0030_phase5_archived_intent_recovery.sql", "0031_phase5_recovered_analysis_continuation.sql", "0032_phase5_archived_critique_continuation.sql", "0033_phase5_archived_summary_recovery.sql", "0034_phase5_stored_content_continuation.sql"];
const allowedTables = ["d1_migrations", "generation_archived_intent_recoveries", "sermon_content_events",
  "sermon_content_heads", "sermon_content_current", "sermon_content_payloads", "sermon_content_chunks", "sermon_content_domain_lineage"];
// Continuation migrations change these definitions; their table rows stay protected.
const changedTriggers = ["generation_intent_analysis_reuse_proof", "lifecycle_full_v3_stage_advance", "lifecycle_intent_wait"];
const json = value => JSON.stringify(value, null, 2) + "\n";
async function durableWrite(filename, text) {
  const f = await open(filename, "wx", 0o600);
  try { await f.writeFile(text); await f.sync(); } finally { await f.close(); }
  const parent = await open(path.dirname(filename), "r"); try { await parent.sync(); } finally { await parent.close(); }
}
async function privateDirectory(directory) {
  assert.ok(path.isAbsolute(directory));
  const actual = await realpath(directory), s = await stat(actual);
  assert.ok(s.isDirectory() && !(s.mode & 0o077), "PRIVATE_DIRECTORY_REQUIRED");
  assert.ok(actual !== root && !actual.startsWith(root + "/") && !/^\/(?:var\/)?tmp(?:\/|$)/u.test(actual), "PERSISTENT_PRIVATE_DIRECTORY_REQUIRED");
  return actual;
}
async function privateText(filename) {
  assert.ok(path.isAbsolute(filename));
  const actual = await realpath(filename), s = await stat(actual);
  assert.ok(s.isFile() && !(s.mode & 0o077), "PRIVATE_FILE_REQUIRED");
  return readFile(actual, "utf8");
}
async function databasePath(filename) {
  assert.ok(path.isAbsolute(filename));
  const actual = await realpath(filename);
  assert.ok((await stat(actual)).isFile(), "EXISTING_DATABASE_REQUIRED");
  assert.ok(actual !== root && !actual.startsWith(root + "/") && !/^\/(?:var\/)?tmp(?:\/|$)/u.test(actual));
  let protectedDirectory = false;
  for (let p = path.dirname(actual); p !== path.dirname(p); p = path.dirname(p))
    if (!((await stat(p)).mode & 0o077)) { protectedDirectory = true; break; }
  assert.ok(protectedDirectory, "PRIVATE_DATABASE_REQUIRED");
  return actual;
}
async function runtime() {
  const require = createRequire(await realpath(path.join(root, "node_modules/wrangler/package.json")));
  const { outputFiles } = await require("esbuild").build({ stdin: { contents:
    'export { prepareArchivedIntentRecovery } from "./workers/_shared/services/archived-intent-recovery"; export { commitArchivedIntentRecovery } from "./workers/_shared/services/commit-archived-intent-recovery";',
    resolveDir: root, loader: "ts" }, bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent" });
  const code = outputFiles[0].contents;
  const codeSha256 = digest(Buffer.concat([code, await readFile(fileURLToPath(import.meta.url)), await readFile(path.join(root, "scripts/local-recovery-d1.mjs"))]));
  // This recovery approval is permanently bounded by 0034. A later unrelated
  // migration must neither disable recovery of the old DB nor enter its plan.
  const boundary = Number(migrationNames.at(-1).slice(0, 4));
  const names = (await readdir(path.join(root, "migrations"))).filter(n => /^\d{4}_.+\.sql$/u.test(n) && Number(n.slice(0, 4)) <= boundary).sort();
  assert.deepEqual(names.slice(-migrationNames.length), migrationNames, "MIGRATION_SCOPE_CHANGED");
  const migrations = await Promise.all(names.map(async name => ({ name, sha256: digest(await readFile(path.join(root, "migrations", name))) })));
  const api = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
  const upgrade = await Promise.all(migrationNames.map(async name => ({ name, sql: await readFile(path.join(root, "migrations", name), "utf8") })));
  return { api, codeSha256, migrations, upgrade };
}
async function offline(fn) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("OFFLINE_NETWORK_FORBIDDEN"); };
  try { return await fn(); } finally { globalThis.fetch = original; }
}
function integrity(native) {
  assert.equal(native.prepare("PRAGMA quick_check").get().quick_check, "ok", "DATABASE_INTEGRITY_FAILED");
  assert.equal(native.prepare("PRAGMA foreign_key_check").all().length, 0, "FOREIGN_KEY_FAILED");
}
function migrationHistory(native, migrations) {
  assert.deepEqual(native.prepare("SELECT name FROM d1_migrations ORDER BY id").all().map(r => r.name), migrations.map(m => m.name), "MIGRATION_HISTORY_CHANGED");
}
const localActor = () => digest(`biblequiz-local-recovery-operator-v1:${userInfo().uid}:${homedir()}`);

export async function planRecoveryApplication(manifestPath, outputDirectory) {
  await privateDirectory(path.dirname(manifestPath));
  await privateDirectory(path.dirname(outputDirectory));
  const m = JSON.parse(await privateText(manifestPath));
  assert.deepEqual(Object.keys(m).sort(), ["databasePath", "outputDirectory", "pin", "requestPath", "responsePath"].sort());
  const target = await databasePath(m.databasePath), requestPath = await realpath(m.requestPath), responsePath = await realpath(m.responsePath);
  const requestText = await privateText(requestPath), responseText = await privateText(responsePath);
  return offline(async () => {
    const r = await runtime(), handle = localRecoveryD1(target);
    try {
      handle.native.exec("BEGIN");
      integrity(handle.native);
      const applied = handle.native.prepare("SELECT name FROM d1_migrations ORDER BY id").all().map(row => row.name);
      assert.ok(applied.length >= r.migrations.length - migrationNames.length && applied.length <= r.migrations.length, "MIGRATION_SCOPE_CHANGED");
      const baseMigrations = r.migrations.slice(0, applied.length);
      migrationHistory(handle.native, baseMigrations);
      const upgrade = r.upgrade.filter(m => !applied.includes(m.name));
      const ready = await r.api.prepareArchivedIntentRecovery(handle.db, m.pin, requestText, responseText);
      assert.equal(ready.outcome, "ready_for_local_review", "RECOVERY_NOT_READY");
      const p = ready.package;
      const plan = { format: "local-archived-intent-application-v3", databasePath: target,
        requestPath, responsePath, pin: m.pin, actorDigest: localActor(), actorKind: "local_os_operator",
        databaseFingerprint: databaseFingerprint(handle.native), protectedFingerprint: databaseFingerprint(handle.native, allowedTables, changedTriggers),
        codeSha256: r.codeSha256, migrations: r.migrations, baseMigrations, upgrade: upgrade.map(m => m.name), recoveryId: p.recoveryId,
        inputVersion: p.expectedAuthority.input.version, checks: p.checks,
        before: { calls: handle.native.prepare("SELECT count(*) n FROM ai_provider_calls").get().n,
          usage: handle.native.prepare("SELECT count(*) n FROM ai_usage_events").get().n,
          costMicroUsd: handle.native.prepare("SELECT coalesce(sum(estimated_cost_micro_usd),0) n FROM ai_usage_events").get().n },
        boundaries: { paidCalls: 0, remote: false, humanApproval: false, critique: false, writesPerformed: false } };
      handle.native.exec("COMMIT");
      assert.ok(path.isAbsolute(outputDirectory));
      await mkdir(outputDirectory, { mode: 0o700 });
      const planText = json(plan), planSha256 = digest(planText);
      await durableWrite(path.join(outputDirectory, "application-plan.json"), planText);
      await durableWrite(path.join(outputDirectory, "review.txt"), `로컬 복구 적용 계획\n원래 시험 DB: ${target}\n입력 version: ${plan.inputVersion}\n분석: ${plan.checks.claimCount}개 주장 / ${plan.checks.evidenceCount}개 근거\n미적용 migration ${plan.upgrade.join(", ") || "없음"}과 보관 결과를 하나의 트랜잭션으로 적용합니다. 이미 적용된 migration은 다시 실행하지 않습니다.\n기존 실패/사용량/비용 유지. 추가 AI 호출 0. 새 비판 호출/사람 확정 없음.\n실제 적용 전 이 DB를 사용하는 앱/Worker/보관기를 종료해야 합니다.\n적용 전 DB 사본을 같은 개인 폴더에 보관합니다. 실패 시 새 구조/복구 저장 모두 취소합니다.\n결과가 불명확하면 같은 계획으로 조회/재시도하며 원래 AI 작업을 재전송하지 않습니다.\n적용 후 이상이 있으면 후속 호출/확정/발행을 중단하고 기록을 대조합니다.\n자동 사본 복원/복구 이력 삭제는 하지 않습니다.\n승인 대상 계획 SHA256: ${planSha256}\n아직 실제 DB 변경이나 실행 승인이 아닙니다.\n`);
      return { outcome: "ready_for_application_review", planPath: path.join(outputDirectory, "application-plan.json"), planSha256,
        inputVersion: plan.inputVersion, ...plan.checks, writesPerformed: false, providerCalls: 0 };
    } finally { handle.close(); }
  });
}

export async function applyRecoveryApplication(planPath, confirmedPlanSha256) {
  const directory = await privateDirectory(path.dirname(planPath)), text = await privateText(planPath);
  assert.match(confirmedPlanSha256, /^[a-f0-9]{64}$/u);
  assert.equal(digest(text), confirmedPlanSha256, "EXACT_PLAN_CONFIRMATION_REQUIRED");
  const p = JSON.parse(text);
  assert.equal(p.format, "local-archived-intent-application-v3");
  assert.equal(p.actorKind, "local_os_operator"); assert.equal(p.actorDigest, localActor(), "LOCAL_OPERATOR_CHANGED");
  const target = await databasePath(p.databasePath);
  assert.equal(target, p.databasePath);
  const requestText = await privateText(p.requestPath), responseText = await privateText(p.responsePath);
  return offline(async () => {
    const r = await runtime(); assert.equal(r.codeSha256, p.codeSha256, "APPLICATION_CODE_CHANGED");
    assert.deepEqual(r.migrations, p.migrations, "MIGRATION_FILES_CHANGED");
    const handle = localRecoveryD1(target, false);
    let transaction = false;
    try {
      integrity(handle.native);
      const hasRecovery = handle.native.prepare("SELECT 1 FROM sqlite_master WHERE name='generation_archived_intent_recoveries'").get();
      const receipt = hasRecovery ? handle.native.prepare("SELECT event_id FROM generation_archived_intent_recoveries WHERE source_job_id=?").get(p.pin.sourceJobId) : null;
      if (receipt) {
        migrationHistory(handle.native, r.migrations);
        assert.equal(receipt?.event_id, p.recoveryId, "UNEXPECTED_APPLIED_STATE");
        // Existing receipt makes the service verify history, never insert again.
        const verified = await r.api.commitArchivedIntentRecovery(handle.db, p.pin, requestText, responseText, p.actorDigest, new Date().toISOString());
        assert.equal(verified.outcome, "replayed", "EXISTING_RECOVERY_UNVERIFIED");
        return verified;
      }
      migrationHistory(handle.native, p.baseMigrations);
      const upgrade = r.upgrade.filter(m => p.upgrade.includes(m.name));
      assert.deepEqual(upgrade.map(m => m.name), p.upgrade, "MIGRATION_SCOPE_CHANGED");
      assert.equal(databaseFingerprint(handle.native), p.databaseFingerprint, "DATABASE_CHANGED_SINCE_PLAN");
      // Snapshot before taking the write lock; check both snapshot and live state
      // against the approved logical fingerprint before any migration or content write.
      const backupPath = path.join(directory, `before-application-${crypto.randomUUID()}.sqlite`);
      await backup(handle.native, backupPath); await chmod(backupPath, 0o600);
      const copy = localRecoveryD1(backupPath);
      try { integrity(copy.native); assert.equal(databaseFingerprint(copy.native), p.databaseFingerprint, "BACKUP_CHANGED"); } finally { copy.close(); }
      const file = await open(backupPath, "r"); try { await file.sync(); } finally { await file.close(); }
      const parent = await open(directory, "r"); try { await parent.sync(); } finally { await parent.close(); }
      handle.native.exec("BEGIN IMMEDIATE"); transaction = true;
      assert.equal(databaseFingerprint(handle.native), p.databaseFingerprint, "DATABASE_CHANGED_SINCE_BACKUP");
      for (const migration of upgrade) {
        handle.native.exec(migration.sql);
        handle.native.prepare("INSERT INTO d1_migrations(name) VALUES(?)").run(migration.name);
      }
      const result = await r.api.commitArchivedIntentRecovery(handle.db, p.pin, requestText, responseText, p.actorDigest, new Date().toISOString());
      assert.equal(result.outcome, "saved", "RECOVERY_COMMIT_REJECTED"); assert.equal(result.eventId, p.recoveryId);
      assert.equal(databaseFingerprint(handle.native, allowedTables, changedTriggers), p.protectedFingerprint, "PROTECTED_HISTORY_CHANGED");
      integrity(handle.native);
      handle.native.exec("COMMIT"); transaction = false;
      const report = { ...result, backupPath, planSha256: confirmedPlanSha256, migrations: p.upgrade,
        protectedHistoryPreserved: true, humanApproved: false, critiquePerformed: false };
      // A report-write failure must never replay the AI or restore the DB. The
      // committed receipt remains authoritative on the next invocation.
      await durableWrite(path.join(directory, "application-result.json"), json(report));
      return report;
    } catch (error) { if (transaction) handle.native.exec("ROLLBACK"); throw error; }
    finally { handle.close(); }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode, input, outputOrConfirmation] = process.argv.slice(2);
    assert.equal(process.argv.length, 5, "MODE_AND_TWO_ARGUMENTS_REQUIRED");
    assert.ok(mode === "plan" || mode === "apply");
    console.log(JSON.stringify(await (mode === "plan" ? planRecoveryApplication(input, outputOrConfirmation) : applyRecoveryApplication(input, outputOrConfirmation))));
  } catch { console.error("LOCAL_RECOVERY_APPLICATION_STOPPED_NO_AUTOMATIC_RETRY"); process.exitCode = 1; }
}
