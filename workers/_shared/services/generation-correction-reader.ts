import { createDatabase } from "../db/client";
import { createGenerationLifecycleStore } from "../repositories/generation-lifecycle-store";
import { createSermonInputStore } from "../repositories/sermon-input-store";
import { createSermonMetadataRepository } from "../repositories/sermon-metadata-repository";
import { generationAuthoritySnapshotSchema, type GenerationAuthoritySnapshot } from "./generation-bridge-contract";
import { sameLifecycleValue } from "./generation-context-codec";
import type { GenerationContext } from "./generation-lifecycle-contract";
import { transcriptSourcePayloadSchema } from "./transcript-input-contract";
import { verifySource } from "./transcript-content";
import { withinTranscriptCharacterLimit } from "./transcript-character-limit";
import { createSermonInputService } from "./sermon-input";

/** Correction uses only selected input and metadata; it never reads or rewrites
 * historical content. Existing content is captured by its head for the CAS. */
export async function readCorrectionAuthority(db: D1Database, owner: {
  jobId: string; sermonId: string; quizSetId: string;
}, existing?: GenerationAuthoritySnapshot) {
  const store = createSermonInputStore(db);
  const inputService = createSermonInputService(store);
  const head = await store.head(owner.sermonId);
  const selected = await inputService.current(owner.sermonId);
  const metadataStore = createSermonMetadataRepository(createDatabase(db));
  const metadata = await metadataStore.read(owner.sermonId);
  const quiz = await db.prepare("SELECT sermon_id,status FROM quiz_sets WHERE id=?").bind(owner.quizSetId)
    .first<{ sermon_id: string; status: string }>();
  if (!head || selected.outcome !== "loaded" || !selected.input || !metadata ||
    quiz?.sermon_id !== owner.sermonId || !["draft", "needs_revision", "review_ready"].includes(quiz.status)) {
    throw new Error("GENERATION_INPUT_NOT_READY");
  }
  const source = await store.event(owner.sermonId, head.source_id);
  if (!source || source.kind !== "source" || !head.source_type.startsWith("caption_")) throw new Error("GENERATION_INPUT_READ_ONLY");
  const rawSource = transcriptSourcePayloadSchema.parse(await store.payload(source));
  await verifySource(rawSource);
  if (!withinTranscriptCharacterLimit(selected.input.content.format === "plain_text"
    ? selected.input.content.text : selected.input.content.segments)) throw new Error("GENERATION_INPUT_TOO_LARGE");
  const sourceSha256 = rawSource.sourceMode === "public_unofficial" ? rawSource.sourceSha256 : rawSource.rawTranscriptSha256;
  const contentHead = await db.prepare("SELECT event_count,last_event_id FROM sermon_content_heads WHERE sermon_id=?")
    .bind(owner.sermonId).first<{ event_count: number; last_event_id: string }>();
  // Correction never consumes semantic content. Its context records only the
  // head identity; no selected content is asserted by this input-only reader.
  const content: GenerationAuthoritySnapshot["content"] = contentHead ? {
    state: "present", eventCount: contentHead.event_count, lastEventId: contentHead.last_event_id,
    intent: null, summary: null, child: null, adult: null,
  } : { state: "absent" };
  const references: GenerationContext["references"] = [];
  for (const eventId of new Set([head.source_id, head.document_id, head.confirmation_id].filter((id): id is string => id !== null))) {
    const record = await store.event(owner.sermonId, eventId);
    if (!record) throw new Error("GENERATION_INPUT_CORRUPT");
    references.push({ sermonId: owner.sermonId, eventId, kind: "input",
      ...(eventId === head.source_id && sourceSha256 !== source.document_sha256 ? { sourceSha256 } : {}),
      sha256: eventId === head.source_id || eventId === head.document_id ? record.document_sha256 : record.payload_sha256 });
  }
  if (contentHead) {
    const row = await db.prepare("SELECT payload_sha256 FROM sermon_content_events WHERE sermon_id=? AND event_id=? AND state='sealed'")
      .bind(owner.sermonId, contentHead.last_event_id).first<{ payload_sha256: string }>();
    if (!row) throw new Error("GENERATION_CONTENT_CORRUPT");
    references.push({ sermonId: owner.sermonId, eventId: contentHead.last_event_id, kind: "content", sha256: row.payload_sha256 });
  }
  const job = await createGenerationLifecycleStore(db).readJob(owner.jobId);
  if (!["present", "absent"].includes(job.outcome)) throw new Error("GENERATION_JOB_UNAVAILABLE");
  if (job.outcome === "present" && (job.value.sermon_id !== owner.sermonId || job.value.quiz_set_id !== owner.quizSetId ||
    job.value.request_scope !== "transcript_correction")) throw new Error("GENERATION_JOB_CONFLICT");
  const snapshot = generationAuthoritySnapshotSchema.parse({ contractVersion: 1, ...owner,
    scope: "transcript_correction", jobStateVersion: job.outcome === "present" ? job.value.state_version : 0,
    status: job.outcome === "present" ? job.value.status : "dispatch_pending", wait: null,
    input: { state: "present", version: head.version, sourceId: head.source_id, sourceRevision: source.version,
      sourceSha256, documentId: head.document_id, documentSha256: head.document_sha256,
      checksumFormat: "sha256:utf8-working-text:v1", confirmationId: head.confirmation_id,
      sourceKind: "caption", coverage: selected.input.source.sourceMode === "manual_paste" &&
        selected.input.source.sourceCoverage === "partial_notes" ? "partial" : "full" },
    content, metadata, selection: { state: "unavailable" },
  });
  const again = await store.head(owner.sermonId);
  const metadataAgain = await metadataStore.read(owner.sermonId);
  const contentAgain = await db.prepare("SELECT event_count,last_event_id FROM sermon_content_heads WHERE sermon_id=?")
    .bind(owner.sermonId).first();
  if (!sameLifecycleValue(again, head) || !sameLifecycleValue(metadata, metadataAgain) || !sameLifecycleValue(contentHead, contentAgain) ||
    selected.input.version !== head.version || selected.input.documentSha256 !== head.document_sha256 ||
    existing && (!sameLifecycleValue(existing.input, snapshot.input) || !sameLifecycleValue(existing.content, snapshot.content) ||
      !sameLifecycleValue(existing.metadata, snapshot.metadata))) throw new Error("GENERATION_AUTHORITY_CHANGED");
  return { snapshot, references, transcript: selected.input.content };
}
