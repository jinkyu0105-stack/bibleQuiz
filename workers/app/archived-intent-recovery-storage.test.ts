import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { commitArchivedIntentRecovery } from "../_shared/services/commit-archived-intent-recovery";
import { readIntentDomain } from "../_shared/services/generation-domain-reader";
import { readContentGenerationView } from "../_shared/services/content-generation-view";
import { executeContentHumanCommand } from "../_shared/services/content-human-generation";
import { archivedRecoveryFixture } from "./test/archived-intent-recovery-fixture";

// Freeze Date per synthetic case, keeping real timers and SQL time guards active.
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); });
afterEach(() => { vi.useRealTimers(); });

it("atomically saves and reads an archived AI analysis while preserving failed jobs and all costs; retries never duplicate it", async () => {
  const f = await archivedRecoveryFixture(), before = await f.ledger();
  const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("NO_PAID_CALL"));
  try {
    const result = await commitArchivedIntentRecovery(f.db, f.pin, f.requestText, f.responseText, f.actor, new Date().toISOString());
    expect(result.outcome).toBe("saved");
    if (!("eventId" in result)) throw new Error(JSON.stringify(result));
    const eventId = result.eventId;
    const domain = await readIntentDomain(f.db, f.owner);
    expect(domain.basis.authority).toMatchObject({ status: "failed", content: { state: "present", eventCount: 1,
      intent: { selectedId: eventId, critique: null, confirmation: null } } });
    expect(domain.basis.snapshots).toHaveLength(1);
    const view = await readContentGenerationView(f.db, f.owner.sermonId, false);
    expect(view).toMatchObject({ status: "failed", version: 3, jobCostMicroUsd: 560, quizCostMicroUsd: 560 });
    expect(view.snapshots[0]?.value.id).toBe(eventId);
    expect(await f.ledger()).toEqual(before);
    expect(await commitArchivedIntentRecovery(f.db, f.pin, f.requestText, f.responseText, f.actor, new Date().toISOString()))
      .toEqual({ outcome: "replayed", eventId, providerCalls: 0 });
    expect(await commitArchivedIntentRecovery(f.db, f.pin, f.requestText, f.responseText, "b".repeat(64), new Date().toISOString()))
      .toEqual({ outcome: "conflict" });
    expect(await commitArchivedIntentRecovery(f.db, f.pin, f.requestText, f.responseText + " ", f.actor, new Date().toISOString()))
      .toEqual({ outcome: "conflict" });
    expect(await f.db.prepare("SELECT count(*) n FROM generation_archived_intent_recoveries WHERE sermon_id=?").bind(f.owner.sermonId).first()).toEqual({ n: 1 });
    expect(await f.db.prepare("SELECT count(*) n FROM sermon_content_events WHERE sermon_id=?").bind(f.owner.sermonId).first()).toEqual({ n: 1 });
    await expect(f.db.prepare("UPDATE generation_archived_intent_recoveries SET actor_digest=? WHERE event_id=?")
      .bind("b".repeat(64), eventId).run()).rejects.toThrow(/immutable archived intent recovery/);
    await expect(f.db.prepare("DELETE FROM generation_archived_intent_recoveries WHERE event_id=?").bind(eventId).run())
      .rejects.toThrow(/immutable archived intent recovery/);
    await expect(executeContentHumanCommand(f.db, f.owner, { requestKey: crypto.randomUUID(), expectedVersion: 3,
      operation: { family: "intent", operation: { kind: "confirm", analysisId: eventId } } }, f.actor))
      .rejects.toThrow("GENERATION_DOMAIN_NOT_READY");
    expect(network).not.toHaveBeenCalled();
  } finally { network.mockRestore(); }
});

it("rolls back both receipt and content on a late storage failure, then permits a free retry", async () => {
  const f = await archivedRecoveryFixture(), before = await f.ledger();
  const trigger = `synthetic_recovery_abort_${f.owner.sermonId.replaceAll("-", "_")}`;
  await f.db.prepare(`CREATE TRIGGER ${trigger} BEFORE INSERT ON sermon_content_current
    WHEN NEW.sermon_id='${f.owner.sermonId}' BEGIN SELECT RAISE(ABORT,'synthetic late failure'); END`).run();
  try {
    expect(await commitArchivedIntentRecovery(f.db, f.pin, f.requestText, f.responseText, f.actor, new Date().toISOString()))
      .toEqual({ outcome: "conflict" });
    for (const table of ["generation_archived_intent_recoveries", "sermon_content_events", "sermon_content_heads", "sermon_content_payloads", "sermon_content_chunks", "sermon_content_domain_lineage"]) {
      expect(await f.db.prepare(`SELECT count(*) n FROM ${table} WHERE sermon_id=?`).bind(f.owner.sermonId).first()).toEqual({ n: 0 });
    }
    expect(await f.ledger()).toEqual(before);
  } finally { await f.db.prepare(`DROP TRIGGER ${trigger}`).run(); }
  expect((await commitArchivedIntentRecovery(f.db, f.pin, f.requestText, f.responseText, f.actor, new Date().toISOString())).outcome).toBe("saved");
});

it("rechecks metadata inside the transaction, even when it changes after the last application read", async () => {
  const f = await archivedRecoveryFixture(), before = await f.ledger();
  let called = false;
  const raced = { prepare: f.db.prepare.bind(f.db), batch: async (statements: D1PreparedStatement[]) => {
    called = true;
    await f.db.prepare("UPDATE sermon_metadata_drafts SET metadata_revision=metadata_revision+1 WHERE sermon_id=?").bind(f.owner.sermonId).run();
    return f.db.batch(statements);
  } } as D1Database;
  expect(await commitArchivedIntentRecovery(raced, f.pin, f.requestText, f.responseText, f.actor, new Date().toISOString()))
    .toEqual({ outcome: "conflict" });
  expect(called).toBe(true);
  expect(await f.db.prepare("SELECT count(*) n FROM generation_archived_intent_recoveries WHERE sermon_id=?").bind(f.owner.sermonId).first()).toEqual({ n: 0 });
  expect(await f.db.prepare("SELECT count(*) n FROM sermon_content_events WHERE sermon_id=?").bind(f.owner.sermonId).first()).toEqual({ n: 0 });
  expect(await f.ledger()).toEqual(before);
});
