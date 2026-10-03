import { seedMetadataSermon } from "./test/sermon-metadata-fixture";
import { createDatabase } from "../_shared/db/client";
import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generationDb as db } from "./test/generation-storage-fixture";
import { correctPublishedDisplayText, listPublishedMetadata, readPublishedDisplayText } from "../_shared/services/published-display-text";
import { createAccessFixture } from "./test/access-fixture";
const actor = "synthetic-admin@example.invalid";
const rows = async (query: string, ...args: string[]) => (await db.prepare(query).bind(...args).all()).results;
afterEach(() => vi.restoreAllMocks());
async function fixture(status = "published") {
  const f = { sermonId: crypto.randomUUID() };
  await seedMetadataSermon(createDatabase(db), f.sermonId);
  await db.prepare("UPDATE sermons SET slug=?,sermon_title='합성 원제목',sermon_date='2026-09-20' WHERE id=?")
    .bind(`2026-09-20-${crypto.randomUUID().replaceAll("-", "").slice(0, 6)}`, f.sermonId).run();
  // Seed an already-published legacy row, not a new publication transition without its snapshot.
  const quizSetId = crypto.randomUUID();
  await db.prepare(`INSERT INTO quiz_sets(id,sermon_id,status,created_by,created_at,updated_at,published_at,opens_at,closes_at)
    VALUES(?,?,?,'synthetic','2026-09-21T00:00:00.000Z','2026-09-21T00:00:00.000Z',
    '2026-09-21T00:00:00.000Z','2026-09-21T00:00:00.000Z','2026-09-28T00:00:00.000Z')`).bind(quizSetId, f.sermonId, status).run();
  return { ...f, quizSetId };
}
const command = () => ({ requestKey: crypto.randomUUID(), expectedRevision: 0,
  before: { title: "합성 원제목", sermonDate: "2026-09-20" }, after: { title: "합성 정정 제목", sermonDate: "2026-09-13" }, reason: "합성 오탈자 정정" });
describe("P5-58 published display metadata", () => {
  it.each(["published", "archived"])("corrects legacy %s metadata, retains originals and audits before/after without exposing actor", async status => {
    const f = await fixture(status), cmd = command();
    const original = await rows("SELECT * FROM sermons WHERE id=?", f.sermonId);
    const set = await rows("SELECT * FROM quiz_sets WHERE id=?", f.quizSetId);
    expect(await correctPublishedDisplayText(db, f.quizSetId, cmd, actor)).toMatchObject({ outcome: "changed", revision: 1 });
    const view = await readPublishedDisplayText(db, f.quizSetId);
    expect(view.quiz).toMatchObject({ metadata: cmd.after, revision: 1, status });
    expect(view.history[0]).toMatchObject({ before: cmd.before, after: cmd.after, reason: cmd.reason });
    expect(JSON.stringify(view)).not.toMatch(/actor|digest|example.invalid|requestKey/u);
    expect((await listPublishedMetadata(db)).items.find(q => q.quizSetId === f.quizSetId)).toEqual(view.quiz);
    expect(await rows("SELECT * FROM sermons WHERE id=?", f.sermonId)).toEqual(original);
    expect(await rows("SELECT * FROM quiz_sets WHERE id=?", f.quizSetId)).toEqual(set);
    const audits = await rows("SELECT safe_metadata_json FROM audit_logs WHERE entity_id=? AND action='published_display_corrected'", f.quizSetId);
    expect(audits).toHaveLength(1);
    expect(JSON.parse(audits[0]!.safe_metadata_json as string)).toEqual({ revision: 1, before: cmd.before, after: cmd.after, reason: cmd.reason });
    for (const query of ["UPDATE published_display_corrections SET title='bad' WHERE quiz_set_id=?", "DELETE FROM published_display_corrections WHERE quiz_set_id=?"])
      await expect(db.prepare(query).bind(f.quizSetId).run()).rejects.toThrow();
  });
  it("replays exact requests after later corrections and rejects changed payload, actor, stale revision and stale before values", async () => {
    const f = await fixture(), first = command();
    await correctPublishedDisplayText(db, f.quizSetId, first, actor);
    const second = { ...command(), expectedRevision: 1, before: first.after, after: { ...first.before, title: "세 번째 표시" } };
    await correctPublishedDisplayText(db, f.quizSetId, second, actor);
    expect((await correctPublishedDisplayText(db, f.quizSetId, first, actor)).outcome).toBe("replayed");
    for (const cmd of [{ ...first, reason: "다른 사유" }, { ...first, after: second.after }, { ...first, expectedRevision: 1 },
      { ...first, requestKey: crypto.randomUUID() }, { ...second, requestKey: crypto.randomUUID(), expectedRevision: 2 }])
      await expect(correctPublishedDisplayText(db, f.quizSetId, cmd, actor)).rejects.toThrow();
    await expect(correctPublishedDisplayText(db, f.quizSetId, first, "other@example.invalid")).rejects.toThrow();
    expect((await readPublishedDisplayText(db, f.quizSetId)).quiz.metadata).toEqual(second.after);
    expect(await rows("SELECT id FROM audit_logs WHERE entity_id=?", f.quizSetId)).toHaveLength(2);
  });
  it("permits only one concurrent correction and rolls the entire correction back on audit failure", async () => {
    const f = await fixture();
    const results = await Promise.allSettled([correctPublishedDisplayText(db, f.quizSetId, command(), actor), correctPublishedDisplayText(db, f.quizSetId, command(), actor)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect((await readPublishedDisplayText(db, f.quizSetId)).history).toHaveLength(1);
    const next = await fixture();
    await db.exec("CREATE TRIGGER display_test_audit_fail BEFORE INSERT ON audit_logs WHEN NEW.action='published_display_corrected' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
    try { await expect(correctPublishedDisplayText(db, next.quizSetId, command(), actor)).rejects.toThrow(); }
    finally { await db.exec("DROP TRIGGER display_test_audit_fail"); }
    expect((await readPublishedDisplayText(db, next.quizSetId)).quiz.revision).toBe(0);
    expect(await rows("SELECT id FROM audit_logs WHERE entity_id=?", next.quizSetId)).toHaveLength(0);
  });
  it("rejects drafts, invalid dates, unchanged values and every unapproved content field", async () => {
    const draft = await fixture("draft");
    await expect(correctPublishedDisplayText(db, draft.quizSetId, command(), actor)).rejects.toThrow();
    expect((await listPublishedMetadata(db)).items.some(q => q.quizSetId === draft.quizSetId)).toBe(false);
    const f = await fixture(), base = command();
    for (const cmd of [{ ...base, after: base.before }, { ...base, after: { ...base.after, sermonDate: "2026-02-30" } },
      { ...base, reason: "\u0000bad" }, { ...base, after: { ...base.after, title: "bad\ntext" } },
      ...["slug", "closesAt", "summary", "clue", "answer", "grid", "bibleReferenceLabel", "churchName"].map(key => ({ ...base, after: { ...base.after, [key]: "private" } }))])
      await expect(correctPublishedDisplayText(db, f.quizSetId, cmd, actor)).rejects.toThrow();
    expect((await readPublishedDisplayText(db, f.quizSetId)).history).toEqual([]);
  });
  it("keeps authentication, same-origin JSON, size/query/DTO/method checks and no-store; never calls a provider", async () => {
    const f = await fixture(), url = `https://example.com/api/admin/quiz-sets/${f.quizSetId}/display-text`;
    for (const method of ["GET", "PATCH", "DELETE"]) expect((await exports.default.fetch(new Request(url, { method }))).status).toBe(401);
    const access = await createAccessFixture(new Date());
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(access.jwks));
    const auth = { "Cf-Access-Jwt-Assertion": access.token };
    const mutation = { ...auth, Origin: "https://example.com", "Content-Type": "application/json" };
    for (const origin of ["https://foreign.invalid", "null", ""]) {
      const response = await exports.default.fetch(new Request(url, { method: "PATCH", headers: { ...mutation, Origin: origin }, body: JSON.stringify(command()) }));
      expect(response.status).toBe(403);
    }
    const valid = await exports.default.fetch(new Request(url, { method: "PATCH", headers: mutation, body: JSON.stringify(command()) }));
    expect(valid.status).toBe(200); expect(valid.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await valid.json()).toMatchObject({ data: { outcome: "changed", revision: 1 } });
    for (const [target, method, body, expected] of [[url, "DELETE", undefined, 405], [url + "?extra=1", "GET", undefined, 409],
      [url, "PATCH", { ...command(), unexpected: "PRIVATE_CANARY" }, 409], [url, "PATCH", { reason: "a".repeat(17_000) }, 413]] as const) {
      const response = await exports.default.fetch(new Request(target, { method, headers: mutation, ...(body ? { body: JSON.stringify(body) } : {}) }));
      expect(response.status).toBe(expected); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(await response.text()).not.toMatch(/PRIVATE_CANARY|SELECT|D1_ERROR|example.invalid/u);
    }
    const semantic = await exports.default.fetch(new Request(url, { method: "PATCH", headers: mutation,
      body: JSON.stringify({ ...command(), after: { ...command().after, summary: "다른 의미" } }) }));
    expect(semantic.status).toBe(409);
    expect(await semantic.json()).toMatchObject({ error: { code: "SEMANTIC_CORRECTION_REQUIRED" } });
    for (const target of [url, "https://example.com/api/admin/published-quizzes"]) {
      const response = await exports.default.fetch(new Request(target, { headers: auth })); expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(await response.text()).not.toMatch(/actor_digest|actorEmail|request_key|solution|example.invalid/u);
    }
    expect(fetcher.mock.calls.every(([input]) => String(input).includes("cloudflareaccess.com"))).toBe(true);
  });
});
