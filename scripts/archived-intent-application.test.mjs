import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { readFile, writeFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { directory, databasePath, handle } from "./test/local-recovery-env.mjs";
import { archivedRecoveryFixture } from "../workers/app/test/archived-intent-recovery-fixture";
import { planRecoveryApplication, applyRecoveryApplication } from "./apply-archived-intent-recovery.mjs";
import { databaseFingerprint, digest, localRecoveryD1 } from "./local-recovery-d1.mjs";

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  handle.native.exec("CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  for (const name of (await readdir("migrations")).filter(n => /^00[0-2]\d_.+\.sql$/u.test(n)).sort()) {
    handle.native.exec(await readFile(path.join("migrations", name), "utf8"));
    handle.native.prepare("INSERT INTO d1_migrations(name) VALUES(?)").run(name);
  }
});
afterAll(async () => { vi.useRealTimers(); handle.close(); await rm(directory, { recursive: true }); });

it("preflights an existing 0031 DB; pending migrations and recovery roll back together, then save once", async () => {
  const partial = true;
  if (partial) for (const name of ["0030_phase5_archived_intent_recovery.sql", "0031_phase5_recovered_analysis_continuation.sql"]) {
    handle.native.exec(await readFile(path.join("migrations", name), "utf8"));
    handle.native.prepare("INSERT INTO d1_migrations(name) VALUES(?)").run(name);
  }
  const f = await archivedRecoveryFixture();
  const requestPath = path.join(directory, "request.json"), responsePath = path.join(directory, "response.json"), manifestPath = path.join(directory, "manifest.json");
  await writeFile(requestPath, f.requestText, { mode: 0o600 });
  await writeFile(responsePath, f.responseText, { mode: 0o600 });
  await writeFile(manifestPath, JSON.stringify({ databasePath, requestPath, responsePath, pin: f.pin, outputDirectory: path.join(directory, "unused") }), { mode: 0o600 });
  handle.native.exec("CREATE TRIGGER synthetic_late_failure BEFORE INSERT ON sermon_content_current BEGIN SELECT RAISE(ABORT,'synthetic late failure'); END");
  const before = databaseFingerprint(handle.native), ledger = await f.ledger();
  const continuationTriggers = () => handle.native.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name IN ('generation_intent_analysis_reuse_proof','lifecycle_full_v3_stage_advance','lifecycle_intent_wait') ORDER BY name").all();
  const oldTriggers = continuationTriggers();
  const first = await planRecoveryApplication(manifestPath, path.join(directory, "first"));
  expect(first).toMatchObject({ outcome: "ready_for_application_review", providerCalls: 0, writesPerformed: false });
  expect(databaseFingerprint(handle.native)).toBe(before);
  await expect(applyRecoveryApplication(first.planPath, "0".repeat(64))).rejects.toThrow("EXACT_PLAN_CONFIRMATION_REQUIRED");
  await expect(applyRecoveryApplication(first.planPath, first.planSha256)).rejects.toThrow("RECOVERY_COMMIT_REJECTED");
  expect(databaseFingerprint(handle.native)).toBe(before);
  expect(handle.native.prepare("SELECT count(*) n FROM sqlite_master WHERE name='generation_archived_intent_recoveries'").get()?.n).toBe(partial ? 1 : 0);
  expect(continuationTriggers()).toEqual(oldTriggers);
  expect(await f.ledger()).toEqual(ledger);
  const backupName = (await readdir(path.dirname(first.planPath))).find(n => n.endsWith(".sqlite"));
  const copy = localRecoveryD1(path.join(path.dirname(first.planPath), backupName));
  try { expect(databaseFingerprint(copy.native)).toBe(before); } finally { copy.close(); }
  handle.native.exec("DROP TRIGGER synthetic_late_failure");
  await expect(applyRecoveryApplication(first.planPath, first.planSha256)).rejects.toThrow("DATABASE_CHANGED_SINCE_PLAN");
  const second = await planRecoveryApplication(manifestPath, path.join(directory, "second"));
  const saved = await applyRecoveryApplication(second.planPath, second.planSha256);
  expect(saved).toMatchObject({ outcome: "saved", providerCalls: 0, protectedHistoryPreserved: true, humanApproved: false, critiquePerformed: false });
  expect(continuationTriggers()).toHaveLength(3);
  expect(continuationTriggers()).not.toEqual(oldTriggers);
  expect(await f.ledger()).toEqual(ledger);
  const after = databaseFingerprint(handle.native);
  expect(await applyRecoveryApplication(second.planPath, second.planSha256)).toMatchObject({ outcome: "replayed", eventId: saved.eventId, providerCalls: 0 });
  expect(databaseFingerprint(handle.native)).toBe(after);
  expect(handle.native.prepare("SELECT count(*) n FROM sermon_content_events").get()?.n).toBe(1);
  expect(handle.native.prepare("SELECT count(*) n FROM d1_migrations").get()?.n).toBe(35);
  expect(handle.native.prepare("SELECT count(*) n FROM sqlite_master WHERE name='ai_response_archives'").get()?.n).toBe(0);
  expect(handle.native.prepare("SELECT count(*) n FROM sqlite_master WHERE name IN ('generation_display_snapshots','generation_display_finals')").get()?.n).toBe(0);
  await writeFile(responsePath, f.responseText + " ");
  await expect(applyRecoveryApplication(second.planPath, second.planSha256)).rejects.toThrow("EXISTING_RECOVERY_UNVERIFIED");
  expect(databaseFingerprint(handle.native)).toBe(after);
});

it("read-only native handles reject writes and nested batches roll back every statement", async () => {
  const ro = localRecoveryD1(databasePath);
  try { await expect(ro.db.prepare("WITH x AS (SELECT 1) DELETE FROM quiz_sets").all()).rejects.toThrow(/readonly/iu); }
  finally { ro.close(); }
  handle.native.exec("CREATE TABLE synthetic_atomic(id INTEGER PRIMARY KEY)");
  await expect(handle.db.batch([handle.db.prepare("INSERT INTO synthetic_atomic VALUES(1)"), handle.db.prepare("INSERT INTO synthetic_atomic VALUES(1)")])).rejects.toThrow();
  expect(handle.native.prepare("SELECT count(*) n FROM synthetic_atomic").get()?.n).toBe(0);
  expect(digest("fixed")).toMatch(/^[a-f0-9]{64}$/u);
});
