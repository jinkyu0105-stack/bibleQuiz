import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generationDb as db, seedGenerationContext } from "./test/generation-storage-fixture";
import { createSermonInputStore } from "../_shared/repositories/sermon-input-store";
import { createSermonInputService } from "../_shared/services/sermon-input";
import { prepareManualTranscriptSource } from "../_shared/services/manual-transcript-source";
import { draftIsPurged, listDraftCleanup, purgeExpiredDraft, runScheduledDraftCleanup } from "../_shared/services/draft-cleanup";
import { createAccessFixture } from "./test/access-fixture";
import { historyFixture } from "./test/sermon-history-codec-fixture";
import { seedReadHistory } from "./test/sermon-history-read-fixture";
const savedAt = "2026-09-20T00:00:00.000Z", dueAt = "2026-09-27T00:00:00.000Z";
afterEach(() => vi.restoreAllMocks());
async function fixture(addEdits = true) {
  const owner = await seedGenerationContext(), store = createSermonInputStore(db), service = createSermonInputService(store);
  await db.prepare("UPDATE sermons SET updated_at=? WHERE id=?").bind(savedAt, owner.sermonId).run();
  await db.prepare("UPDATE draft_activity SET updated_at=? WHERE sermon_id=?").bind(savedAt, owner.sermonId).run();
  const source = await prepareManualTranscriptSource({ sourceMode: "manual_paste", manualSourceKind: "youtube_visible_transcript", sourceCoverage: "full_transcript", rawTranscriptText: "TEST_PRIVATE_RAW 원본" });
  if (source.outcome !== "validated") throw new Error("fixture");
  const ctx = { kind: "human", adminId: "test-actor", now: savedAt };
  expect((await service.importPreparedManual(owner.sermonId, 0, source.source, ctx)).outcome).toBe("saved");
  async function command(action: "edit" | "confirm", text?: string) {
    const h = (await store.head(owner.sermonId))!;
    return service.execute(owner.sermonId, { action, expectedVersion: h.version, sourceId: h.source_id,
      documentId: h.document_id, documentSha256: h.document_sha256,
      ...(action === "confirm" ? { reviewed: true } : { content: { format: "plain_text", text } }) }, ctx);
  }
  if (addEdits) await command("edit", "TEST_PRIVATE_CONFIRMED 확정");
  const confirmed = (await store.head(owner.sermonId))!;
  if (addEdits) { await command("confirm"); await command("edit", "TEST_PRIVATE_DRAFT 만료 대상"); }
  return { ...owner, store, service, command, confirmed };
}
const rows = async (sql: string, ...args: string[]) => (await db.prepare(sql).bind(...args).all()).results;
function batchHook(hook: () => Promise<void>): D1Database {
  return new Proxy(db, { get(target, key) {
    if (key === "batch") return async (statements: D1PreparedStatement[]) => { await hook(); return target.batch(statements); };
    const value: unknown = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
}
describe("P5-57 isolated D1 cleanup", () => {
  it("announces one day before, expires at exactly seven days, keeps source/final confirmation and seals a replayable audit", async () => {
    const f = await fixture();
    expect((await listDraftCleanup(db, "2026-09-25T23:59:59.999Z")).items.find(i => i.sermonId === f.sermonId)).toBeUndefined();
    expect((await listDraftCleanup(db, "2026-09-26T00:00:00.000Z")).items.find(i => i.sermonId === f.sermonId)).toMatchObject({ state: "scheduled", dueAt });
    expect((await purgeExpiredDraft(db, f.sermonId, "2026-09-26T23:59:59.999Z")).outcome).toBe("not_due");
    const identity = await rows("SELECT * FROM sermon_input_events WHERE sermon_id=?", f.sermonId);
    const raw = await rows("SELECT * FROM sermon_input_chunks WHERE sermon_id=? AND event_id IN (SELECT id FROM sermon_input_events WHERE sermon_id=? AND kind='source')", f.sermonId, f.sermonId);
    expect((await purgeExpiredDraft(db, f.sermonId, dueAt)).outcome).toBe("purged");
    expect(await rows("SELECT * FROM sermon_input_events WHERE sermon_id=?", f.sermonId)).toEqual(identity);
    expect(await rows("SELECT * FROM sermon_input_chunks WHERE sermon_id=? AND event_id IN (SELECT id FROM sermon_input_events WHERE sermon_id=? AND kind='source')", f.sermonId, f.sermonId)).toEqual(raw);
    expect(await f.store.payload(f.confirmed)).toEqual({ format: "plain_text", text: "TEST_PRIVATE_CONFIRMED 확정" });
    expect(JSON.stringify(await rows("SELECT body FROM sermon_input_chunks WHERE sermon_id=?", f.sermonId))).not.toContain("만료 대상");
    expect((await purgeExpiredDraft(db, f.sermonId, dueAt)).outcome).toBe("replayed");
    expect(await rows("SELECT count(*) n FROM audit_logs WHERE entity_id=? AND action='draft_payloads_purged'", f.sermonId)).toEqual([{ n: 1 }]);
    await expect(db.prepare("DELETE FROM draft_cleanup_records WHERE sermon_id=?").bind(f.sermonId).run()).rejects.toThrow();
    await expect(db.prepare("DELETE FROM sermon_input_chunks WHERE sermon_id=? AND event_id=?").bind(f.sermonId, f.confirmed.id).run()).rejects.toThrow();
    expect(await rows("PRAGMA foreign_key_check")).toEqual([]);
  });
  it("does not expire an imported original when there is no draft comparison body", async () => {
    const f = await fixture(false);
    expect((await purgeExpiredDraft(db, f.sermonId, "2026-10-20T00:00:00.000Z")).outcome).toBe("not_due");
    expect((await listDraftCleanup(db, "2026-10-20T00:00:00.000Z")).items.some(i => i.sermonId === f.sermonId)).toBe(false);
    expect(await draftIsPurged(db, f.sermonId)).toBe(false);
    expect(await f.service.current(f.sermonId)).toMatchObject({ outcome: "loaded", input: { content: { text: "TEST_PRIVATE_RAW 원본" } } });
  });
  it("rolls back payload deletion and marker together if the audit cannot commit", async () => {
    const f = await fixture(), before = await rows("SELECT * FROM sermon_input_chunks WHERE sermon_id=?", f.sermonId);
    await db.exec("CREATE TRIGGER cleanup_test_fail BEFORE INSERT ON audit_logs WHEN NEW.action='draft_payloads_purged' BEGIN SELECT RAISE(ABORT,'synthetic rollback'); END");
    try { await expect(purgeExpiredDraft(db, f.sermonId, dueAt)).rejects.toThrow(); }
    finally { await db.exec("DROP TRIGGER cleanup_test_fail"); }
    expect(await draftIsPurged(db, f.sermonId)).toBe(false);
    expect(await rows("SELECT * FROM sermon_input_chunks WHERE sermon_id=?", f.sermonId)).toEqual(before);
  });
  it("cancels cleanup when another save races its batch and recomputes the expiry", async () => {
    const f = await fixture();
    const wrapped = batchHook(async () => {
      await db.prepare("UPDATE sermons SET updated_at=? WHERE id=?").bind("2026-09-26T00:00:00.000Z", f.sermonId).run();
    });
    expect((await purgeExpiredDraft(wrapped, f.sermonId, dueAt)).outcome).toBe("changed");
    expect(await draftIsPurged(db, f.sermonId)).toBe(false);
    expect((await purgeExpiredDraft(db, f.sermonId, dueAt)).outcome).toBe("not_due");
  });
  it("keeps all legacy row identities and removes old comparison bodies", async () => {
    const h = await historyFixture(false, false), id = await seedReadHistory(h);
    const before = await rows("SELECT * FROM sermon_history_records WHERE sermon_id=?", id);
    const sourceId = h.state().sources[0]!.id, finalId = h.state().confirmations.at(-1)!.revisionId;
    const preserved = await rows("SELECT * FROM sermon_history_chunks WHERE sermon_id=? AND record_id IN (?,?) ORDER BY record_id,chunk_index", id, sourceId, finalId);
    expect((await purgeExpiredDraft(db, id, "2026-10-20T00:00:00.000Z")).outcome).toBe("purged");
    expect(await rows("SELECT * FROM sermon_history_records WHERE sermon_id=?", id)).toEqual(before);
    expect(await rows("SELECT * FROM sermon_history_chunks WHERE sermon_id=? AND record_id IN (?,?) ORDER BY record_id,chunk_index", id, sourceId, finalId)).toEqual(preserved);
    expect(await rows("SELECT count(*) n FROM sermon_history_chunks c JOIN sermon_history_records r USING(sermon_id,record_id) WHERE c.sermon_id=? AND r.stream IN ('intentEvents','summaryEvents','candidateEvents','correctionProposals','correctionDecisions')", id)).toEqual([{ n: 0 }]);
  });
  it("holds missing publication snapshots and never runs without the explicit runtime switch", async () => {
    const f = await fixture();
    await db.prepare("UPDATE quiz_sets SET status='archived',opens_at='2026-09-20T00:00:00.000Z',closes_at='2026-09-27T00:00:00.000Z',archived_at='2026-09-27T00:00:00.000Z',published_at=? WHERE id=?").bind(savedAt, f.quizSetId).run();
    expect((await listDraftCleanup(db, dueAt)).items.find(i => i.sermonId === f.sermonId)).toMatchObject({ state: "blocked", reason: "publication_missing" });
    expect((await purgeExpiredDraft(db, f.sermonId, dueAt)).outcome).toBe("not_due");
    expect(await runScheduledDraftCleanup({ DB: db }, dueAt)).toEqual({ outcome: "disabled" });
    expect(await draftIsPurged(db, f.sermonId)).toBe(false);
  });
  it("does not invent historical metadata save times, and the scheduler safely replays a completed run", async () => {
    const old = await fixture();
    await db.prepare("DELETE FROM draft_activity WHERE sermon_id=?").bind(old.sermonId).run();
    expect((await listDraftCleanup(db, dueAt)).items.find(i => i.sermonId === old.sermonId)).toMatchObject({ state: "blocked", dueAt: null, reason: "activity_unknown" });
    expect((await purgeExpiredDraft(db, old.sermonId, dueAt)).outcome).toBe("not_due");
    const fresh = await fixture();
    const first = await runScheduledDraftCleanup({ DB: db, DRAFT_CLEANUP_ENABLED: "true" }, dueAt);
    expect(first).toMatchObject({ outcome: "completed", results: expect.arrayContaining([{ sermonId: fresh.sermonId, outcome: "purged" }]) });
    expect(await draftIsPurged(db, old.sermonId)).toBe(false);
    expect(await runScheduledDraftCleanup({ DB: db, DRAFT_CLEANUP_ENABLED: "true" }, dueAt)).toEqual({ outcome: "completed", results: [] });
  });
  it("authenticates the read-only list, rejects query extras, and explicitly reports expired drafts", async () => {
    const f = await fixture(); await purgeExpiredDraft(db, f.sermonId, dueAt);
    const url = "https://example.com/api/admin/draft-cleanup";
    expect((await exports.default.fetch(new Request(url))).status).toBe(401);
    const access = await createAccessFixture(new Date());
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(access.jwks));
    const headers = { "Cf-Access-Jwt-Assertion": access.token };
    const response = await exports.default.fetch(new Request(url, { headers }));
    expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(JSON.stringify(await response.json())).not.toMatch(/TEST_PRIVATE|actor|sourceSha256|purgeInputIds/u);
    expect((await exports.default.fetch(new Request(`${url}?delete=true`, { headers }))).status).toBe(400);
    const expired = await exports.default.fetch(new Request(`https://example.com/api/admin/sermons/${f.sermonId}/input`, { headers }));
    expect(expired.status).toBe(410); expect(await expired.json()).toMatchObject({ error: { code: "DRAFT_EXPIRED" } });
    expect((await exports.default.fetch(new Request(url, { method: "POST", headers }))).status).toBe(404);
  });
});
