import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { deadlineCommitSchema, deadlinePreviewSchema, deadlineProposalSchema, deadlineResultSchema, deadlineViewSchema } from "../../../shared/api/admin-deadline";
import { quizSetIdSchema } from "../../../shared/api/admin-finalization";
import { createDatabase } from "../db/client";
import { auditLogs, quizSets } from "../db/schema";
import { sha256Bytes } from "../storage/sha256";
import { createQuizFinalizationService } from "./quiz-finalization";

// One read snapshot binds confirmation to the deadline, reception, active content,
// all successful submissions (including tombstones), and intervening deadline writes.
const stateSql = `SELECT json_object('status',q.status,'closesAt',q.closes_at,'opensAt',q.opens_at,
 'archivedAt',q.archived_at,'paused',q.submission_state='paused','updatedAt',q.updated_at,
 'total',(SELECT count(*) FROM submissions s JOIN quiz_variants v ON v.id=s.quiz_variant_id WHERE v.quiz_set_id=q.id),
 'visible',(SELECT count(*) FROM submissions s JOIN quiz_variants v ON v.id=s.quiz_variant_id WHERE v.quiz_set_id=q.id AND s.status='visible'),
 'hidden',(SELECT count(*) FROM submissions s JOIN quiz_variants v ON v.id=s.quiz_variant_id WHERE v.quiz_set_id=q.id AND s.status='hidden'),
 'deleted',(SELECT count(*) FROM submissions s JOIN quiz_variants v ON v.id=s.quiz_variant_id WHERE v.quiz_set_id=q.id AND s.status='deleted'),
 'variants',(SELECT json_group_array(json_array(id,revision,lifecycle_status,results_status,winner_count)) FROM
   (SELECT * FROM quiz_variants WHERE quiz_set_id=q.id AND lifecycle_status='active' ORDER BY id)),
 'cases',(SELECT count(*) FROM quiz_problem_cases WHERE quiz_set_id=q.id),
 'outcomes',(SELECT count(*) FROM quiz_problem_outcomes o JOIN quiz_problem_cases c ON c.id=o.case_id WHERE c.quiz_set_id=q.id),
 'changes',(SELECT count(*) FROM audit_logs WHERE entity_id=q.id AND action='deadline_changed')) state
 FROM quiz_sets q WHERE q.id=`;
const stateSchema = z.object({ status: z.string(), closesAt: z.iso.datetime(), opensAt: z.iso.datetime(),
  archivedAt: z.string().nullable(), paused: z.number(), updatedAt: z.string(), total: z.number(), visible: z.number(), hidden: z.number(), deleted: z.number(),
  variants: z.array(z.array(z.union([z.string(), z.number()]))), cases: z.number(), outcomes: z.number(), changes: z.number() }).strict();
const tokenSchema = z.object({ scope: z.literal("quiz-deadline-v1"), id: quizSetIdSchema, state: z.string(),
  actor: z.string(), closesAt: z.iso.datetime(), reason: z.string(), immediate: z.boolean() }).strict();
const encoder = new TextEncoder();
const digest = (value: string) => sha256Bytes(encoder.encode(value));
const kst = (value: string) => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "full", timeStyle: "long" }).format(new Date(value));
const remaining = (value: string, now: Date) => Math.max(0, Math.ceil((Date.parse(value) - now.getTime()) / 1000));
const impact = (s: z.infer<typeof stateSchema>) => ({ total: s.total, visible: s.visible, hidden: s.hidden, deleted: s.deleted });
function changeable(s: z.infer<typeof stateSchema>, now: Date) {
  return s.status === "published" && s.archivedAt === null && Date.parse(s.closesAt) > now.getTime() && Date.parse(s.opensAt) <= now.getTime();
}
async function readState(db: D1Database, id: string) {
  quizSetIdSchema.parse(id);
  const row = await db.prepare(`${stateSql}?`).bind(id).first<{ state: string }>();
  if (!row) throw new Error("DEADLINE_UNAVAILABLE");
  return { text: row.state, data: stateSchema.parse(JSON.parse(row.state)) };
}
async function key(secret: string | undefined) {
  if (!secret || !/^[a-fA-F0-9]{64}$/u.test(secret)) throw new Error("DEADLINE_KEY_UNAVAILABLE");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
async function sign(value: z.infer<typeof tokenSchema>, secret: string | undefined) {
  const payload = encode(encoder.encode(JSON.stringify(value)));
  return `${payload}.${encode(new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(payload))))}`;
}
async function verify(token: string, secret: string | undefined) {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined || !await crypto.subtle.verify("HMAC", await key(secret),
    Uint8Array.from(atob(signature), c => c.charCodeAt(0)), encoder.encode(payload))) throw new Error("DEADLINE_CONFIRMATION_INVALID");
  return tokenSchema.parse(JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload), c => c.charCodeAt(0)))));
}
export async function readQuizDeadline(db: D1Database, id: string, now = new Date()) {
  const { data: s } = await readState(db, id);
  const history = await db.prepare("SELECT safe_metadata_json metadata,created_at createdAt FROM audit_logs WHERE entity_id=? AND action='deadline_changed' ORDER BY created_at DESC,id DESC").bind(id).all<{ metadata: string; createdAt: string }>();
  return deadlineViewSchema.parse({ quizSetId: id, closesAt: s.closesAt, closesAtKst: kst(s.closesAt), changeable: changeable(s, now),
    paused: !!s.paused, remainingSeconds: remaining(s.closesAt, now), impact: impact(s), history: history.results.map(h => {
      const m = JSON.parse(h.metadata); return { before: m.before, requested: m.requested, after: m.after, reason: m.reason, immediate: m.immediate, createdAt: h.createdAt };
    }) });
}
export async function previewQuizDeadline(db: D1Database, id: string, raw: unknown, actor: string, secret: string | undefined, now = new Date()) {
  const proposal = deadlineProposalSchema.parse(raw), s = await readState(db, id);
  if (!changeable(s.data, now) || proposal.closesAt === s.data.closesAt) throw new Error("DEADLINE_UNAVAILABLE");
  const immediate = Date.parse(proposal.closesAt) <= now.getTime();
  return deadlinePreviewSchema.parse({ quizSetId: id, previousClosesAt: s.data.closesAt, previousKst: kst(s.data.closesAt),
    requestedClosesAt: proposal.closesAt, requestedKst: kst(proposal.closesAt), remainingSeconds: remaining(s.data.closesAt, now),
    newRemainingSeconds: remaining(proposal.closesAt, now), immediate, paused: !!s.data.paused, impact: impact(s.data),
    confirmationToken: await sign({ scope: "quiz-deadline-v1", id, state: s.text, actor: await digest(actor), ...proposal, immediate }, secret) });
}
export async function changeQuizDeadline(db: D1Database, id: string, raw: unknown, actor: string, secret: string | undefined, now = new Date()) {
  quizSetIdSchema.parse(id);
  const command = deadlineCommitSchema.parse(raw), token = await verify(command.confirmationToken, secret);
  if (token.id !== id || token.actor !== await digest(actor) || token.closesAt !== command.closesAt || token.reason !== command.reason ||
    command.confirmation !== (token.immediate ? "close_now" : "change_deadline")) throw new Error("DEADLINE_CONFIRMATION_INVALID");
  const auditId = `deadline-${command.requestKey}`, requestHash = await digest(JSON.stringify(command));
  async function replay(outcome: "changed" | "replayed") {
    const row = await db.prepare("SELECT entity_id id,actor_email actor,safe_metadata_json metadata FROM audit_logs WHERE id=? AND action='deadline_changed'")
      .bind(auditId).first<{ id: string; actor: string; metadata: string }>();
    if (!row) return null;
    const m = JSON.parse(row.metadata);
    if (row.id !== id || row.actor !== actor || m.requestHash !== requestHash) throw new Error("DEADLINE_REQUEST_CONFLICT");
    return deadlineResultSchema.parse({ quizSetId: id, closesAt: m.after, archived: m.immediate, outcome });
  }
  const prior = await replay("replayed"); if (prior) return prior;
  const expected = stateSchema.parse(JSON.parse(token.state)), at = now.toISOString();
  if (!changeable(expected, now) || (!token.immediate && Date.parse(command.closesAt) <= now.getTime())) throw new Error("DEADLINE_CONFIRMATION_STALE");
  const after = token.immediate ? at : command.closesAt, database = createDatabase(db);
  // This NOT NULL audit insert is the transaction's compare-and-swap gate. A stale
  // confirmation aborts the entire batch, including finalization, without a schema change.
  const guardAudit = database.insert(auditLogs).values({ id: auditId, entityType: "quiz_set",
    entityId: sql`(SELECT id FROM quiz_sets WHERE id=${id} AND status='published' AND archived_at IS NULL AND closes_at>${at}
      AND (${sql.raw(stateSql)}${id})=${token.state})`,
    action: "deadline_changed", actorType: "access_admin", actorEmail: actor, createdAt: at,
    safeMetadataJson: { before: expected.closesAt, requested: command.closesAt, after, reason: command.reason, immediate: token.immediate, requestHash,
      ...impact(expected) } });
  try {
    if (token.immediate) {
      await createQuizFinalizationService(database, { beforeCloseNow: [guardAudit] }).closeQuizSetNow(id,
        { actorEmail: actor, auditId: crypto.randomUUID(), reason: command.reason }, now);
    } else {
      await database.batch([guardAudit, database.update(quizSets).set({ closesAt: after, updatedAt: at }).where(eq(quizSets.id, id))]);
    }
  } catch (error) {
    const raced = await replay("replayed"); if (raced) return raced;
    throw error;
  }
  const result = await replay("changed");
  if (!result) throw new Error("DEADLINE_UNAVAILABLE");
  return result;
}
