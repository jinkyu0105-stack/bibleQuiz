import { readTogether } from "../repositories/generation-read-session";
import { draftIsPurged } from "./draft-cleanup";
import { readArchivedIntentRecovery, verifyArchivedIntentRecovery } from "../repositories/archived-intent-recovery-store";
import { readPlacementSelection } from "../repositories/generation-placement-store";
import { z } from "zod";
import { createDatabase } from "../db/client";
import { createGenerationLifecycleStore } from "../repositories/generation-lifecycle-store";
import { createSermonInputStore, type InputEvent } from "../repositories/sermon-input-store";
import { createSermonMetadataRepository } from "../repositories/sermon-metadata-repository";
import { readVerifiedEvents } from "../repositories/human-content-runtime-store";
import { DOMAIN_STORAGE_BUDGET, domainStorageJson, domainTask, domainLineage } from "../repositories/generation-domain-storage";
import { generationAuthoritySnapshotSchema, type GenerationAuthoritySnapshot } from "./generation-bridge-contract";
import { type DomainBasis, type DomainSnapshot, type DomainPrepared, domainPreparedSchema } from "./generation-domain-contract";
import { prepareDomainResult, prepareHumanCommand, validateDomainBasis } from "./generation-domain";
import { sameLifecycleValue as same, fingerprintLifecycleValue } from "./generation-context-codec";
import { type GenerationContext, lifecycleId as id } from "./generation-lifecycle-contract";
import { transcriptContentSchema, transcriptSourcePayloadSchema } from "./transcript-input-contract";
import { originalContent, verifyContent, verifySource, hash, textOf } from "./transcript-content";

const currentSchema = z.strictObject({ event_count: z.int().positive(), last_event_id: id,
  selected_analysis_event_id: id.nullable(), intent_critique_event_id: id.nullable(), intent_confirmation_event_id: id.nullable(),
  summary_snapshot_event_id: id.nullable(), summary_review_event_id: id.nullable(), child_pool_event_id: id.nullable(),
  child_review_event_id: id.nullable(), adult_pool_event_id: id.nullable(), adult_review_event_id: id.nullable() });
const unavailable = (): never => { throw new Error("GENERATION_DOMAIN_NOT_READY"); };
const corrupt = (): never => { throw new Error("GENERATION_DOMAIN_CORRUPT"); };
const limit = (): never => { throw new Error("GENERATION_DOMAIN_LIMIT"); };
const reads = new WeakSet<object>(), results = new WeakSet<object>();
type DomainRead = { basis: DomainBasis; references: GenerationContext["references"]; transcript: DomainBasis["documents"][number]["content"] };
const capturedReads = new WeakMap<GenerationAuthoritySnapshot, { db: D1Database; heads: unknown; read: DomainRead }>();
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
/** The pure domain validator also accepts injected test bases. Storage requires
 * this additional, immutable D1-read witness; a caller-provided hash is no permit. */
export async function prepareReadIntentResult(basis: DomainBasis, context: DomainBasis["context"], pair: unknown, event: unknown) {
  if (!reads.has(basis)) return { outcome: "invalid" as const };
  const prepared = await prepareDomainResult({ ...basis, context }, pair, event, DOMAIN_STORAGE_BUDGET);
  if (prepared.outcome === "prepared") results.add(prepared.value);
  return prepared;
}
export async function prepareReadHumanResult(basis: DomainBasis, context: DomainBasis["context"], command: unknown, event: unknown) {
  if (!reads.has(basis)) return { outcome: "invalid" as const };
  const prepared = await prepareHumanCommand({ ...basis, context }, command, event, DOMAIN_STORAGE_BUDGET);
  if (prepared.outcome === "prepared") results.add(prepared.value);
  return prepared;
}
export function isReadIntentResult(raw: DomainPrepared): boolean { return results.has(raw); }

/** Reads sealed input, actual AI drafts and explicit human operations with their
 * bounded dependencies. Legacy synthetic envelopes are never reinterpreted as
 * domain drafts or human approval. */
export async function readIntentDomain(db: D1Database, owner: { jobId: string; sermonId: string; quizSetId: string },
  options: { scope?: "intent" | "full" | "summary" | "child" | "adult"; targets?: string[]; historyEventIds?: string[]; existing?: GenerationAuthoritySnapshot; selection?: GenerationAuthoritySnapshot["selection"] } = {}): Promise<DomainRead> {
  const inputStore = createSermonInputStore(db), lifecycle = createGenerationLifecycleStore(db);
  const metadataStore = createSermonMetadataRepository(createDatabase(db));
  async function heads() {
    const [head, content, metadata, quiz, job, purged] = await readTogether([inputStore.head(owner.sermonId),
      db.prepare(`SELECT h.event_count,h.last_event_id,c.selected_analysis_event_id,c.intent_critique_event_id,
      c.intent_confirmation_event_id,c.summary_snapshot_event_id,c.summary_review_event_id,c.child_pool_event_id,
      c.child_review_event_id,c.adult_pool_event_id,c.adult_review_event_id FROM sermon_content_heads h
      LEFT JOIN sermon_content_current c ON c.sermon_id=h.sermon_id AND c.event_count=h.event_count AND c.last_event_id=h.last_event_id
      WHERE h.sermon_id=?`).bind(owner.sermonId).first(),
      metadataStore.read(owner.sermonId),
      db.prepare("SELECT sermon_id,status FROM quiz_sets WHERE id=?").bind(owner.quizSetId)
      .first<{ sermon_id: string; status: string }>(), lifecycle.readJob(owner.jobId), draftIsPurged(db, owner.sermonId)]);
    if (job.outcome !== "absent" && job.outcome !== "present") return unavailable();
    const placement = job.outcome === "present" && job.value.execution_contract_version === 3 ? await readPlacementSelection(db, owner.jobId) : null;
    return { purged, placement, head, content: content ? currentSchema.parse(content) : null, metadata, quiz,
      job: job.outcome === "present" ? job.value : null };
  }
  const h0 = await heads(), { head, content: stored, metadata, quiz, job } = h0;
  if (h0.purged || !head || !metadata || quiz?.sermon_id !== owner.sermonId || !["draft", "needs_revision", "review_ready"].includes(quiz.status)) return unavailable();
  const scope = options.scope ?? job?.request_scope ?? "intent";
  if (job && (job.sermon_id !== owner.sermonId || job.quiz_set_id !== owner.quizSetId || job.request_scope !== scope || job.execution_contract_version !== (scope === "full" ? 3 : 2))) return unavailable();
  if (!head.confirmation_id) return unavailable();
  // A previously verified sealed graph is still the same graph when all its
  // mutable selectors and the cleanup marker match. Re-read these selectors
  // even after an external call; never accept a caller-created authority as a
  // witness. Lifecycle state may advance without changing the graph.
  const selectors = { ...h0, job: job ? { id: job.id, sermon_id: job.sermon_id, quiz_set_id: job.quiz_set_id,
    request_context_id: job.request_context_id, request_scope: job.request_scope, execution_contract_version: job.execution_contract_version } : null };
  const previous = options.existing && Object.keys(options).length === 1 ? capturedReads.get(options.existing) : null;
  if (previous?.db === db && same(previous.heads, selectors)) {
    if (!same(h0, await heads())) throw new Error("GENERATION_AUTHORITY_CHANGED");
    const authority = generationAuthoritySnapshotSchema.parse({ ...previous.read.basis.authority,
      jobStateVersion: job?.state_version ?? 0, status: job?.status ?? "dispatch_pending",
      wait: job?.active_wait_generation ? { kind: job.wait_kind, generation: job.active_wait_generation } : null });
    const basis = freeze({ ...previous.read.basis, authority }); reads.add(basis);
    const read = { ...previous.read, basis }; capturedReads.set(basis.authority, { db, heads: selectors, read });
    return read;
  }
  const refs = new Map<string, DomainBasis["references"]["references"][number]>();
  const contextRefs = new Map<string, GenerationContext["references"][number]>();
  const documents: DomainBasis["documents"] = [];
  let bytes = 0;
  function account(n: number) { bytes += n; if (!Number.isSafeInteger(bytes) || bytes > DOMAIN_STORAGE_BUDGET.maxPayloadBytes) limit(); }
  function put(ref: DomainBasis["references"]["references"][number], context: GenerationContext["references"][number]) {
    if (refs.has(ref.eventId) && (!same(refs.get(ref.eventId), ref) || !same(contextRefs.get(ref.eventId), context))) corrupt();
    refs.set(ref.eventId, ref); contextRefs.set(ref.eventId, context);
    if (refs.size > DOMAIN_STORAGE_BUDGET.maxReferences) limit();
  }
  const events = new Map<string, Promise<InputEvent>>([[head.id, Promise.resolve(head)]]);
  account(head.byte_length);
  function inputEvent(eventId: string): Promise<InputEvent> {
    const old = events.get(eventId);
    if (old) return old;
    const result = loadInputEvent(eventId); events.set(eventId, result); return result;
  }
  async function loadInputEvent(eventId: string) {
    const event = await inputStore.event(owner.sermonId, eventId);
    if (!event) return corrupt();
    account(event.byte_length); return event;
  }
  const documentReads = new Map<number, Promise<DomainBasis["documents"][number]>>();
  async function document(event: InputEvent, expected?: DomainBasis["documents"][number]["input"]) {
    let result = documentReads.get(event.version);
    if (!result) { result = loadDocument(event); documentReads.set(event.version, result); }
    const value = await result;
    if (expected && !same(value.input, expected)) corrupt();
    return value;
  }
  async function loadDocument(event: InputEvent) {
    const [source, doc] = await readTogether([inputEvent(event.source_id), inputEvent(event.document_id)]);
    if (source.kind !== "source" || source.id !== source.source_id || doc.source_id !== source.id ||
      !["source", "edit", "restore", "merge"].includes(doc.kind) || doc.document_id !== doc.id || doc.version > event.version ||
      doc.document_sha256 !== event.document_sha256 || source.source_type !== event.source_type || doc.source_type !== event.source_type) return corrupt();
    const raw = transcriptSourcePayloadSchema.parse(await inputStore.payload(source));
    await verifySource(raw);
    const body = doc.id === source.id ? originalContent(raw) : transcriptContentSchema.parse(await inputStore.payload(doc));
    verifyContent(body, raw);
    if (await hash(textOf(body)) !== event.document_sha256) return corrupt();
    const sourceSha256 = raw.sourceMode === "public_unofficial" ? raw.sourceSha256 : raw.rawTranscriptSha256;
    const input: DomainBasis["documents"][number]["input"] = { state: "present", version: event.version,
      sourceId: source.id, sourceRevision: source.version, sourceSha256, documentId: doc.id,
      documentSha256: doc.document_sha256, checksumFormat: "sha256:utf8-working-text:v1", confirmationId: event.confirmation_id,
      sourceKind: event.source_type.startsWith("caption_") ? "caption" : event.source_type as "sermon_manuscript" | "sermon_summary",
      coverage: raw.sourceMode === "manual_paste" && raw.sourceCoverage === "partial_notes" ? "partial" : "full" };
    if (!input.confirmationId) return corrupt();
    const confirmation = await inputEvent(input.confirmationId);
    if (confirmation.kind !== "confirm" || confirmation.id !== confirmation.confirmation_id || confirmation.source_id !== source.id ||
      confirmation.document_id !== doc.id || confirmation.document_sha256 !== doc.document_sha256 || confirmation.version > event.version ||
      !same(await inputStore.payload(confirmation), { reviewed: true })) return corrupt();
    for (const record of new Map([source, doc, confirmation].map(r => [r.id, r])).values()) {
      put({ kind: "input", sermonId: owner.sermonId, eventId: record.id, eventVersion: record.version,
        payloadSha256: record.payload_sha256, sourceSha256: record.id === source.id ? sourceSha256 : null,
        documentSha256: record.id === source.id || record.id === doc.id ? record.document_sha256 : null },
      { kind: "input", sermonId: owner.sermonId, eventId: record.id,
        sha256: record.id === source.id || record.id === doc.id ? record.document_sha256 : record.payload_sha256,
        ...(record.id === source.id && sourceSha256 !== record.document_sha256 ? { sourceSha256 } : {}) });
    }
    const result = { input, content: body }; documents.push(result); return result;
  }
  const selectedInput = await document(head);
  const targets = [...new Set(options.targets ?? [])];
  if (targets.length > DOMAIN_STORAGE_BUDGET.maxTargets) return limit();
  const pending = [...new Set([...(stored ? Object.values(stored).filter((v): v is string => typeof v === "string") : []), ...targets, ...(options.historyEventIds ?? [])])];
  const snapshots = new Map<string, DomainSnapshot>(), records: DomainBasis["humanRecords"] = [];
  const selections = new Map<number, DomainBasis["intentSelections"][number]>();
  async function loadContent(eventId: string) {
    const [row, verifiedEvents] = await readTogether([db.prepare(`SELECT aggregate_version,generation_job_id,step_key,input_version,payload_sha256,payload_byte_length,
      created_by_actor_id,created_at FROM sermon_content_events WHERE sermon_id=? AND event_id=? AND state='sealed'`).bind(owner.sermonId, eventId)
      .first<{ aggregate_version: number; generation_job_id: string | null; step_key: string | null; input_version: number;
        payload_sha256: string; payload_byte_length: number; created_by_actor_id: string | null; created_at: string }>(),
      readVerifiedEvents(db, owner.sermonId, [eventId], account),
    ]);
    if (!row) return corrupt();
    const [verified] = verifiedEvents;
    if (!verified) return corrupt();
    const human = verified.origin === "human";
    const wrapper = human ? z.object({ command: z.unknown(), materializedSnapshot: z.unknown() }).parse(verified.payload) : null;
    const parsed = domainPreparedSchema.safeParse(wrapper ? wrapper.command : verified.payload);
    if (!parsed.success) return unavailable();
    const prepared = parsed.data;
    return { row, verified, human, wrapper, prepared };
  }
  const contentReads = new Map<string, Awaited<ReturnType<typeof loadContent>>>();
  async function verifyEvent(eventId: string) {
    const { row, verified, human, wrapper, prepared } = contentReads.get(eventId)!;
    if (prepared.operation.family === "correction") return corrupt();
    const snapshot = prepared.materializedSnapshot, op = prepared.operation.operation;
    if (prepared.origin !== verified.origin || prepared.owner.sermonId !== owner.sermonId || prepared.owner.quizSetId !== owner.quizSetId ||
      prepared.event.id !== eventId || (snapshot && (snapshot.value.id !== eventId ||
      domainStorageJson(snapshot.operation) !== domainStorageJson(op)))) return corrupt();
    const [lineage, detail, recovery, historical] = await readTogether([
      db.prepare("SELECT * FROM sermon_content_domain_lineage WHERE sermon_id=? AND event_id=?")
        .bind(owner.sermonId, eventId).first(),
      human ? db.prepare("SELECT operation,target_snapshot_event_id,created_by_actor_id,created_at FROM sermon_content_human_events WHERE sermon_id=? AND event_id=?")
        .bind(owner.sermonId, eventId).first<{ operation: string; target_snapshot_event_id: string | null; created_by_actor_id: string; created_at: string }>() : null,
      human ? null : readArchivedIntentRecovery(db, owner.sermonId, eventId),
      db.prepare("SELECT id FROM sermon_input_events WHERE sermon_id=? AND version=? AND state='sealed'")
        .bind(owner.sermonId, row.input_version).first<{ id: string }>(),
    ]);
    if (!lineage || !same(lineage, domainLineage(prepared))) return corrupt();
    if (human) {
      const name = `${prepared.operation.family}_${op.kind}`;
      if (!detail || detail.operation !== name || detail.created_by_actor_id !== prepared.event.actorDigest ||
        detail.created_at !== prepared.event.createdAt || row.created_by_actor_id !== prepared.event.actorDigest || row.created_at !== prepared.event.createdAt ||
        domainStorageJson(wrapper!.materializedSnapshot) !== domainStorageJson(snapshot)) return corrupt();
      if (op.kind === "confirm" || op.kind === "review") {
        const targetId = "analysisId" in op ? op.analysisId : "summaryId" in op ? op.summaryId : "poolId" in op ? op.poolId : null;
        if (!targetId || detail.target_snapshot_event_id !== targetId) return corrupt();
        records.push({ id: eventId, kind: op.kind === "confirm" ? "confirmation" : "review", targetId,
          intentConfirmationId: op.kind === "review" && prepared.before.state === "present" ? prepared.before.intent?.confirmation?.id ?? null : null,
          actorDigest: prepared.event.actorDigest, createdAt: prepared.event.createdAt });
      }
    } else {
      if (!snapshot || prepared.owner.jobId !== row.generation_job_id || !row.generation_job_id || !row.step_key ||
        verified.kind !== (prepared.operation.family === "candidate" ? "candidate" : domainTask(prepared)) ||
        await hash(domainStorageJson(prepared)) !== row.payload_sha256) return corrupt();
      if (recovery) {
        if (!["intent_analysis", "intent_critique", "summary"].includes(row.step_key) || recovery.payload_sha256 !== row.payload_sha256 ||
          recovery.created_at !== row.created_at || row.created_by_actor_id !== null ||
          !await verifyArchivedIntentRecovery(db, recovery, prepared)) return corrupt();
      } else {
        const [sealed, outcome] = await readTogether([lifecycle.readContext(prepared.context.contextId), lifecycle.readOutcome(row.generation_job_id, row.step_key, 1)]);
        if (sealed.outcome !== "present" || sealed.value.context.kind !== "step" || sealed.value.context.stepKey !== row.step_key ||
          sealed.value.encoded.envelope.fingerprint !== prepared.context.fingerprint ||
          await fingerprintLifecycleValue(sealed.value.context) !== prepared.context.fingerprint ||
          !same(sealed.value.context.authority.content, prepared.before) || !same(sealed.value.context.authority.input, prepared.expectedInput) ||
          outcome.outcome !== "present" || outcome.value.outcome !== "success" || outcome.value.result?.id !== eventId ||
          outcome.value.result.fingerprint !== row.payload_sha256) return corrupt();
      }
    }
    if (!historical) return corrupt();
    await document(await inputEvent(historical.id), prepared.expectedInput);
    if (snapshot && !same(snapshot.provenance.input, prepared.expectedInput)) {
      const old = await db.prepare("SELECT id FROM sermon_input_events WHERE sermon_id=? AND version=? AND state='sealed'")
        .bind(owner.sermonId, snapshot.provenance.input.version).first<{ id: string }>();
      if (!old) return corrupt();
      await document(await inputEvent(old.id), snapshot.provenance.input);
    }
    put({ kind: "content", sermonId: owner.sermonId, eventId, eventVersion: row.aggregate_version,
      payloadSha256: row.payload_sha256, ...(snapshot ? { snapshotSha256: snapshot.provenance.payloadSha256 } : {}) },
    { kind: "content", sermonId: owner.sermonId, eventId, sha256: row.payload_sha256 });
    if (snapshot) snapshots.set(eventId, snapshot);
    const deps: Array<string | null> = [];
    if (snapshot?.kind === "intent") deps.push(snapshot.provenance.rootAnalysisId, snapshot.value.critiqueId);
    if ("baseAnalysisId" in op) deps.push(op.baseAnalysisId);
    if ("analysisId" in op) deps.push(op.analysisId);
    if ("baseSummaryId" in op) deps.push(op.baseSummaryId);
    if ("summaryId" in op) deps.push(op.summaryId);
    if ("basePoolId" in op) deps.push(op.basePoolId);
    if ("replacement" in op && op.replacement) deps.push(op.replacement.basePoolId);
    if ("poolId" in op) deps.push(op.poolId);
    for (const content of [prepared.before, prepared.after]) if (content.state === "present" && content.intent?.confirmation) {
      deps.push(content.intent.selectedId, content.intent.confirmation.id);
      const version = prepared.expectedInput.version + content.eventCount;
      const selection = { atVersion: version, selectedId: content.intent.selectedId, confirmationId: content.intent.confirmation.id };
      if (selections.has(version) && !same(selections.get(version), selection)) return corrupt();
      selections.set(version, selection);
    }
    if (snapshot && snapshot.kind !== "intent") {
      const binding = snapshot.value.binding;
      deps.push(binding.analysisId, binding.intentConfirmationId);
      selections.set(snapshot.provenance.generationVersion, { atVersion: snapshot.provenance.generationVersion,
        selectedId: binding.analysisId, confirmationId: binding.intentConfirmationId });
    }
    for (const dep of deps) if (dep && !pending.includes(dep)) pending.push(dep);
  }
  // Discover the bounded dependency graph before verifying provenance. All
  // independent contexts/outcomes can then be checked together instead of
  // walking the same ancestry serially once for each displayed result.
  for (let index = 0; index < pending.length;) {
    if (pending.length > DOMAIN_STORAGE_BUDGET.maxReferences) return limit();
    const end = pending.length;
    await readTogether(pending.slice(index, end).map(async eventId => {
      const value = await loadContent(eventId); contentReads.set(eventId, value);
      const p = value.prepared, snapshot = p.materializedSnapshot, op = p.operation.operation;
      const deps: Array<string | null> = [];
      if (snapshot?.kind === "intent") deps.push(snapshot.provenance.rootAnalysisId, snapshot.value.critiqueId);
      for (const key of ["baseAnalysisId", "analysisId", "baseSummaryId", "summaryId", "basePoolId", "poolId"] as const)
        if (key in op) deps.push(Reflect.get(op, key) as string);
      if ("replacement" in op && op.replacement) deps.push(op.replacement.basePoolId);
      for (const c of [p.before, p.after]) if (c.state === "present" && c.intent?.confirmation)
        deps.push(c.intent.selectedId, c.intent.confirmation.id);
      if (snapshot && snapshot.kind !== "intent") deps.push(snapshot.value.binding.analysisId, snapshot.value.binding.intentConfirmationId);
      for (const dep of deps) if (dep && !pending.includes(dep)) pending.push(dep);
    }));
    index = end;
  }
  await readTogether(pending.map(verifyEvent));
  const selected = stored?.selected_analysis_event_id ? snapshots.get(stored.selected_analysis_event_id) : null;
  if (stored && (!selected || selected.kind !== "intent")) return corrupt();
  const rootId = selected?.kind === "intent" ? selected.provenance.rootAnalysisId! : null;
  const selectedCritique = selected?.kind === "intent" ? selected.value.critiqueId : null;
  if (stored?.intent_critique_event_id) {
    const comparison = snapshots.get(stored.intent_critique_event_id);
    if (comparison?.kind !== "intent" || comparison.value.kind !== "critique" || comparison.provenance.rootAnalysisId !== rootId) return corrupt();
  }
  function contentSlot(eventId: string | null | undefined, reviewId: string | null | undefined, kind: "summary" | "candidate") {
    if (!eventId) return null;
    const value = snapshots.get(eventId); if (!value || value.kind !== kind) return corrupt();
    return { id: eventId, binding: value.value.binding, review: reviewId ? {
      id: reviewId, targetId: eventId, intentConfirmationId: value.value.binding.intentConfirmationId, origin: "human" as const } : null };
  }
  const child = contentSlot(stored?.child_pool_event_id, stored?.child_review_event_id, "candidate");
  const adult = contentSlot(stored?.adult_pool_event_id, stored?.adult_review_event_id, "candidate");
  const content: GenerationAuthoritySnapshot["content"] = !stored ? { state: "absent" } : {
    state: "present", eventCount: stored.event_count, lastEventId: stored.last_event_id,
    availableCritique: stored.intent_critique_event_id ? { id: stored.intent_critique_event_id, rootAnalysisId: rootId! } : null,
    intent: selected?.kind === "intent" ? { selectedId: selected.value.id, rootAnalysisId: rootId!, binding: selected.value.binding,
      critique: selectedCritique ? { id: selectedCritique, rootAnalysisId: rootId! } : null,
      confirmation: stored.intent_confirmation_event_id && selectedCritique ? { id: stored.intent_confirmation_event_id,
        targetId: selected.value.id, critiqueId: selectedCritique, origin: "human" } : null } : null,
    summary: contentSlot(stored.summary_snapshot_event_id, stored.summary_review_event_id, "summary"),
    child: child ? { ...child, difficulty: "child" } : null, adult: adult ? { ...adult, difficulty: "adult" } : null };
  if (content.state === "present" && content.intent?.confirmation) selections.set(head.version + content.eventCount, {
    atVersion: head.version + content.eventCount, selectedId: content.intent.selectedId, confirmationId: content.intent.confirmation.id });
  let selection: GenerationAuthoritySnapshot["selection"] = options.selection ?? { state: "unavailable" };
  if (job) {
    const request = await lifecycle.readContext(job.request_context_id);
    if (request.outcome !== "present" || request.value.context.kind !== "request") return corrupt();
    selection = h0.placement?.selection ?? request.value.context.authority.selection;
  }
  const authority = generationAuthoritySnapshotSchema.parse({ contractVersion: 1, ...owner, scope,
    jobStateVersion: job?.state_version ?? 0, status: job?.status ?? "dispatch_pending",
    wait: job?.active_wait_generation ? { kind: job.wait_kind, generation: job.active_wait_generation } : null,
    input: selectedInput.input, content, metadata, selection });
  if (!same(h0, await heads()) || options.existing && (!same(options.existing.input, authority.input) ||
    !same(options.existing.content, authority.content) || !same(options.existing.metadata, authority.metadata))) throw new Error("GENERATION_AUTHORITY_CHANGED");
  const basis: DomainBasis = { basisVersion: 1, purpose: "current", sourceRevisionMode: "sealed_event_version", authority,
    // Replaced with the sealed step identity before preparing any write.
    context: { contextId: "unbound", fingerprint: "0".repeat(64) }, references: { referenceVersion: 2, references: [...refs.values()] },
    targetIds: targets, documents, snapshots: [...snapshots.values()], humanRecords: records, intentSelections: [...selections.values()] };
  const validated = freeze(await validateDomainBasis(basis, DOMAIN_STORAGE_BUDGET));
  reads.add(validated);
  const read = { basis: validated, references: [...contextRefs.values()], transcript: selectedInput.content };
  capturedReads.set(validated.authority, { db, heads: selectors, read });
  return read;
}
