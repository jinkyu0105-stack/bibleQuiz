import { env, exports } from "cloudflare:workers";
import { afterEach, expect, it, vi } from "vitest";
import { createDatabase } from "../_shared/db/client";
import { createSermonMetadataRepository } from "../_shared/repositories/sermon-metadata-repository";
import { listSermonDrafts, readSermonDraft, registerSermonDraft, saveSermonDraft } from "../_shared/services/sermon-drafts";
import { createAccessFixture } from "./test/access-fixture";
import { seedMetadataSermon } from "./test/sermon-metadata-fixture";
const db = (env as Env).DB;
const fields = { title: "합성 설교", sermonDate: "2026-09-20", referenceInput: "요 3:16-18", confirmed: true };
const command = () => ({ ...fields, video: crypto.randomUUID().replaceAll("-", "").slice(0, 11) });
const admin = "synthetic@example.invalid";
afterEach(() => vi.restoreAllMocks());

it("atomically registers, lists and reloads metadata, keeps suffix, detects duplicates without overwriting", async () => {
  const fetcher = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no external calls"));
  const input = command(), registered = await registerSermonDraft(db, input, admin);
  expect(registered.outcome).toBe("created");
  const initial = await readSermonDraft(db, registered.sermonId);
  expect(initial).toMatchObject({ title: fields.title, metadataRevision: 1, bibleReference: { canonicalLabel: "요한복음 3:16–18" } });
  expect(initial.slugPreview).toMatch(/^2026-09-20-[23456789abcdefghjkmnpqrstuvwxyz]{6}$/u);
  expect(await listSermonDrafts(db)).toMatchObject({ items: expect.arrayContaining([expect.objectContaining({ sermonId: registered.sermonId })]) });
  const original = await db.prepare("SELECT * FROM sermons WHERE id=?").bind(registered.sermonId).first();
  const saved = await saveSermonDraft(db, registered.sermonId, { ...fields, title: "새 합성 제목", sermonDate: "2026-09-21", expectedRevision: 1 });
  expect(saved.metadataRevision).toBe(2);
  expect(saved.slugPreview).toBe(initial.slugPreview.replace("2026-09-20", "2026-09-21"));
  expect(await db.prepare("SELECT * FROM sermons WHERE id=?").bind(registered.sermonId).first()).toEqual(original);
  expect(await registerSermonDraft(db, { ...input, video: `https://youtu.be/${input.video}`, title: "덮지 않음" }, admin)).toEqual({ ...registered, outcome: "existing" });
  expect((await readSermonDraft(db, registered.sermonId)).title).toBe("새 합성 제목");
  expect(await registerSermonDraft(db, command(), admin)).toMatchObject({ outcome: "created" });
  expect(fetcher).not.toHaveBeenCalled();
});

it("one concurrent registration wins and metadata uses expected revision even for no-op and ABA", async () => {
  const input = command();
  const [a, b] = await Promise.all([registerSermonDraft(db, input, admin), registerSermonDraft(db, input, admin)]);
  expect([a.outcome, b.outcome].sort()).toEqual(["created", "existing"]);
  expect(a.sermonId).toBe(b.sermonId);
  expect((await saveSermonDraft(db, a.sermonId, { ...fields, expectedRevision: 1 })).metadataRevision).toBe(1);
  const results = await Promise.allSettled(["수정 A", "수정 B"].map(title => saveSermonDraft(db, a.sermonId, { ...fields, title, expectedRevision: 1 })));
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  await expect(saveSermonDraft(db, a.sermonId, { ...fields, expectedRevision: 1 })).rejects.toMatchObject({ code: "DRAFT_CONFLICT" });
  expect((await saveSermonDraft(db, a.sermonId, { ...fields, expectedRevision: 2 })).metadataRevision).toBe(3);
});

it("rolls the whole new work back when metadata insertion fails", async () => {
  const input = command();
  await db.exec("CREATE TRIGGER p565_fail BEFORE INSERT ON sermon_metadata_drafts BEGIN SELECT RAISE(ABORT,'synthetic'); END;");
  try { await expect(registerSermonDraft(db, input, admin)).rejects.toThrow(); }
  finally { await db.exec("DROP TRIGGER p565_fail;"); }
  expect(await db.prepare("SELECT id FROM sermons WHERE youtube_video_id=?").bind(input.video).first()).toBeNull();
  expect((await registerSermonDraft(db, input, admin)).outcome).toBe("created");
});

it("explicitly initializes missing metadata and refuses ever-published and missing work", async () => {
  const id = crypto.randomUUID();
  await seedMetadataSermon(createDatabase(db), id);
  await db.prepare("INSERT INTO quiz_sets(id,sermon_id,created_by,created_at,updated_at) VALUES(?,?,?,'2026-09-20','2026-09-20')").bind(id, id, admin).run();
  expect((await readSermonDraft(db, id)).metadataRevision).toBeNull();
  expect((await saveSermonDraft(db, id, { ...fields, expectedRevision: null })).metadataRevision).toBe(1);
  { await db.prepare("UPDATE quiz_sets SET published_at='2026-09-20' WHERE id=?").bind(id).run();
    await expect(saveSermonDraft(db, id, { ...fields, title: "불가", expectedRevision: 1 })).rejects.toMatchObject({ code: "DRAFT_CONFLICT" });
    await expect(saveSermonDraft(db, id, { ...fields, expectedRevision: 1 })).rejects.toMatchObject({ code: "DRAFT_CONFLICT" });
    expect((await listSermonDrafts(db)).items.some(item => item.sermonId === id)).toBe(false);
  }
  expect((await createSermonMetadataRepository(createDatabase(db)).read(id))?.title).toBe(fields.title);
  await expect(saveSermonDraft(db, "missing", { ...fields, expectedRevision: null })).rejects.toMatchObject({ code: "DRAFT_CONFLICT" });
});

it.each([{ confirmed: false }, { referenceInput: "요 99:1" }, { sermonDate: "2026-02-30" }, { title: " " }, { extra: true }, { video: "https://evil.invalid/abcdefghijk" }])("rejects invalid registration before writing %o", async change => {
  await expect(registerSermonDraft(db, { ...command(), ...change }, admin)).rejects.toMatchObject({ code: "DRAFT_INVALID" });
});

it("Access API enforces origin, JSON, query and methods; registered work connects to input import and confirmation", async () => {
  const fixture = await createAccessFixture(new Date());
  vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
    if (String(input).startsWith("https://test-team.cloudflareaccess.com/")) return Response.json(fixture.jwks);
    throw new Error("external request forbidden");
  });
  const call = (path = "", method = "GET", body?: unknown, headers: Record<string, string> = {}) => exports.default.fetch(new Request(`https://example.com/api/admin/${path || "sermon-drafts"}`, {
    method, headers: { "Cf-Access-Jwt-Assertion": fixture.token, Origin: "https://example.com", "Content-Type": "application/json", ...headers }, ...(body ? { body: JSON.stringify(body) } : {}),
  }));
  expect((await call("", "POST", command(), { "Cf-Access-Jwt-Assertion": "" })).status).toBe(401);
  expect((await call("", "POST", command(), { Origin: "https://evil.invalid" })).status).toBe(403);
  expect((await call("", "POST", command(), { "Content-Type": "text/plain" })).status).toBe(415);
  expect((await call("sermon-drafts?extra=1")).status).toBe(400);
  expect((await call("", "DELETE")).status).toBe(405);
  const registered = await call("", "POST", command());
  expect(registered.status).toBe(200); expect(registered.headers.get("Cache-Control")).toBe("private, no-store");
  const { data: result } = await registered.json() as { data: { sermonId: string } };
  const path = `sermons/${result.sermonId}/input`;
  expect((await call(path)).status).toBe(200);
  const imported = await call(path, "POST", { expectedVersion: 0, sourceMode: "manual_paste", manualSourceKind: "youtube_visible_transcript", sourceCoverage: "full_transcript", rawTranscriptText: "합성 설교 입력자료입니다." });
  expect(imported.status).toBe(200);
  const current = await (await call(path)).json() as { data: { input: { version: number; sourceId: string; documentId: string; documentSha256: string } } };
  const input = current.data.input;
  expect((await call(path, "PATCH", { action: "confirm", expectedVersion: input.version, sourceId: input.sourceId, documentId: input.documentId, documentSha256: input.documentSha256, reviewed: true })).status).toBe(200);
  const saved = await call(`sermon-drafts/${result.sermonId}`, "PATCH", { ...fields, title: "정보 수정", expectedRevision: 1 });
  expect(saved.status).toBe(200);
  const json = JSON.stringify(await saved.json()); expect(json).not.toContain("synthetic@example"); expect(json).not.toContain("합성 설교 입력자료");
});

it("rechecks publication inside the metadata write after an editable read", async () => {
  const registered = await registerSermonDraft(db, command(), admin);
  const database = createDatabase(db);
  let intercepted = false;
  const racing = new Proxy(db, { get(target, property) {
    if (property !== "prepare") { const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value; }
    return (sql: string) => {
      const wrap = (statement: D1PreparedStatement): D1PreparedStatement => new Proxy(statement, { get(target, property) {
        if (property === "bind") return (...args: unknown[]) => wrap(target.bind(...args));
        if (property === "first" && sql.startsWith("UPDATE sermon_metadata_drafts")) return async () => {
          intercepted = true;
          await db.prepare("UPDATE quiz_sets SET published_at=? WHERE sermon_id=?").bind(new Date().toISOString(), registered.sermonId).run();
          return target.first();
        };
        const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
      } });
      return wrap(target.prepare(sql));
    };
  } });
  const current = (await createSermonMetadataRepository(database).read(registered.sermonId))!;
  expect(await createSermonMetadataRepository(database, racing).save({ sermonId: registered.sermonId, expectedRevision: 1,
    title: "경합 수정", sermonDate: current.sermonDate, bibleReference: current.bibleReference })).toEqual({ outcome: "conflict" });
  expect(intercepted).toBe(true);
  expect(await createSermonMetadataRepository(database).read(registered.sermonId)).toEqual(current);
});
