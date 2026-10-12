import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import fixtureSql from "../../scripts/fixtures/p9-15-preview.sql?raw";
import { buildPreviewDemo, demoNow } from "../../scripts/p9-15-preview-fixture";
import { createDatabase } from "../_shared/db/client";
import { createPublicQuizRepository } from "../_shared/repositories/public-quiz-repository";
import { createParticipationBoardRepository } from "../_shared/repositories/participation-board-repository";
import { createSermonInputStore } from "../_shared/repositories/sermon-input-store";
import { createSermonInputService } from "../_shared/services/sermon-input";
import { readSermonDraft, saveSermonDraft } from "../_shared/services/sermon-drafts";
import { readWeeklyDashboard, listAdminSubmissions, listPrivacyRequests, replyPrivacyRequest } from "../_shared/services/admin-weekly";

it("loads all demo views, preserves prior records, rejects repeat import and supports draft and request edits", async () => {
  const db = (env as Env).DB, data = await buildPreviewDemo();
  const statements = fixtureSql.split("\n").filter(s => s.trim() && !s.startsWith("--"));
  await db.prepare("INSERT INTO site_state(key,value,updated_at) VALUES('p915-preserve','unchanged',?)").bind(demoNow).run();
  const prior = await db.prepare("SELECT * FROM site_state ORDER BY key").all();
  await db.batch(statements.map(s => db.prepare(s)));
  expect(await db.prepare("PRAGMA foreign_key_check").all()).toMatchObject({ results: [] });
  expect(await db.prepare("SELECT * FROM site_state ORDER BY key").all()).toMatchObject({ results: prior.results });
  const count = await db.prepare("SELECT count(*) n FROM sermons").first();
  await expect(db.batch(statements.map(s => db.prepare(s)))).rejects.toThrow();
  expect(await db.prepare("SELECT count(*) n FROM sermons").first()).toEqual(count);
  const database = createDatabase(db);
  for (const p of data.puzzles) {
    const view = await createPublicQuizRepository(database).read({ slug: p.slug }, p.difficulty, new Date(demoNow));
    expect(view.quiz?.variant.difficulty).toBe(p.difficulty);
    expect(view.quiz?.status).toBe(p.status);
    expect(JSON.stringify(view)).not.toContain('"solution"');
    if (p.status === "archived") {
      const board = await createParticipationBoardRepository(database).read({ grid: p.grid, quizRevision: 1, quizStatus: "archived", quizVariantId: p.variantId, scoringSource: { canonicalCellOrder: p.canonical, solution: p.solution } });
      expect(board.participants).toHaveLength(3);
      expect(board.winners).toHaveLength(2);
      expect(board.participants.filter(s => s.isFullyCorrect)).toHaveLength(2);
    }
  }
  const dashboard = await readWeeklyDashboard(db, new Date(demoNow));
  const publicHome = await createPublicQuizRepository(database).read("latest", "child", new Date(demoNow));
  const live = data.manifest.find(q => q.status === "published")!;
  expect(publicHome.quiz?.slug).toBe(live.slug);
  expect(dashboard.homeQuiz).toEqual({ quizSetId: live.quizSetId, selection: "automatic" });
  expect(dashboard.items.filter(s => s.title.startsWith("[테스트]"))).toHaveLength(4);
  expect(dashboard.unansweredCount).toBe(2);
  for (const s of data.manifest.filter(s => s.status === "archived")) {
    expect((await listAdminSubmissions(db, s.quizSetId)).items).toHaveLength(6);
  }
  const draft = data.manifest[0]!;
  expect((await readSermonDraft(db, draft.sermonId)).title).toBe(draft.title);
  const saved = await saveSermonDraft(db, draft.sermonId, { expectedRevision: 1, title: draft.title + " 수정", sermonDate: draft.date, referenceInput: "요한복음 3:16", confirmed: true });
  expect(saved.metadataRevision).toBe(2);
  const input = createSermonInputService(createSermonInputStore(db)), current = await input.current(draft.sermonId);
  if (current.outcome !== "loaded" || !current.input || current.input.content.format !== "plain_text") throw new Error("missing input");
  const v = current.input;
  const edited = await input.execute(draft.sermonId, { action: "edit", expectedVersion: v.version, sourceId: v.sourceId, documentId: v.documentId, documentSha256: v.documentSha256, content: { format: "plain_text", text: current.input.content.text + "\n저장 확인" } }, { kind: "human", adminId: "a".repeat(64), now: "2026-10-12T07:05:00.000Z" });
  expect(edited.outcome).toBe("saved");
  const requests = await listPrivacyRequests(db);
  expect(requests.items).toHaveLength(2);
  const request = requests.items[0]!;
  await replyPrivacyRequest(db, request.id, { status: "reviewing", adminResponse: "[테스트] 확인 중입니다.", expectedUpdatedAt: request.updatedAt }, "synthetic-admin@example.invalid");
  expect((await db.prepare("SELECT count(*) n FROM submissions WHERE status='visible'").first<{n:number}>())?.n).toBe(12);
  expect(await db.prepare("SELECT * FROM site_state ORDER BY key").all()).toMatchObject({ results: prior.results });
});
