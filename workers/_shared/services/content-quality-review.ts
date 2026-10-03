import { contentQualityDataSchema, contentQualityRequestSchema, contentQualityReviewSchema } from "../../../shared/api/admin-content-quality";
import { generationAggregateVersion } from "./generation-bridge";
import { readIntentDomain } from "./generation-domain-reader";
import { lifecycleDigest } from "./generation-lifecycle-contract";
import { sha256Bytes } from "../storage/sha256";

type Owner = { jobId: string; sermonId: string; quizSetId: string };
type Row = { revision: number; scope: string; status: string; criteria_json: string; admin_note: string | null;
  edited_revision_id: string | null; created_at: string; actor_digest: string; quiz_set_id: string;
  request_sha256?: string };
const latestSql = `SELECT revision,scope,status,criteria_json,admin_note,edited_revision_id,created_at,actor_digest,quiz_set_id
  FROM sermon_content_quality_reviews WHERE sermon_id=? AND snapshot_event_id=? ORDER BY revision DESC LIMIT 1`;
function project(targetSnapshotId: string, row: Row) {
  return contentQualityReviewSchema.parse({ targetSnapshotId, revision: row.revision, scope: row.scope, status: row.status,
    criteria: JSON.parse(row.criteria_json), adminNote: row.admin_note, editedRevisionId: row.edited_revision_id, createdAt: row.created_at });
}
export async function readLatestContentQuality(db: D1Database, sermonId: string, targetIds: string[]) {
  const quality: Record<string, ReturnType<typeof project>> = {};
  await Promise.all(targetIds.map(async id => {
    const row = await db.prepare(latestSql).bind(sermonId, id).first<Row>();
    if (row) quality[id] = project(id, row);
  }));
  return quality;
}
export async function assertContentQualityUsable(db: D1Database, sermonId: string, targetIds: string[]) {
  const quality = await readLatestContentQuality(db, sermonId, targetIds);
  if (targetIds.some(id => quality[id]?.status === "regenerate")) throw new Error("CONTENT_REGENERATION_REQUIRED");
}

/** Separate from the content revision: ratings never rewrite source, selections or usage. */
export async function saveContentQualityReview(db: D1Database, owner: Owner, raw: unknown, actorDigest: string) {
  lifecycleDigest.parse(actorDigest);
  const request = contentQualityRequestSchema.parse(raw);
  if (request.scope === "intent") {
    if (Object.keys(request.criteria).length !== 5) throw new Error("QUALITY_CRITERIA_INVALID");
  } else if (Object.keys(request.criteria).length !== 0) throw new Error("QUALITY_CRITERIA_INVALID");
  const note = request.adminNote?.trim() || null;
  const normalized = { ...request, adminNote: note };
  const requestHash = await sha256Bytes(new TextEncoder().encode(JSON.stringify({ owner, actorDigest, normalized })));
  const prior = await db.prepare(`SELECT sermon_id sermonId,snapshot_event_id snapshotEventId,request_sha256 requestSha256,
    revision,scope,status,criteria_json,admin_note,edited_revision_id,created_at,actor_digest,quiz_set_id
    FROM sermon_content_quality_reviews WHERE request_key=?`).bind(request.requestKey).first<Row & { sermonId: string; snapshotEventId: string; requestSha256: string }>();
  if (prior) {
    if (prior.sermonId !== owner.sermonId || prior.snapshotEventId !== request.targetSnapshotId || prior.requestSha256 !== requestHash) throw new Error("QUALITY_REQUEST_CONFLICT");
    return contentQualityDataSchema.parse({ outcome: "replayed", review: project(request.targetSnapshotId, prior) });
  }
  const read = await readIntentDomain(db, owner, { targets: [request.targetSnapshotId] });
  const authority = read.basis.authority;
  if (generationAggregateVersion(authority) !== request.expectedVersion || authority.input.state !== "present" || authority.content.state !== "present" ||
    !["running", "awaiting_intent_review", "review_ready", "needs_revision"].includes(authority.status)) throw new Error("QUALITY_AUTHORITY_CHANGED");
  const snapshot = read.basis.snapshots.find(item => item.value.id === request.targetSnapshotId);
  if (!snapshot) throw new Error("QUALITY_SNAPSHOT_INVALID");
  const scope = snapshot.kind === "candidate" ? snapshot.value.difficulty : snapshot.kind;
  if (scope !== request.scope) throw new Error("QUALITY_SCOPE_INVALID");
  const editedRevisionId = request.status === "edited_then_use" && snapshot.value.kind === "edit" ? snapshot.value.id : null;
  if (request.status === "edited_then_use" && !editedRevisionId) throw new Error("QUALITY_EDIT_REQUIRED");
  const latest = await db.prepare(latestSql).bind(owner.sermonId, request.targetSnapshotId).first<Row>();
  const revision = (latest?.revision ?? 0) + 1;
  const createdAt = new Date().toISOString();
  await db.prepare(`INSERT INTO sermon_content_quality_reviews
    (sermon_id,snapshot_event_id,revision,quiz_set_id,request_key,request_sha256,scope,status,criteria_json,admin_note,edited_revision_id,actor_digest,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(owner.sermonId, request.targetSnapshotId, revision, owner.quizSetId,
      request.requestKey, requestHash, request.scope, request.status, JSON.stringify(request.criteria), note, editedRevisionId, actorDigest, createdAt).run();
  return contentQualityDataSchema.parse({ outcome: "saved", review: { targetSnapshotId: request.targetSnapshotId,
    revision, scope: request.scope, status: request.status, criteria: request.criteria, adminNote: note, editedRevisionId, createdAt } });
}
