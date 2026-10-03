import { listDraftCleanup, purgeExpiredDraft, runScheduledDraftCleanup } from "../_shared/services/draft-cleanup";
import { sha256Bytes } from "../_shared/storage/sha256";
import { readWithdrawalEdits, saveWithdrawalEdits } from "../_shared/services/withdrawal-edits";
import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generationDb as db } from "./test/generation-storage-fixture";
import { seedMetadataSermon } from "./test/sermon-metadata-fixture";
import { createAccessFixture } from "./test/access-fixture";
import { createDatabase } from "../_shared/db/client";
import { generatePuzzle, PUZZLE_FIXTURES, serializePublicPuzzle, coordinateFor, cellId } from "../../shared/puzzle";
import { previewWithdrawalEdits } from "../_shared/services/withdrawal-preview";
import { withdrawPublishedQuiz, readWithdrawalReview } from "../_shared/services/quiz-withdrawal";
import { createPublicQuizRepository } from "../_shared/repositories/public-quiz-repository";

const at = "2026-09-23T00:00:00.000Z", publishedAt = "2026-09-21T00:00:00.000Z";
const generated = generatePuzzle({ ...PUZZLE_FIXTURES.fiveByFive,
  candidates: PUZZLE_FIXTURES.fiveByFive.candidates.map((candidate, index) => ({ ...candidate, id: `entry-${index}` })) });
if (!generated.ok) throw new Error("synthetic fixture failed");
const puzzle = generated.puzzle, grid = serializePublicPuzzle(puzzle);
afterEach(() => vi.restoreAllMocks());
async function fixture(withdraw = true) {
  const id = crypto.randomUUID(), sermonId = crypto.randomUUID(), slug = `2026-09-20-${id.slice(0, 6)}`;
  await seedMetadataSermon(createDatabase(db), sermonId);
  await db.prepare("UPDATE sermons SET slug=?,ai_summary='합성 요약',ai_summary_disclosure='합성 안내' WHERE id=?").bind(slug, sermonId).run();
  await db.prepare(`INSERT INTO quiz_sets(id,sermon_id,status,created_by,created_at,updated_at,published_at,opens_at,closes_at)
    VALUES(?,?,'published','synthetic',?,?,?,?, '2026-09-28T00:00:00.000Z')`).bind(id, sermonId, publishedAt, publishedAt, publishedAt, publishedAt).run();
  for (const difficulty of ["child", "adult"]) {
    const variantId = `${id}-${difficulty}`;
    const stored = { size: 5, cells: Array.from({ length: 25 }, (_, index) => {
      const row = Math.floor(index / 5), column = index % 5, starts = grid.entries.filter(e => e.start.row === row && e.start.column === column);
      return { row, column, isBlocked: !grid.cells.some(c => c.id === cellId({ row, column })),
        ...(starts.some(e => e.direction === "across") ? { acrossNumber: starts[0]!.number } : {}),
        ...(starts.some(e => e.direction === "down") ? { downNumber: starts[0]!.number } : {}) };
    }) };
    await db.prepare(`INSERT INTO quiz_variants(id,quiz_set_id,difficulty,revision,grid_size,public_grid_json,word_count,active_cell_count,intersection_count,validation_report_json,created_at)
      VALUES(?,?,?,1,5,?,?,?,?,?,?)`).bind(variantId, id, difficulty, JSON.stringify(stored), grid.entries.length, grid.cells.length, puzzle.report.crossingCellCount,
        JSON.stringify({ errors: [], warnings: [], generatedAt: publishedAt }), publishedAt).run();
    for (const [index, entry] of grid.entries.entries()) await db.prepare("INSERT INTO quiz_entries_public VALUES(?,?,?,?,?,?,?,?,?,?)")
      .bind(`${variantId}-${entry.id}`, variantId, entry.number, entry.direction, entry.start.row, entry.start.column, entry.length, entry.clue!, '{"source":"SYNTHETIC_PRIVATE_GROUNDING"}', index).run();
    await db.prepare("INSERT INTO quiz_solutions VALUES(?,?,?,?,?)").bind(variantId, JSON.stringify(grid.cells.map(c => c.id)), JSON.stringify(puzzle.solution.cells),
      JSON.stringify(Object.fromEntries(Object.entries(puzzle.solution.entries).map(([key, value]) => [`${variantId}-${key}`, value]))), "a".repeat(64)).run();
  }
  if (withdraw) await withdrawPublishedQuiz(db, id, { requestKey: crypto.randomUUID(), expectedPublishedAt: publishedAt, expectedDisplayRevision: 0,
    reason: "합성 철회", confirmation: "withdraw" }, "synthetic@example.invalid", new Date(at));
  return { id, sermonId, slug, entryId: `${id}-child-${grid.entries[0]!.id}` };
}
const command = (entryId: string) => ({ expectedReviewRevision: 2, edits: [{ difficulty: "child", entryId, clue: "수정한 합성 단서" }] });
async function capture() {
  const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all<{ name: string }>()).results;
  return Promise.all(tables.map(async ({ name }) => ({ name, rows: (await db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY 1`).all()).results })));
}

describe("P5-60 private withdrawal edit preview", () => {
  it("checks both grids without draft history, preserves every synthetic D1 table and remains hidden", async () => {
    const f = await fixture(), original = await readWithdrawalReview(db, f.id), before = await capture();
    const result = await previewWithdrawalEdits(db, f.id, command(f.entryId));
    expect(result).toMatchObject({ persisted: false, requiresHumanReview: true, codeChecksPassed: true, reviewRevision: 2 });
    const child = result.variants.find(v => v.difficulty === "child")!.preview!;
    expect(child.grid.entries.find(e => e.id === f.entryId)!.clue).toBe("수정한 합성 단서");
    const adult = result.variants.find(v => v.difficulty === "adult")!.preview!;
    expect(adult.solution).toEqual({ cells: original.review.variants.find(v => v.difficulty === "adult")!.solutionCells,
      entries: original.review.variants.find(v => v.difficulty === "adult")!.entryAnswers });
    expect(JSON.stringify(child.grid)).not.toMatch(/solution|gridAnswer|SYNTHETIC_PRIVATE_GROUNDING/u);
    for (const difficulty of ["child", "adult"] as const) expect((await createPublicQuizRepository(createDatabase(db)).read({ slug: f.slug }, difficulty, new Date(at))).quiz).toBeNull();
    expect(await capture()).toEqual(before);
    expect(await readWithdrawalReview(db, f.id)).toEqual(original);
  });
  it("accepts an uncrossed answer edit, but detects cross-letter conflicts and length changes", async () => {
    const f = await fixture(), entry = puzzle.entries[0]!;
    const memberships = (id: string) => puzzle.entries.filter(e => Array.from(e.gridAnswer, (_, i) => cellId(coordinateFor(e, i))).includes(id)).length;
    for (const crossing of [false, true]) {
      const offset = Array.from(entry.gridAnswer).findIndex((_, index) => (memberships(cellId(coordinateFor(entry, index))) > 1) === crossing);
      expect(offset).toBeGreaterThanOrEqual(0);
      const letters = Array.from(entry.gridAnswer); letters[offset] = "힣";
      const result = await previewWithdrawalEdits(db, f.id, { expectedReviewRevision: 2, edits: [{ difficulty: "child", entryId: `${f.id}-child-${entry.entryId}`, answer: letters.join("") }] });
      expect(result.codeChecksPassed).toBe(!crossing);
      if (crossing) expect(result.variants.find(v => v.difficulty === "child")!.issues).toContain("LETTER_CONFLICT");
      else expect(result.variants.find(v => v.difficulty === "child")!.preview!.solution.entries[`${f.id}-child-${entry.entryId}`]).toBe(letters.join(""));
    }
    for (const [answer, issue] of [["abc", "INVALID_HANGUL_SYLLABLE"], ["가나", "REPLACEMENT_LAYOUT_REQUIRED"]]) {
      const result = await previewWithdrawalEdits(db, f.id, { expectedReviewRevision: 2, edits: [{ difficulty: "child", entryId: f.entryId, answer }] });
      expect(result.codeChecksPassed).toBe(false);
      expect(result.variants.find(v => v.difficulty === "child")!.issues).toContain(issue);
      expect(result.variants.find(v => v.difficulty === "child")!.preview).toBeNull();
    }
  });
  it("refuses stale, unknown, duplicate, empty and forged content requests without writes", async () => {
    const f = await fixture(), cmd = command(f.entryId), before = await capture();
    for (const raw of [{ ...cmd, expectedReviewRevision: 3 }, { ...cmd, edits: [{ ...cmd.edits[0], entryId: "foreign-entry" }] },
      { ...cmd, edits: [...cmd.edits, ...cmd.edits] }, { ...cmd, edits: [] }, { ...cmd, slug: "forged" },
      { ...cmd, edits: [{ ...cmd.edits[0], solution: "forged" }] }, { ...cmd, edits: [{ difficulty: "child", entryId: f.entryId }] }]) {
      await expect(previewWithdrawalEdits(db, f.id, raw)).rejects.toThrow();
    }
    expect(await capture()).toEqual(before);
    const published = await fixture(false);
    await expect(previewWithdrawalEdits(db, published.id, command(published.entryId))).rejects.toThrow();
  });
  it("protects answer previews with Access, origin, JSON, size, method, query and no-store", async () => {
    const f = await fixture(), url = `https://example.com/api/admin/quiz-sets/${f.id}/withdrawal-preview`, cmd = command(f.entryId);
    for (const method of ["GET", "POST", "DELETE"]) expect((await exports.default.fetch(new Request(url, { method }))).status).toBe(401);
    const access = await createAccessFixture(new Date());
    const network = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(access.jwks));
    const headers = { "Cf-Access-Jwt-Assertion": access.token, Origin: "https://example.com", "Content-Type": "application/json" };
    for (const origin of ["https://bad.invalid", "null", ""]) expect((await exports.default.fetch(new Request(url, { method: "POST", headers: { ...headers, Origin: origin }, body: JSON.stringify(cmd) }))).status).toBe(403);
    for (const [target, method, body, status] of [[url, "GET", undefined, 405], [url + "?x=1", "POST", cmd, 409],
      [url, "POST", { ...cmd, answer: "PRIVATE_CANARY" }, 409], [url, "POST", { answer: "a".repeat(17000) }, 413]] as const) {
      const response = await exports.default.fetch(new Request(target, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) }));
      expect(response.status).toBe(status); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(await response.text()).not.toMatch(/PRIVATE_CANARY|SYNTHETIC_PRIVATE_GROUNDING|SELECT|D1_ERROR/u);
    }
    const malformed = await exports.default.fetch(new Request(url, { method: "POST", headers, body: "{" }));
    expect(malformed.status).toBe(400);
    const wrongType = await exports.default.fetch(new Request(url, { method: "POST", headers: { ...headers, "Content-Type": "text/plain" }, body: JSON.stringify(cmd) }));
    expect(wrongType.status).toBe(415);
    const response = await exports.default.fetch(new Request(url, { method: "POST", headers, body: JSON.stringify(cmd) }));
    expect(response.status).toBe(200); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ data: { codeChecksPassed: true, persisted: false, requiresHumanReview: true } });
    expect(network.mock.calls.every(([input]) => String(input).includes("cloudflareaccess.com"))).toBe(true);
  });
});

const actor = "synthetic-editor@example.invalid";
const saveCommand = (entryId: string, expectedEditRevision = 0) => ({ ...command(entryId), expectedEditRevision, requestKey: crypto.randomUUID() });
describe("P5-60 durable withdrawal edits", () => {
  it("preserves all old tables, replays exact saved revisions, composes changes and previews the current head", async () => {
    const f = await fixture(), source = await readWithdrawalReview(db, f.id), first = saveCommand(f.entryId);
    const before = (await capture()).filter(t => !["withdrawal_edit_revisions", "audit_logs"].includes(t.name));
    expect(await readWithdrawalEdits(db, f.id)).toMatchObject({ editRevision: 0, edits: [], savedAt: null });
    const saved = await saveWithdrawalEdits(db, f.id, first, actor);
    expect(saved).toMatchObject({ outcome: "saved", revision: { editRevision: 1, requiresHumanReview: true } });
    expect(await readWithdrawalEdits(db, f.id)).toEqual(saved.revision);
    expect(await saveWithdrawalEdits(db, f.id, first, actor)).toEqual({ ...saved, outcome: "replayed" });
    for (const changed of [{ ...first, edits: [{ ...first.edits[0], clue: "다른 단서" }] }, { ...first, expectedEditRevision: 1 }])
      await expect(saveWithdrawalEdits(db, f.id, changed, actor)).rejects.toThrow();
    await expect(saveWithdrawalEdits(db, f.id, first, "other@example.invalid")).rejects.toThrow();
    const adultEntry = source.review.variants.find(v => v.difficulty === "adult")!.entries[0]!;
    const second = { ...saveCommand(adultEntry.id, 1), edits: [{ difficulty: "adult", entryId: adultEntry.id, clue: "두 번째 수정" }] };
    await saveWithdrawalEdits(db, f.id, second, actor);
    const third = { ...saveCommand(f.entryId, 2), edits: [{ difficulty: "child", entryId: f.entryId, answer: "가나" }] };
    await saveWithdrawalEdits(db, f.id, third, actor);
    const current = await readWithdrawalEdits(db, f.id);
    expect(current.edits).toEqual(expect.arrayContaining([{ difficulty: "child", entryId: f.entryId, answer: "가나", clue: "수정한 합성 단서" }, second.edits[0]]));
    expect(current.editRevision).toBe(3);
    expect(await saveWithdrawalEdits(db, f.id, first, actor)).toEqual({ ...saved, outcome: "replayed" });
    expect((await readWithdrawalEdits(db, f.id)).editRevision).toBe(3);
    const preview = await previewWithdrawalEdits(db, f.id, { expectedReviewRevision: 2, expectedEditRevision: 3, edits: [] });
    expect(preview).toMatchObject({ codeChecksPassed: false, persisted: false, editRevision: 3, requiresHumanReview: true });
    expect(preview.variants.find(v => v.difficulty === "child")!.issues).toContain("REPLACEMENT_LAYOUT_REQUIRED");
    expect(preview.variants.find(v => v.difficulty === "adult")!.preview!.grid.entries.find(e => e.id === adultEntry.id)!.clue).toBe("두 번째 수정");
    await expect(previewWithdrawalEdits(db, f.id, { ...command(f.entryId), expectedEditRevision: 2 })).rejects.toThrow();
    await expect(saveWithdrawalEdits(db, f.id, saveCommand(f.entryId, 1), actor)).rejects.toThrow();
    expect(await readWithdrawalReview(db, f.id)).toEqual(source);
    expect((await capture()).filter(t => !["withdrawal_edit_revisions", "audit_logs"].includes(t.name))).toEqual(before);
    const audits = await db.prepare("SELECT safe_metadata_json FROM audit_logs WHERE entity_id=? AND action='withdrawal_edit_saved'").bind(f.id).all();
    expect(audits.results).toHaveLength(3); expect(JSON.stringify(audits.results)).not.toMatch(/단서|가나|example.invalid/u);
    for (const sql of ["UPDATE withdrawal_edit_revisions SET edits_json='[]' WHERE quiz_set_id=?", "DELETE FROM withdrawal_edit_revisions WHERE quiz_set_id=?"])
      await expect(db.prepare(sql).bind(f.id).run()).rejects.toThrow();
  });
  it("allows one concurrent writer and rejects forged or foreign edit targets", async () => {
    const f = await fixture();
    for (const cmd of [{ ...saveCommand(f.entryId), expectedReviewRevision: 3 }, { ...saveCommand("foreign-entry") },
      { ...saveCommand(f.entryId), reviewed: true }, { ...saveCommand(f.entryId), edits: [] }])
      await expect(saveWithdrawalEdits(db, f.id, cmd, actor)).rejects.toThrow();
    const results = await Promise.allSettled([saveWithdrawalEdits(db, f.id, saveCommand(f.entryId), actor), saveWithdrawalEdits(db, f.id, saveCommand(f.entryId), actor)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect((await readWithdrawalEdits(db, f.id)).editRevision).toBe(1);
  });
  it("rolls back on audit failure and rechecks state inside the write batch", async () => {
    const f = await fixture(), cmd = saveCommand(f.entryId);
    await db.exec("CREATE TRIGGER edit_test_audit BEFORE INSERT ON audit_logs WHEN NEW.action='withdrawal_edit_saved' BEGIN SELECT RAISE(ABORT,'synthetic'); END");
    try { await expect(saveWithdrawalEdits(db, f.id, cmd, actor)).rejects.toThrow(); }
    finally { await db.exec("DROP TRIGGER edit_test_audit"); }
    expect((await readWithdrawalEdits(db, f.id)).editRevision).toBe(0);
    const proxy = new Proxy(db, { get(target, key) {
      if (key === "batch") return async (statements: D1PreparedStatement[]) => {
        await db.prepare("UPDATE quiz_sets SET submission_state='open' WHERE id=?").bind(f.id).run();
        return target.batch(statements);
      };
      const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
    } });
    await expect(saveWithdrawalEdits(proxy, f.id, cmd, actor)).rejects.toThrow();
    expect((await db.prepare("SELECT * FROM withdrawal_edit_revisions WHERE quiz_set_id=?").bind(f.id).all()).results).toEqual([]);
    expect((await db.prepare("SELECT * FROM audit_logs WHERE entity_id=? AND action='withdrawal_edit_saved'").bind(f.id).all()).results).toEqual([]);
  });
  it("requires Access for saved private content and enforces mutation and error boundaries", async () => {
    const f = await fixture(), url = `https://example.com/api/admin/quiz-sets/${f.id}/withdrawal-edits`, cmd = saveCommand(f.entryId);
    for (const method of ["GET", "POST", "DELETE"]) expect((await exports.default.fetch(new Request(url, { method }))).status).toBe(401);
    const access = await createAccessFixture(new Date());
    const network = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(access.jwks));
    const headers = { "Cf-Access-Jwt-Assertion": access.token, Origin: "https://example.com", "Content-Type": "application/json" };
    for (const origin of ["https://bad.invalid", "null", ""]) expect((await exports.default.fetch(new Request(url, { method: "POST", headers: { ...headers, Origin: origin }, body: JSON.stringify(cmd) }))).status).toBe(403);
    for (const [target, method, body, status] of [[url, "DELETE", undefined, 405], [url + "?x=1", "GET", undefined, 409],
      [url, "POST", { ...cmd, solution: "PRIVATE_CANARY" }, 409], [url, "POST", { text: "a".repeat(17000) }, 413]] as const) {
      const r = await exports.default.fetch(new Request(target, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) }));
      expect(r.status).toBe(status); expect(r.headers.get("Cache-Control")).toBe("private, no-store");
      expect(await r.text()).not.toMatch(/PRIVATE_CANARY|SELECT|D1_ERROR/u);
    }
    expect((await exports.default.fetch(new Request(url, { method: "POST", headers, body: "{" }))).status).toBe(400);
    expect((await exports.default.fetch(new Request(url, { method: "POST", headers: { ...headers, "Content-Type": "text/plain" }, body: JSON.stringify(cmd) }))).status).toBe(415);
    const saved = await exports.default.fetch(new Request(url, { method: "POST", headers, body: JSON.stringify(cmd) }));
    expect(saved.status).toBe(200); expect(saved.headers.get("Cache-Control")).toBe("private, no-store");
    const read = await exports.default.fetch(new Request(url, { headers }));
    expect(read.status).toBe(200); expect(read.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await read.json()).toMatchObject({ data: { editRevision: 1, requiresHumanReview: true } });
    expect(network.mock.calls.every(([input]) => String(input).includes("cloudflareaccess.com"))).toBe(true);
  });
});

describe("P5-60 withdrawal edit retention", () => {
  const savedAt = "2026-09-24T00:00:00.000Z", dueAt = "2026-10-01T00:00:00.000Z";
  it("expires all edit bodies at seven days, preserves every other app table and immutable identities, and returns 410", async () => {
    const f = await fixture(), cmd = saveCommand(f.entryId);
    await saveWithdrawalEdits(db, f.id, cmd, actor, new Date(savedAt));
    const captureOther = async () => (await capture()).filter(t => !["withdrawal_edit_revisions", "withdrawal_edit_cleanup", "audit_logs"].includes(t.name));
    const before = await captureOther();
    const original = await db.prepare("SELECT * FROM withdrawal_edit_revisions WHERE quiz_set_id=?").bind(f.id).all<{ edits_json: string; revision: number }>();
    expect((await listDraftCleanup(db, "2026-09-29T23:59:59.999Z")).items.find(i => i.sermonId === f.sermonId)).toBeUndefined();
    expect((await listDraftCleanup(db, "2026-09-30T00:00:00.000Z")).items.find(i => i.sermonId === f.sermonId)).toMatchObject({ state: "scheduled", dueAt });
    expect((await purgeExpiredDraft(db, f.sermonId, "2026-09-30T23:59:59.999Z")).outcome).toBe("not_due");
    expect((await runScheduledDraftCleanup({ DB: db }, dueAt)).outcome).toBe("disabled");
    const result = await runScheduledDraftCleanup({ DB: db, DRAFT_CLEANUP_ENABLED: "true" }, dueAt);
    expect(result).toMatchObject({ outcome: "completed", results: expect.arrayContaining([{ sermonId: f.sermonId, outcome: "purged" }]) });
    expect(await captureOther()).toEqual(before);
    expect((await db.prepare("SELECT * FROM withdrawal_edit_revisions WHERE quiz_set_id=?").bind(f.id).all()).results)
      .toEqual(original.results.map(row => ({ ...row, edits_json: "[]" })));
    const marker = await db.prepare("SELECT payload_hashes_json FROM withdrawal_edit_cleanup WHERE quiz_set_id=?").bind(f.id).first<{ payload_hashes_json: string }>();
    expect(JSON.parse(marker!.payload_hashes_json)).toEqual({ "1": await sha256Bytes(new TextEncoder().encode(original.results[0]!.edits_json)) });
    expect((await purgeExpiredDraft(db, f.sermonId, dueAt)).outcome).toBe("replayed");
    expect((await listDraftCleanup(db, dueAt)).items.find(i => i.sermonId === f.sermonId)).toMatchObject({ state: "purged", reason: "expired" });
    await expect(readWithdrawalEdits(db, f.id)).rejects.toThrow("DRAFT_EXPIRED");
    await expect(saveWithdrawalEdits(db, f.id, cmd, actor)).rejects.toThrow("DRAFT_EXPIRED");
    await expect(saveWithdrawalEdits(db, f.id, saveCommand(f.entryId, 1), actor)).rejects.toThrow("DRAFT_EXPIRED");
    await expect(previewWithdrawalEdits(db, f.id, { ...command(f.entryId), expectedEditRevision: 1 })).rejects.toThrow("DRAFT_EXPIRED");
    for (const sql of ["UPDATE withdrawal_edit_revisions SET edits_json='[{}]' WHERE quiz_set_id=?", "UPDATE withdrawal_edit_revisions SET request_sha256='bad' WHERE quiz_set_id=?", "DELETE FROM withdrawal_edit_cleanup WHERE quiz_set_id=?"])
      await expect(db.prepare(sql).bind(f.id).run()).rejects.toThrow();
    const access = await createAccessFixture(new Date()); vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(access.jwks));
    const headers = { "Cf-Access-Jwt-Assertion": access.token, Origin: "https://example.com", "Content-Type": "application/json" };
    for (const [route, method, body] of [["withdrawal-edits", "GET", undefined], ["withdrawal-edits", "POST", cmd], ["withdrawal-preview", "POST", command(f.entryId)]] as const) {
      const response = await exports.default.fetch(new Request(`https://example.com/api/admin/quiz-sets/${f.id}/${route}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) }));
      expect(response.status).toBe(410); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(await response.json()).toMatchObject({ error: { code: "DRAFT_EXPIRED" } });
    }
    expect((await db.prepare("SELECT * FROM audit_logs WHERE entity_id=? AND action='withdrawal_edits_purged'").bind(f.id).all()).results).toHaveLength(1);
  });
  it("uses the last edit for the whole work and rejects a save that races expiry", async () => {
    const f = await fixture(); await saveWithdrawalEdits(db, f.id, saveCommand(f.entryId), actor, new Date(savedAt));
    const second = saveCommand(f.entryId, 1);
    await saveWithdrawalEdits(db, f.id, second, actor, new Date("2026-09-30T00:00:00.000Z"));
    expect((await purgeExpiredDraft(db, f.sermonId, dueAt)).outcome).toBe("not_due");
    const readAt = "2026-10-07T00:00:00.000Z";
    const proxy = new Proxy(db, { get(target, key) {
      if (key === "batch") return async (statements: D1PreparedStatement[]) => {
        await saveWithdrawalEdits(db, f.id, saveCommand(f.entryId, 2), actor, new Date(readAt));
        return target.batch(statements);
      };
      const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
    } });
    await expect(purgeExpiredDraft(proxy, f.sermonId, readAt)).rejects.toThrow();
    expect((await readWithdrawalEdits(db, f.id)).editRevision).toBe(3);
    expect(await db.prepare("SELECT * FROM withdrawal_edit_cleanup WHERE quiz_set_id=?").bind(f.id).first()).toBeNull();
    const saveProxy = new Proxy(db, { get(target, key) {
      if (key === "batch") return async (statements: D1PreparedStatement[]) => {
        await purgeExpiredDraft(db, f.sermonId, "2026-10-14T00:00:00.000Z");
        return target.batch(statements);
      };
      const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
    } });
    await expect(saveWithdrawalEdits(saveProxy, f.id, saveCommand(f.entryId, 3), actor)).rejects.toThrow();
    expect((await db.prepare("SELECT count(*) n FROM withdrawal_edit_revisions WHERE quiz_set_id=?").bind(f.id).first())).toEqual({ n: 3 });
  });
  it("rolls back body expiry and marker when its audit fails", async () => {
    const f = await fixture(); await saveWithdrawalEdits(db, f.id, saveCommand(f.entryId), actor, new Date(savedAt));
    const before = await readWithdrawalEdits(db, f.id);
    await db.exec("CREATE TRIGGER cleanup_test_audit BEFORE INSERT ON audit_logs WHEN NEW.action='withdrawal_edits_purged' BEGIN SELECT RAISE(ABORT,'synthetic'); END");
    try { await expect(purgeExpiredDraft(db, f.sermonId, dueAt)).rejects.toThrow(); }
    finally { await db.exec("DROP TRIGGER cleanup_test_audit"); }
    expect(await readWithdrawalEdits(db, f.id)).toEqual(before);
    expect(await db.prepare("SELECT * FROM withdrawal_edit_cleanup WHERE quiz_set_id=?").bind(f.id).first()).toBeNull();
  });
});
