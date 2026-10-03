import { revisionBodySchema, revisionCommandSchema, revisionLayoutSchema, revisionTrialSchema, revisionViewSchema, type RevisionBody, type RevisionContent, type RevisionLayout } from "../../../shared/api/admin-quiz-revision";
import { withdrawalReviewSchema, type WithdrawalView } from "../../../shared/api/admin-withdraw";
import { quizSetIdSchema } from "../../../shared/api/admin-finalization";
import { publicPuzzleGridSchema, publicSermonSchema } from "../../../shared/api/public-quiz";
import { parseBibleReference } from "../../../shared/bible-reference";
import { generatePuzzle, serializePublicPuzzle, validateAndNormalizeAnswer, validateLayout, cellId, coordinateFor } from "../../../shared/puzzle";
import { validateScoringSource } from "./submission-scoring";
import { checkWithdrawalVariant } from "./withdrawal-preview";
import { sha256Bytes } from "../storage/sha256";
import { WithdrawalEditsExpired } from "./withdrawal-edit-cleanup";
import { publishQuizRevision } from "./quiz-republication";

type Source = WithdrawalView["review"];
export type Session = { id: string; quizSetId: string; cycle: number; reviewRevision: number; source: string; publishedAt: string; displayRevision: number; createdAt: string; reason: string };
export const hashRevision = (value: unknown) => sha256Bytes(new TextEncoder().encode(JSON.stringify(value)));
export const revisionSessionSelection = `SELECT id,quiz_set_id quizSetId,cycle,review_revision reviewRevision,source_json source,published_at publishedAt,display_revision displayRevision,created_at createdAt,reason FROM quiz_revision_sessions`;
export async function latestRevisionSession(db: D1Database, id: string) {
  return db.prepare(`${revisionSessionSelection} WHERE quiz_set_id=? ORDER BY cycle DESC LIMIT 1`).bind(id).first<Session>();
}
export function revisionAudit(db: D1Database, id: string, action: string, actor: string, at: string, metadata: unknown) {
  return db.prepare(`INSERT INTO audit_logs(id,entity_type,entity_id,action,actor_type,actor_email,safe_metadata_json,created_at)
    VALUES(?,'quiz_set',?,?,'access_admin',?,?,?)`).bind(crypto.randomUUID(), id, action, actor, JSON.stringify(metadata), at);
}
export function sourceToBody(source: Source): RevisionBody {
  const entries = (level: "child" | "adult") => source.variants.find(v => v.difficulty === level)!.entries.map(e => ({
    id: e.id, answer: source.variants.find(v => v.difficulty === level)!.entryAnswers[e.id]!, clue: e.clue, evidence: "",
  }));
  const layouts = Object.fromEntries(source.variants.map(v => [v.difficulty, checkWithdrawalVariant(v, []).preview]));
  return revisionBodySchema.parse({ content: { metadata: source.metadata, churchName: source.churchName, bibleReferenceLabel: source.bibleReferenceLabel,
    summary: source.summary, child: entries("child"), adult: entries("adult") }, layouts, reviewed: { summary: false, child: false, adult: false } });
}
/** Retain a chosen geometry only if every edited answer still fits and crosses correctly. */
export function refreshRevisionLayout(layout: RevisionLayout | null, entries: RevisionContent["child"]): RevisionLayout | null {
  if (!layout) return null;
  try {
    const placements = layout.grid.entries.map(e => {
      const draft = entries.find(item => item.id === e.id);
      if (!draft) throw new Error("missing");
      const answer = validateAndNormalizeAnswer({ id: e.id, displayAnswer: draft.answer, clue: draft.clue }, layout.grid.gridSize);
      if (!answer.ok || answer.value.syllables.length !== e.length) throw new Error("answer");
      return { entryId: e.id, start: e.start, direction: e.direction, gridAnswer: answer.value.gridAnswer, clue: draft.clue };
    });
    if (placements.length !== entries.length || new Set(placements.map(p => p.gridAnswer)).size !== entries.length ||
      !validateLayout(layout.grid.gridSize, placements).publishable) return null;
    const grid = publicPuzzleGridSchema.parse({ ...layout.grid, entries: layout.grid.entries.map(e => ({ ...e, clue: entries.find(d => d.id === e.id)!.clue })) });
    const solution = { cells: Object.fromEntries(placements.flatMap(p => Array.from(p.gridAnswer, (letter, i) => [cellId(coordinateFor(p, i)), letter]))),
      entries: Object.fromEntries(placements.map(p => [p.entryId, p.gridAnswer])) };
    validateScoringSource({ grid, solution, canonicalCellOrder: grid.cells.map(c => c.id) });
    return revisionLayoutSchema.parse({ grid, solution });
  } catch { return null; }
}
export function checkRevisionBody(body: RevisionBody, source: Source): string[] {
  const issues: string[] = [];
  if (!parseBibleReference(body.content.bibleReferenceLabel).ok) issues.push("성경 장절을 확인해 주세요.");
  if (!publicSermonSchema.safeParse({ title: body.content.metadata.title, date: body.content.metadata.sermonDate,
    churchName: body.content.churchName, bibleReferenceLabel: body.content.bibleReferenceLabel, translation: source.translation,
    bibleReadingUrl: source.bibleReadingUrl, summary: { text: body.content.summary, disclosure: source.disclosure } }).success) issues.push("설교 정보·요약·고지를 확인해 주세요.");
  for (const level of ["child", "adult"] as const) {
    const original = source.variants.find(v => v.difficulty === level)!;
    const entries = body.content[level];
    if (entries.length !== original.entries.length || new Set(entries.map(e => e.id)).size !== entries.length || entries.some(e => !original.entries.some(o => o.id === e.id))) issues.push(`${level}: 문제 구성이 원본과 일치하지 않습니다.`);
    for (const e of entries) {
      const prior = original.entries.find(o => o.id === e.id);
      if (prior && (e.answer !== original.entryAnswers[e.id] || e.clue !== prior.clue) && !e.evidence.trim()) issues.push(`${level}: 수정한 답·단서의 관리자 근거를 적어 주세요.`);
    }
    const checked = refreshRevisionLayout(body.layouts[level], entries);
    if (!checked || JSON.stringify(checked.grid) !== JSON.stringify(body.layouts[level]?.grid) || checked && Object.entries(checked.solution.cells).some(([key,value]) => body.layouts[level]?.solution.cells[key] !== value) || checked && Object.entries(checked.solution.entries).some(([key,value]) => body.layouts[level]?.solution.entries[key] !== value)) issues.push(`${level}: 현재 답·단서로 배치를 다시 확인해 주세요.`);
  }
  return [...new Set(issues)];
}
export async function readQuizRevision(db: D1Database, id: string) {
  quizSetIdSchema.parse(id);
  const session = await latestRevisionSession(db, id);
  const old = session ? null : await db.prepare("SELECT review_json source FROM quiz_withdrawals WHERE quiz_set_id=?").bind(id).first<{ source: string }>();
  if (!session && !old) throw new Error("REVISION_UNAVAILABLE");
  const source = withdrawalReviewSchema.parse(JSON.parse(session?.source ?? old!.source));
  const current = session ? await db.prepare(`SELECT d.revision,d.body_json body,d.created_at savedAt,c.purged_at purgedAt,
    p.published_at publishedAt,p.closes_at closesAt FROM quiz_revision_sessions s
    LEFT JOIN quiz_revision_drafts d ON d.session_id=s.id AND d.revision=(SELECT max(revision) FROM quiz_revision_drafts WHERE session_id=s.id)
    LEFT JOIN quiz_revision_cleanup c ON c.session_id=s.id LEFT JOIN quiz_republications p ON p.session_id=s.id WHERE s.id=?`).bind(session.id)
    .first<{ revision: number | null; body: string | null; savedAt: string | null; purgedAt: string | null; publishedAt: string | null; closesAt: string | null }>() : null;
  const body = current?.body && !current.purgedAt ? revisionBodySchema.parse(JSON.parse(current.body)) : null;
  const issues = body ? checkRevisionBody(body, source) : [];
  const state = current?.publishedAt ? "published" : current?.purgedAt ? "expired" : session ? "editing" : "not_started";
  return revisionViewSchema.parse({ quizSetId: id, sessionId: session?.id ?? null, cycle: session?.cycle ?? 0,
    revision: current?.revision ?? 0, state, body,
    sourceEvidence: Object.fromEntries(source.variants.flatMap(v => v.entries.map(e => [e.id,e.grounding]))),
    slug: source.slug, disclosure: source.disclosure, translation: source.translation, bibleReadingUrl: source.bibleReadingUrl,
    issues, canPublish: state === "editing" && !!body && !issues.length && Object.values(body.reviewed).every(Boolean),
    savedAt: current?.savedAt ?? null, publication: current?.publishedAt ? { publishedAt: current.publishedAt, closesAt: current.closesAt } : null });
}
export async function requireQuizRevision(db: D1Database, id: string, sessionId: string, revision: number) {
  const view = await readQuizRevision(db, id);
  if (view.state === "expired") throw new WithdrawalEditsExpired();
  if (view.state !== "editing" || view.sessionId !== sessionId || view.revision !== revision || !view.body) throw new Error("REVISION_STALE");
  const session = await latestRevisionSession(db,id);
  if (!session || session.id !== sessionId) throw new Error("REVISION_STALE");
  return { view, body: view.body, session };
}
export async function startQuizRevision(db: D1Database, id: string, raw: unknown, actorEmail: string, now = new Date()) {
  const command = revisionCommandSchema.parse(raw);
  if (command.action !== "start") throw new Error("REVISION_INVALID");
  const actor = await hashRevision(actorEmail), requestHash = await hashRevision(command), at = now.toISOString();
  const prior = await db.prepare("SELECT quiz_set_id quizSetId,request_sha256 hash,actor_digest actor FROM quiz_revision_sessions WHERE id=?").bind(command.requestKey).first<{ quizSetId: string; hash: string; actor: string }>();
  if (prior) {
    if (prior.quizSetId !== id || prior.hash !== requestHash || prior.actor !== actor) throw new Error("REVISION_CONFLICT");
    return readQuizRevision(db,id);
  }
  const view = await readQuizRevision(db,id), previous = await latestRevisionSession(db,id);
  if (view.cycle !== command.expectedCycle || !["not_started","expired"].includes(view.state)) throw new Error("REVISION_STALE");
  const old = await db.prepare("SELECT review_json source,review_revision revision,published_at publishedAt,display_revision displayRevision,reason FROM quiz_withdrawals WHERE quiz_set_id=?").bind(id)
    .first<{ source: string; revision: number; publishedAt: string; displayRevision: number; reason: string }>();
  if (!old) throw new Error("REVISION_UNAVAILABLE");
  const sourceJson = previous?.source ?? old.source, source = withdrawalReviewSchema.parse(JSON.parse(sourceJson));
  const body = sourceToBody(source);
  // Carry forward the earlier P5-60 saved work once; an expired cycle restarts from its permanent withdrawal source.
  let legacyBody: string | null = null;
  if (!previous) {
    const legacy = await db.prepare(`SELECT edits_json edits FROM withdrawal_edit_revisions WHERE quiz_set_id=?
      AND NOT EXISTS(SELECT 1 FROM withdrawal_edit_cleanup WHERE quiz_set_id=?) ORDER BY revision DESC LIMIT 1`).bind(id,id).first<{ edits: string }>();
    legacyBody = legacy?.edits ?? null;
    if (legacy) {
      const { withdrawalEditsSchema } = await import("../../../shared/api/admin-withdrawal-preview");
      for (const e of withdrawalEditsSchema.parse(JSON.parse(legacy.edits))) {
        const entry = body.content[e.difficulty].find(v => v.id === e.entryId);
        if (!entry) throw new Error("REVISION_INVALID");
        if (e.answer !== undefined) entry.answer = e.answer;
        if (e.clue !== undefined) entry.clue = e.clue;
      }
      for (const level of ["child","adult"] as const) body.layouts[level] = refreshRevisionLayout(body.layouts[level],body.content[level]);
    }
  }
  await db.batch([
    db.prepare(`INSERT INTO quiz_revision_sessions(id,quiz_set_id,cycle,kind,review_revision,published_at,display_revision,source_json,request_sha256,actor_digest,reason,created_at)
      SELECT ?,?,?,'start',?,?,?,?,?,?,?,? WHERE ?=1 OR
      (SELECT edits_json FROM withdrawal_edit_revisions WHERE quiz_set_id=? AND NOT EXISTS(SELECT 1 FROM withdrawal_edit_cleanup WHERE quiz_set_id=?) ORDER BY revision DESC LIMIT 1) IS ?`).bind(command.requestKey,id,view.cycle+1,previous?.reviewRevision ?? old.revision,
        previous?.publishedAt ?? old.publishedAt,previous?.displayRevision ?? old.displayRevision,sourceJson,requestHash,actor,previous?.reason ?? old.reason,at,previous ? 1 : 0,id,id,legacyBody),
    draftStatement(db,command.requestKey,1,command.requestKey,requestHash,actor,"start",body,await hashRevision(body),at),
    revisionAudit(db,id,"revision_started",actorEmail,at,{ cycle: view.cycle+1 }),
  ]);
  return readQuizRevision(db,id);
}
export function draftStatement(db: D1Database, sessionId: string, revision: number, key: string, requestHash: string, actor: string,
  kind: string, body: RevisionBody, bodyHash: string, at: string) {
  return db.prepare(`INSERT INTO quiz_revision_drafts(session_id,revision,request_key,request_sha256,actor_digest,kind,body_json,body_sha256,created_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).bind(sessionId,revision,key,requestHash,actor,kind,JSON.stringify(body),bodyHash,at);
}
export async function executeQuizRevision(db: D1Database, id: string, raw: unknown, actorEmail: string, now = new Date()) {
  quizSetIdSchema.parse(id);
  const command = revisionCommandSchema.parse(raw);
  if (command.action === "start") return startQuizRevision(db,id,command,actorEmail,now);
  if (command.action === "publish") return publishQuizRevision(db,id,command,actorEmail,now);
  const actor = await hashRevision(actorEmail), requestHash = await hashRevision(command);
  if (command.action !== "trial") {
    const prior = await db.prepare(`SELECT d.request_sha256 hash,d.actor_digest actor,s.quiz_set_id quizSetId,c.session_id purged FROM quiz_revision_drafts d
      JOIN quiz_revision_sessions s ON s.id=d.session_id LEFT JOIN quiz_revision_cleanup c ON c.session_id=s.id WHERE d.session_id=? AND d.request_key=?`)
      .bind(command.sessionId,command.requestKey).first<{ hash: string; actor: string; quizSetId: string; purged: string | null }>();
    if (prior) {
      if (prior.purged) throw new WithdrawalEditsExpired();
      if (prior.hash !== requestHash || prior.actor !== actor || prior.quizSetId !== id) throw new Error("REVISION_CONFLICT");
      return readQuizRevision(db,id);
    }
  }
  const { body, session } = await requireQuizRevision(db,id,command.sessionId,command.expectedRevision);
  const source = withdrawalReviewSchema.parse(JSON.parse(session.source));
  const result = changeRevisionBody(body,source,command);
  if (command.action === "trial") return result!;
  const at = now.toISOString();
  await db.batch([
    draftStatement(db,session.id,command.expectedRevision+1,command.requestKey,requestHash,actor,command.action,body,await hashRevision(body),at),
    revisionAudit(db,id,`revision_${command.action}`,actorEmail,at,{ cycle: session.cycle, revision: command.expectedRevision+1 }),
  ]);
  return readQuizRevision(db,id);
}

/** Shared pure editing/checking pipeline; persistence and lifecycle guards stay separate. */
export function changeRevisionBody(body: RevisionBody, source: Source, command: Exclude<ReturnType<typeof revisionCommandSchema.parse>, { action: "start" | "publish" }>) {
  if (command.action === "save") {
    for (const level of ["child","adult"] as const) {
      const original = source.variants.find(v => v.difficulty === level)!;
      if (command.content[level].length !== original.entries.length || new Set(command.content[level].map(e => e.id)).size !== original.entries.length ||
        command.content[level].some(e => !original.entries.some(o => o.id === e.id))) throw new Error("REVISION_INVALID");
      body.layouts[level] = refreshRevisionLayout(body.layouts[level],command.content[level]);
    }
    body.content = command.content;
    body.reviewed = { summary: false, child: false, adult: false };
  } else if (command.action === "trial" || command.action === "layout") {
    const generated = generatePuzzle({ gridSize: command.gridSize, seed: command.seed, searchBudget: 10_000,
      candidates: body.content[command.difficulty].map(e => ({ id: e.id, displayAnswer: e.answer, clue: e.clue })) });
    const layout = generated.ok ? revisionLayoutSchema.parse({ grid: serializePublicPuzzle(generated.puzzle), solution: generated.puzzle.solution }) : null;
    if (command.action === "trial") return revisionTrialSchema.parse({ difficulty: command.difficulty, gridSize: command.gridSize, seed: command.seed, layout,
      issues: generated.ok ? [] : generated.reasons.map(r => r.message) });
    if (!layout) throw new Error("LAYOUT_UNAVAILABLE");
    body.layouts[command.difficulty] = layout;
    body.reviewed = { summary: false, child: false, adult: false };
  } else {
    const issues = checkRevisionBody(body,source);
    if (issues.length) throw new Error("REVISION_INVALID");
    body.reviewed[command.area] = true;
  }
  revisionBodySchema.parse(body);
}
