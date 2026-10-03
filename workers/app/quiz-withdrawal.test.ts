import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generationDb as db } from "./test/generation-storage-fixture";
import { seedMetadataSermon } from "./test/sermon-metadata-fixture";
import { createDatabase } from "../_shared/db/client";
import { createSubmissionRepository, type VisibleSubmissionWrite } from "../_shared/repositories/submission-repository";
import { createPublicQuizRepository } from "../_shared/repositories/public-quiz-repository";
import { correctPublishedDisplayText } from "../_shared/services/published-display-text";
import { withdrawPublishedQuiz, readWithdrawalReview, listWithdrawalReviews } from "../_shared/services/quiz-withdrawal";
import { createAccessFixture } from "./test/access-fixture";
const actor = "synthetic-admin@example.invalid", at = "2026-09-23T00:00:00.000Z", publishedAt = "2026-09-21T00:00:00.000Z";
const now = new Date(at), rows = async (sql: string, ...args: string[]) => (await db.prepare(sql).bind(...args).all()).results;
const command = () => ({ requestKey: crypto.randomUUID(), expectedPublishedAt: publishedAt, expectedDisplayRevision: 0, reason: "합성 철회 사유", confirmation: "withdraw" });
afterEach(() => vi.restoreAllMocks());
async function fixture(status = "published", start = publishedAt) {
  const sermonId = crypto.randomUUID(), id = crypto.randomUUID(), slug = `2026-09-20-${crypto.randomUUID().slice(0, 6)}`;
  await seedMetadataSermon(createDatabase(db), sermonId);
  await db.prepare("UPDATE sermons SET slug=?,sermon_title='합성 원제목',sermon_date='2026-09-20',ai_summary='합성 요약',ai_summary_disclosure='합성 안내' WHERE id=?").bind(slug, sermonId).run();
  await db.prepare(`INSERT INTO quiz_sets(id,sermon_id,status,created_by,created_at,updated_at,published_at,opens_at,closes_at)
    VALUES(?,?,?,'synthetic',?,?,?,?, '2026-09-28T00:00:00.000Z')`).bind(id, sermonId, status, start, start, start, start).run();
  for (const difficulty of ["child", "adult"]) {
    const variant = `${id}-${difficulty}`, entry = `${variant}-1`;
    await db.prepare(`INSERT INTO quiz_variants(id,quiz_set_id,difficulty,revision,grid_size,public_grid_json,word_count,active_cell_count,intersection_count,validation_report_json,created_at)
      VALUES(?,?,?,1,5,?,1,2,0,?,?)`).bind(variant, id, difficulty, JSON.stringify({ size: 5, cells: [{ row: 0, column: 0, isBlocked: false, acrossNumber: 1 }, { row: 0, column: 1, isBlocked: false }] }), JSON.stringify({ errors: [], warnings: [], generatedAt: start }), start).run();
    await db.prepare(`INSERT INTO quiz_entries_public VALUES(?,?,1,'across',0,0,2,'합성 단서','{}',0)`).bind(entry, variant).run();
    await db.prepare(`INSERT INTO quiz_solutions VALUES(?,?,?,?,?)`).bind(variant, '["r0c0","r0c1"]', '{"r0c0":"가","r0c1":"나"}', JSON.stringify({ [entry]: "가나" }), "a".repeat(64)).run();
  }
  return { id, sermonId, slug, child: `${id}-child`, adult: `${id}-adult` };
}
async function featured(id: string) { await db.prepare("INSERT INTO site_state VALUES('featured_quiz_set_id',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(id, at).run(); }
async function submission(variant: string) {
  const sessionHash = crypto.randomUUID().replaceAll("-", "").repeat(2);
  await db.prepare("INSERT INTO anonymous_sessions VALUES(?,?,?,'2027-01-01T00:00:00.000Z')").bind(sessionHash, publishedAt, publishedAt).run();
  const value: VisibleSubmissionWrite = { id: crypto.randomUUID(), quizVariantId: variant, quizRevision: 1, sessionHash,
    idempotencyKey: "01924f8e-7b2a-7f1c-8f3a-123456789abc", requestHash: "c".repeat(64), displayName: "합성 이름", comment: "합성 코멘트",
    answers: { r0c0: "가" }, correctnessMask: "10", correctCells: 1, totalCells: 2, correctWords: 0, totalWords: 1,
    scoreBasisPoints: 5000, isFullyCorrect: false, submittedAt: at };
  return value;
}
describe("P5-59 first-submission withdrawal", () => {
  it("copies latest display and both private solutions, hides public reads, preserves all source content, and replays exactly", async () => {
    const f = await fixture(), cmd = command(); await featured(f.id);
    await correctPublishedDisplayText(db, f.id, { requestKey: crypto.randomUUID(), expectedRevision: 0,
      before: { title: "합성 원제목", sermonDate: "2026-09-20" }, after: { title: "정정 제목", sermonDate: "2026-09-13" }, reason: "합성 정정" }, actor, now);
    cmd.expectedDisplayRevision = 1;
    const capture = () => Promise.all(["sermons", "quiz_entries_public", "quiz_solutions", "published_display_corrections", "ai_usage_events", "submissions", "leaderboard_snapshots"].map(t => rows(`SELECT * FROM ${t} ORDER BY 1`)));
    const before = await capture();
    expect(await withdrawPublishedQuiz(db, f.id, cmd, actor, now)).toMatchObject({ outcome: "withdrawn", reviewRevision: 2 });
    expect(await capture()).toEqual(before);
    expect(await rows("SELECT status,submission_state,published_at FROM quiz_sets WHERE id=?", f.id)).toEqual([{ status: "review_ready", submission_state: "paused", published_at: publishedAt }]);
    expect(await rows("SELECT lifecycle_status FROM quiz_variants WHERE quiz_set_id=?", f.id)).toEqual([{ lifecycle_status: "withdrawn" }, { lifecycle_status: "withdrawn" }]);
    const view = await readWithdrawalReview(db, f.id);
    expect(view.review.metadata).toEqual({ title: "정정 제목", sermonDate: "2026-09-13" });
    expect(view.review.variants).toHaveLength(2); expect(view.review.variants[0]?.solutionCells).toEqual({ r0c0: "가", r0c1: "나" });
    expect(JSON.stringify(view)).not.toMatch(/actor|requestKey|example.invalid/u);
    expect((await listWithdrawalReviews(db)).items.some(v => v.quizSetId === f.id)).toBe(true);
    for (const level of ["child", "adult"] as const) expect((await createPublicQuizRepository(createDatabase(db)).read({ slug: f.slug }, level, now)).quiz).toBeNull();
    expect((await withdrawPublishedQuiz(db, f.id, cmd, actor, now)).outcome).toBe("replayed");
    for (const changed of [{ reason: "다른 사유" }, { requestKey: crypto.randomUUID() }, { expectedDisplayRevision: 0 }, { expectedPublishedAt: at }])
      await expect(withdrawPublishedQuiz(db, f.id, { ...cmd, ...changed }, actor, now)).rejects.toThrow();
    await expect(withdrawPublishedQuiz(db, f.id, cmd, "other@example.invalid", now)).rejects.toThrow();
    for (const sql of ["UPDATE quiz_withdrawals SET reason='bad' WHERE quiz_set_id=?", "DELETE FROM quiz_withdrawals WHERE quiz_set_id=?", "UPDATE quiz_sets SET status='published' WHERE id=?"])
      await expect(db.prepare(sql).bind(f.id).run()).rejects.toThrow();
    expect(await rows("SELECT id FROM audit_logs WHERE entity_id=? AND action='publication_withdrawn'", f.id)).toHaveLength(1);
  });
  it.each(["visible", "hidden", "deleted"])("refuses %s submissions from either difficulty", async status => {
    for (const level of ["child", "adult"] as const) {
      const f = await fixture(), value = await submission(f[level]);
      await createSubmissionRepository(createDatabase(db)).saveSubmission(value, at);
      if (status === "hidden") await db.prepare("UPDATE submissions SET status='hidden',hidden_at=? WHERE id=?").bind(at, value.id).run();
      if (status === "deleted") await db.prepare("UPDATE submissions SET status='deleted',display_name=NULL,comment=NULL,answers_json=NULL,deleted_at=? WHERE id=?").bind(at, value.id).run();
      const before = await rows("SELECT * FROM submissions WHERE id=?", value.id);
      await expect(withdrawPublishedQuiz(db, f.id, command(), actor, now)).rejects.toThrow();
      expect(await rows("SELECT * FROM submissions WHERE id=?", value.id)).toEqual(before);
      expect(await rows("SELECT status FROM quiz_sets WHERE id=?", f.id)).toEqual([{ status: "published" }]);
    }
  });
  it("counts preserved older revisions and handles no replacement featured", async () => {
    const f = await fixture(), value = await submission(f.child);
    await createSubmissionRepository(createDatabase(db)).saveSubmission(value, at);
    await db.prepare("UPDATE quiz_variants SET lifecycle_status='superseded' WHERE id=?").bind(f.child).run();
    const replacement = `${f.child}-next`;
    await db.prepare(`INSERT INTO quiz_variants(id,quiz_set_id,difficulty,revision,grid_size,public_grid_json,word_count,active_cell_count,intersection_count,validation_report_json,created_at)
      SELECT ?,quiz_set_id,difficulty,2,grid_size,public_grid_json,word_count,active_cell_count,intersection_count,validation_report_json,created_at FROM quiz_variants WHERE id=?`).bind(replacement, f.child).run();
    await db.prepare(`INSERT INTO quiz_entries_public SELECT id||'-next',?,number,direction,start_row,start_col,length,clue,transcript_evidence_json,display_order FROM quiz_entries_public WHERE quiz_variant_id=?`).bind(replacement, f.child).run();
    await db.prepare(`INSERT INTO quiz_solutions SELECT ?,canonical_cell_order_json,solution_cells_json,entry_answers_json,solution_sha256 FROM quiz_solutions WHERE quiz_variant_id=?`).bind(replacement, f.child).run();
    await expect(withdrawPublishedQuiz(db, f.id, command(), actor, now)).rejects.toThrow();
    expect(await rows("SELECT id FROM submissions WHERE id=?", value.id)).toHaveLength(1);
    // All rows here are disposable fixtures. Remove other candidates from this scenario only.
    await db.prepare("UPDATE quiz_sets SET submission_state='paused',submission_paused_at=? WHERE status='published'").bind(at).run();
    await db.prepare("UPDATE quiz_variants SET results_status='invalidated' WHERE quiz_set_id IN (SELECT id FROM quiz_sets WHERE status='archived')").run();
    const empty = await fixture(); await featured(empty.id);
    await withdrawPublishedQuiz(db, empty.id, command(), actor, now);
    expect(await rows("SELECT value FROM site_state WHERE key='featured_quiz_set_id'")).toEqual([{ value: "" }]);
    expect((await createPublicQuizRepository(createDatabase(db)).read({ slug: empty.slug }, "child", now)).quiz).toBeNull();
  });
  it("checks submissions at commit time and handles either order of a concurrent submit/withdraw", async () => {
    for (const first of ["submission", "withdrawal", "concurrent"]) {
      const f = await fixture(), value = await submission(f.adult), repository = createSubmissionRepository(createDatabase(db));
      const submit = () => repository.saveSubmission(value, at), withdraw = () => withdrawPublishedQuiz(db, f.id, command(), actor, now);
      if (first === "submission") { await submit(); await expect(withdraw()).rejects.toThrow(); }
      else if (first === "withdrawal") { await withdraw(); expect(await submit()).toEqual({ outcome: "closed" }); }
      else await Promise.allSettled([submit(), withdraw()]);
      const submissions = await rows("SELECT id FROM submissions WHERE id=?", value.id), withdrawn = await rows("SELECT quiz_set_id FROM quiz_withdrawals WHERE quiz_set_id=?", f.id);
      expect(submissions.length + withdrawn.length).toBe(1);
    }
    // Force a successful submission after service reads but immediately before its INSERT.
    const f = await fixture(), value = await submission(f.child);
    const proxy = new Proxy(db, { get(target, key) {
      if (key === "batch") return async (statements: D1PreparedStatement[]) => {
        await createSubmissionRepository(createDatabase(db)).saveSubmission(value, at); return db.batch(statements);
      };
      const v = Reflect.get(target, key); return typeof v === "function" ? v.bind(target) : v;
    } });
    await expect(withdrawPublishedQuiz(proxy, f.id, command(), actor, now)).rejects.toThrow();
    expect(await rows("SELECT quiz_set_id FROM quiz_withdrawals WHERE quiz_set_id=?", f.id)).toEqual([]);
  });
  it("rolls back copied revision, variants, featured and status if audit insertion fails", async () => {
    const f = await fixture(); await featured(f.id);
    const before = await Promise.all([rows("SELECT * FROM quiz_sets WHERE id=?", f.id), rows("SELECT * FROM quiz_variants WHERE quiz_set_id=?", f.id), rows("SELECT * FROM site_state")]);
    await db.exec("CREATE TRIGGER withdrawal_test_audit BEFORE INSERT ON audit_logs WHEN NEW.action='publication_withdrawn' BEGIN SELECT RAISE(ABORT,'synthetic'); END");
    try { await expect(withdrawPublishedQuiz(db, f.id, command(), actor, now)).rejects.toThrow(); }
    finally { await db.exec("DROP TRIGGER withdrawal_test_audit"); }
    expect(await Promise.all([rows("SELECT * FROM quiz_sets WHERE id=?", f.id), rows("SELECT * FROM quiz_variants WHERE quiz_set_id=?", f.id), rows("SELECT * FROM site_state")])).toEqual(before);
    expect(await rows("SELECT * FROM quiz_withdrawals WHERE quiz_set_id=?", f.id)).toEqual([]);
  });
  it("chooses latest open before archive, leaves other featured untouched, and never reopens archive", async () => {
    // Suites share only disposable synthetic rows; make this scenario's candidates explicit.
    await db.prepare("UPDATE quiz_sets SET submission_state='paused',submission_paused_at=? WHERE status='published'").bind(at).run();
    const old = await fixture("published", "2026-09-19T00:00:00.000Z"), recent = await fixture("published", "2026-09-20T00:00:00.000Z"), archived = await fixture("archived");
    const f = await fixture(); await featured(f.id);
    await withdrawPublishedQuiz(db, f.id, command(), actor, now);
    expect(await rows("SELECT value FROM site_state WHERE key='featured_quiz_set_id'")).toEqual([{ value: recent.id }]);
    const other = await fixture(); await featured(old.id); await withdrawPublishedQuiz(db, other.id, command(), actor, now);
    expect(await rows("SELECT value FROM site_state WHERE key='featured_quiz_set_id'")).toEqual([{ value: old.id }]);
    await db.prepare("UPDATE quiz_sets SET submission_state='paused',submission_paused_at=? WHERE id IN (?,?)").bind(at, old.id, recent.id).run();
    const last = await fixture(); await featured(last.id); const archiveBefore = await rows("SELECT * FROM quiz_sets WHERE id=?", archived.id);
    await withdrawPublishedQuiz(db, last.id, command(), actor, now);
    expect(await rows("SELECT value FROM site_state WHERE key='featured_quiz_set_id'")).toEqual([{ value: archived.id }]);
    expect(await rows("SELECT * FROM quiz_sets WHERE id=?", archived.id)).toEqual(archiveBefore);
  });
  it("refuses archived/draft/closed/stale/invalid requests and allows only one concurrent withdrawal", async () => {
    for (const state of ["draft", "archived"]) { const f = await fixture(state); await expect(withdrawPublishedQuiz(db, f.id, command(), actor, now)).rejects.toThrow(); }
    const f = await fixture();
    await expect(withdrawPublishedQuiz(db, f.id, command(), actor, new Date("2026-09-28T00:00:00.000Z"))).rejects.toThrow();
    for (const changed of [{ expectedDisplayRevision: 1 }, { expectedPublishedAt: at }, { confirmation: "publish" }, { reason: "x" }, { surprise: "private" }])
      await expect(withdrawPublishedQuiz(db, f.id, { ...command(), ...changed }, actor, now)).rejects.toThrow();
    const results = await Promise.allSettled([withdrawPublishedQuiz(db, f.id, command(), actor, now), withdrawPublishedQuiz(db, f.id, command(), actor, now)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  });
  it("protects private review reads and mutation with Access, same-origin, strict JSON, size, method, query and no-store", async () => {
    const f = await fixture(), url = `https://example.com/api/admin/quiz-sets/${f.id}/withdraw-to-review`;
    await db.prepare("UPDATE quiz_sets SET closes_at='2099-09-28T00:00:00.000Z' WHERE id=?").bind(f.id).run();
    for (const method of ["GET", "POST", "DELETE"]) expect((await exports.default.fetch(new Request(url, { method }))).status).toBe(401);
    const access = await createAccessFixture(new Date()), fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(access.jwks));
    const headers = { "Cf-Access-Jwt-Assertion": access.token, Origin: "https://example.com", "Content-Type": "application/json" };
    for (const origin of ["https://bad.invalid", "null", ""]) expect((await exports.default.fetch(new Request(url, { method: "POST", headers: { ...headers, Origin: origin }, body: JSON.stringify(command()) }))).status).toBe(403);
    for (const [target, method, body, status] of [[url, "DELETE", undefined, 405], [url + "?x=1", "GET", undefined, 409], [url, "POST", { ...command(), answer: "PRIVATE_CANARY" }, 409], [url, "POST", { reason: "a".repeat(17000) }, 413]] as const) {
      const r = await exports.default.fetch(new Request(target, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) }));
      expect(r.status).toBe(status); expect(r.headers.get("Cache-Control")).toBe("private, no-store"); expect(await r.text()).not.toMatch(/PRIVATE_CANARY|SELECT|D1_ERROR/u);
    }
    const r = await exports.default.fetch(new Request(url, { method: "POST", headers, body: JSON.stringify(command()) }));
    expect(r.status).toBe(200); expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    for (const target of [url, "https://example.com/api/admin/withdrawn-quizzes"]) {
      const read = await exports.default.fetch(new Request(target, { headers })); expect(read.status).toBe(200); expect(read.headers.get("Cache-Control")).toBe("private, no-store");
      expect(await read.text()).not.toMatch(/actor_digest|request_key|example.invalid/u);
    }
    expect(fetcher.mock.calls.every(([input]) => String(input).includes("cloudflareaccess.com"))).toBe(true);
  });
});
