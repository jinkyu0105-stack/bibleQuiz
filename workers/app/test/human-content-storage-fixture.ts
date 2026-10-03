import { sha256Bytes } from "../../_shared/storage/sha256";

export type InputTuple = {
  confirmation_id: string | null;
  document_id: string;
  document_sha256: string;
  source_id: string;
  version: number;
};

export type ReviewedContentFixture = {
  analysisEventId: string;
  adultPoolEventId: string;
  adultReviewEventId: string;
  childPoolEventId: string;
  childReviewEventId: string;
  critiqueEventId: string;
  eventCount: number;
  intentConfirmationEventId: string;
  summaryReviewEventId: string;
  summarySnapshotEventId: string;
};

const actorId = "f".repeat(64);
const payloadSha256 = "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a";
const chunkSha256 = payloadSha256;
const payload = new TextEncoder().encode("{}").buffer as ArrayBuffer;

function insert(
  database: D1Database,
  table: string,
  values: Record<string, string | number | null | ArrayBuffer>,
) {
  const columns = Object.keys(values);
  return database.prepare(
    `INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
  ).bind(...Object.values(values));
}

function receipt(
  database: D1Database,
  jobId: string,
  task: string,
  stepKey: string,
  input: InputTuple,
  createdAt: string,
) {
  return insert(database, "generation_step_receipts", {
    generation_job_id: jobId,
    step_key: stepKey,
    task,
    effect_class: "ai_provider",
    input_contract_version: 1,
    input_fingerprint: "b".repeat(64),
    input_version: input.version,
    source_id: input.source_id,
    document_id: input.document_id,
    document_sha256: input.document_sha256,
    confirmation_id: input.confirmation_id,
    metadata_revision: 1,
    binding_id: null,
    ticket_id: null,
    state: "claimed",
    attempt_count: 1,
    claim_token: `claim:${crypto.randomUUID()}`,
    lease_expires_at: "2026-09-17T03:00:00.000Z",
    provider_request_id_opaque: null,
    result_kind: null,
    result_id: null,
    result_version: null,
    result_fingerprint: null,
    error_code: null,
    error_message_safe: null,
    error_fingerprint: null,
    started_at: createdAt,
    updated_at: createdAt,
    completed_at: null,
  });
}

type CurrentRefs = Omit<ReviewedContentFixture, "eventCount"> & {
  analysisEventId: string;
  critiqueEventId: string;
};

function currentValues(sermonId: string, eventCount: number, lastEventId: string, refs: Partial<CurrentRefs>) {
  return {
    sermon_id: sermonId,
    event_count: eventCount,
    last_event_id: lastEventId,
    selected_analysis_event_id: refs.analysisEventId ?? null,
    intent_critique_event_id: refs.critiqueEventId ?? null,
    intent_confirmation_event_id: refs.intentConfirmationEventId ?? null,
    summary_snapshot_event_id: refs.summarySnapshotEventId ?? null,
    summary_review_event_id: refs.summaryReviewEventId ?? null,
    child_pool_event_id: refs.childPoolEventId ?? null,
    child_review_event_id: refs.childReviewEventId ?? null,
    adult_pool_event_id: refs.adultPoolEventId ?? null,
    adult_review_event_id: refs.adultReviewEventId ?? null,
    required_event_count: eventCount,
    required_event_id: lastEventId,
  };
}

async function appendAi(
  database: D1Database,
  values: {
    analysisEventId: string | null;
    baseAnalysisEventId: string | null;
    current: Partial<CurrentRefs>;
    difficulty: "adult" | "child" | null;
    eventCount: number;
    eventId: string;
    input: InputTuple;
    intentConfirmationEventId: string | null;
    jobId: string;
    kind: "candidate" | "intent_analysis" | "intent_critique" | "summary";
    sermonId: string;
    task: "adult_candidates" | "child_candidates" | "intent_analysis" | "intent_critique" | "summary";
  },
) {
  const stepKey = `p538:${values.task}:${crypto.randomUUID()}`;
  const createdAt = `2026-09-17T02:00:${String(values.eventCount).padStart(2, "0")}.000Z`;
  const statements: D1PreparedStatement[] = [
    receipt(database, values.jobId, values.task, stepKey, values.input, createdAt),
    insert(database, "sermon_content_events", {
      sermon_id: values.sermonId,
      event_id: values.eventId,
      content_sequence: values.eventCount,
      aggregate_version: values.input.version + values.eventCount,
      origin: "ai",
      kind: values.kind,
      difficulty: values.difficulty,
      generation_job_id: values.jobId,
      step_key: stepKey,
      input_version: values.input.version,
      source_id: values.input.source_id,
      document_id: values.input.document_id,
      document_sha256: values.input.document_sha256,
      confirmation_id: values.input.confirmation_id,
      base_analysis_event_id: values.baseAnalysisEventId,
      analysis_event_id: values.analysisEventId,
      intent_confirmation_event_id: values.intentConfirmationEventId,
      payload_sha256: payloadSha256,
      payload_byte_length: payload.byteLength,
      payload_chunk_count: 1,
      state: "assembling",
      required_state: "sealed",
      created_by_actor_id: null,
      created_at: createdAt,
    }),
    insert(database, "sermon_content_payloads", {
      sermon_id: values.sermonId,
      event_id: values.eventId,
      codec: "content-event-json-utf8-v1",
      chunk_bytes: 65536,
      chunk_count: 1,
      byte_length: payload.byteLength,
      payload_sha256: payloadSha256,
      verified: 0,
    }),
    insert(database, "sermon_content_chunks", {
      sermon_id: values.sermonId,
      event_id: values.eventId,
      position: 0,
      byte_length: payload.byteLength,
      chunk_sha256: chunkSha256,
      body: payload,
      verified: 1,
    }),
  ];
  if (values.eventCount === 1) {
    statements.push(insert(database, "sermon_content_heads", {
      sermon_id: values.sermonId,
      event_count: 1,
      last_event_id: values.eventId,
      required_event_count: 1,
      required_event_id: values.eventId,
    }));
  } else {
    statements.push(database.prepare(`UPDATE sermon_content_heads SET event_count=?,last_event_id=?,
      required_event_count=?,required_event_id=? WHERE sermon_id=? AND event_count=?`)
      .bind(values.eventCount, values.eventId, values.eventCount, values.eventId, values.sermonId, values.eventCount - 1));
  }
  if (values.eventCount > 1) {
    statements.push(database.prepare(`UPDATE sermon_content_current SET event_count=?,last_event_id=?,
      selected_analysis_event_id=?,intent_critique_event_id=?,intent_confirmation_event_id=?,
      summary_snapshot_event_id=?,summary_review_event_id=?,child_pool_event_id=?,child_review_event_id=?,
      adult_pool_event_id=?,adult_review_event_id=?,required_event_count=?,required_event_id=?
      WHERE sermon_id=? AND event_count=?`).bind(
      values.eventCount,
      values.eventId,
      values.current.analysisEventId ?? null,
      values.current.critiqueEventId ?? null,
      values.current.intentConfirmationEventId ?? null,
      values.current.summarySnapshotEventId ?? null,
      values.current.summaryReviewEventId ?? null,
      values.current.childPoolEventId ?? null,
      values.current.childReviewEventId ?? null,
      values.current.adultPoolEventId ?? null,
      values.current.adultReviewEventId ?? null,
      values.eventCount,
      values.eventId,
      values.sermonId,
      values.eventCount - 1,
    ));
  }
  statements.push(
    database.prepare("UPDATE sermon_content_payloads SET verified=1 WHERE sermon_id=? AND event_id=? AND verified=0")
      .bind(values.sermonId, values.eventId),
    database.prepare("UPDATE sermon_content_events SET state='sealed' WHERE sermon_id=? AND event_id=? AND state='assembling'")
      .bind(values.sermonId, values.eventId),
  );
  if (values.eventCount === 1) {
    statements.push(insert(database, "sermon_content_current", currentValues(
      values.sermonId,
      values.eventCount,
      values.eventId,
      values.current,
    )));
  }
  await database.batch(statements);
}

async function appendHumanReview(
  database: D1Database,
  values: {
    analysisEventId: string;
    current: Partial<CurrentRefs>;
    difficulty: "adult" | "child" | null;
    eventCount: number;
    eventId: string;
    input: InputTuple;
    intentConfirmationEventId: string | null;
    kind: "candidate" | "intent_confirmation" | "summary";
    operation: "candidate_review" | "intent_confirm" | "summary_review";
    sermonId: string;
    targetEventId: string;
    critiqueEventId?: string;
  },
) {
  const createdAt = `2026-09-17T02:00:${String(values.eventCount).padStart(2, "0")}.000Z`;
  const current = currentValues(values.sermonId, values.eventCount, values.eventId, values.current);
  const humanPayload = new TextEncoder().encode(JSON.stringify({
    contractVersion: 1,
    operation: values.operation,
    command: { targetEventId: values.targetEventId },
    materializedSnapshot: null,
  }));
  const humanPayloadSha256 = await sha256Bytes(humanPayload);
  await database.batch([
    insert(database, "sermon_content_events", {
      sermon_id: values.sermonId,
      event_id: values.eventId,
      content_sequence: values.eventCount,
      aggregate_version: values.input.version + values.eventCount,
      origin: "human",
      kind: values.kind,
      difficulty: values.difficulty,
      generation_job_id: null,
      step_key: null,
      input_version: values.input.version,
      source_id: values.input.source_id,
      document_id: values.input.document_id,
      document_sha256: values.input.document_sha256,
      confirmation_id: values.input.confirmation_id,
      base_analysis_event_id: null,
      analysis_event_id: values.analysisEventId,
      intent_confirmation_event_id: values.intentConfirmationEventId,
      payload_sha256: humanPayloadSha256,
      payload_byte_length: humanPayload.byteLength,
      payload_chunk_count: 1,
      state: "assembling",
      required_state: "sealed",
      created_by_actor_id: actorId,
      created_at: createdAt,
    }),
    insert(database, "sermon_content_human_events", {
      sermon_id: values.sermonId,
      event_id: values.eventId,
      operation: values.operation,
      command_key: `command:${crypto.randomUUID()}`,
      base_snapshot_event_id: null,
      target_snapshot_event_id: values.targetEventId,
      restore_source_event_id: null,
      critique_event_id: values.critiqueEventId ?? null,
      intent_confirmation_event_id: values.intentConfirmationEventId,
      expected_current_review_event_id: null,
      created_by_actor_id: actorId,
      created_at: createdAt,
    }),
    insert(database, "sermon_content_payloads", {
      sermon_id: values.sermonId,
      event_id: values.eventId,
      codec: "content-event-json-utf8-v1",
      chunk_bytes: 65536,
      chunk_count: 1,
      byte_length: humanPayload.byteLength,
      payload_sha256: humanPayloadSha256,
      verified: 0,
    }),
    insert(database, "sermon_content_chunks", {
      sermon_id: values.sermonId,
      event_id: values.eventId,
      position: 0,
      byte_length: humanPayload.byteLength,
      chunk_sha256: humanPayloadSha256,
      body: humanPayload.buffer as ArrayBuffer,
      verified: 1,
    }),
    database.prepare(`UPDATE sermon_content_heads SET event_count=?,last_event_id=?,required_event_count=?,required_event_id=?
      WHERE sermon_id=? AND event_count=?`).bind(
      values.eventCount,
      values.eventId,
      values.eventCount,
      values.eventId,
      values.sermonId,
      values.eventCount - 1,
    ),
    database.prepare(`UPDATE sermon_content_current SET event_count=?,last_event_id=?,
      selected_analysis_event_id=?,intent_critique_event_id=?,intent_confirmation_event_id=?,
      summary_snapshot_event_id=?,summary_review_event_id=?,child_pool_event_id=?,child_review_event_id=?,
      adult_pool_event_id=?,adult_review_event_id=?,required_event_count=?,required_event_id=?
      WHERE sermon_id=? AND event_count=?`).bind(
      current.event_count,
      current.last_event_id,
      current.selected_analysis_event_id,
      current.intent_critique_event_id,
      current.intent_confirmation_event_id,
      current.summary_snapshot_event_id,
      current.summary_review_event_id,
      current.child_pool_event_id,
      current.child_review_event_id,
      current.adult_pool_event_id,
      current.adult_review_event_id,
      current.required_event_count,
      current.required_event_id,
      values.sermonId,
      values.eventCount - 1,
    ),
    database.prepare("UPDATE sermon_content_payloads SET verified=1 WHERE sermon_id=? AND event_id=? AND verified=0")
      .bind(values.sermonId, values.eventId),
    database.prepare("UPDATE sermon_content_events SET state='sealed' WHERE sermon_id=? AND event_id=? AND state='assembling'")
      .bind(values.sermonId, values.eventId),
  ]);
}

export async function seedReviewedHumanContent(
  database: D1Database,
  context: { generationJobId: string; input: InputTuple; sermonId: string },
): Promise<ReviewedContentFixture> {
  const analysisEventId = `analysis_${crypto.randomUUID()}`;
  const critiqueEventId = `critique_${crypto.randomUUID()}`;
  const intentConfirmationEventId = `intent-confirm_${crypto.randomUUID()}`;
  const summarySnapshotEventId = `summary_${crypto.randomUUID()}`;
  const summaryReviewEventId = `summary-review_${crypto.randomUUID()}`;
  const childPoolEventId = `child-pool_${crypto.randomUUID()}`;
  const childReviewEventId = `child-review_${crypto.randomUUID()}`;
  const adultPoolEventId = `adult-pool_${crypto.randomUUID()}`;
  const adultReviewEventId = `adult-review_${crypto.randomUUID()}`;
  const refs: Partial<CurrentRefs> = {};

  refs.analysisEventId = analysisEventId;
  await appendAi(database, { analysisEventId: null, baseAnalysisEventId: null, current: refs, difficulty: null,
    eventCount: 1, eventId: analysisEventId, input: context.input, intentConfirmationEventId: null,
    jobId: context.generationJobId, kind: "intent_analysis", sermonId: context.sermonId, task: "intent_analysis" });
  refs.critiqueEventId = critiqueEventId;
  await appendAi(database, { analysisEventId: null, baseAnalysisEventId: analysisEventId, current: refs, difficulty: null,
    eventCount: 2, eventId: critiqueEventId, input: context.input, intentConfirmationEventId: null,
    jobId: context.generationJobId, kind: "intent_critique", sermonId: context.sermonId, task: "intent_critique" });
  refs.intentConfirmationEventId = intentConfirmationEventId;
  await appendHumanReview(database, { analysisEventId, current: refs, difficulty: null, eventCount: 3,
    eventId: intentConfirmationEventId, input: context.input, intentConfirmationEventId: null,
    kind: "intent_confirmation", operation: "intent_confirm", sermonId: context.sermonId,
    targetEventId: analysisEventId, critiqueEventId });
  refs.summarySnapshotEventId = summarySnapshotEventId;
  await appendAi(database, { analysisEventId, baseAnalysisEventId: null, current: refs, difficulty: null,
    eventCount: 4, eventId: summarySnapshotEventId, input: context.input, intentConfirmationEventId,
    jobId: context.generationJobId, kind: "summary", sermonId: context.sermonId, task: "summary" });
  refs.summaryReviewEventId = summaryReviewEventId;
  await appendHumanReview(database, { analysisEventId, current: refs, difficulty: null, eventCount: 5,
    eventId: summaryReviewEventId, input: context.input, intentConfirmationEventId,
    kind: "summary", operation: "summary_review", sermonId: context.sermonId, targetEventId: summarySnapshotEventId });
  refs.childPoolEventId = childPoolEventId;
  await appendAi(database, { analysisEventId, baseAnalysisEventId: null, current: refs, difficulty: "child",
    eventCount: 6, eventId: childPoolEventId, input: context.input, intentConfirmationEventId,
    jobId: context.generationJobId, kind: "candidate", sermonId: context.sermonId, task: "child_candidates" });
  refs.childReviewEventId = childReviewEventId;
  await appendHumanReview(database, { analysisEventId, current: refs, difficulty: "child", eventCount: 7,
    eventId: childReviewEventId, input: context.input, intentConfirmationEventId,
    kind: "candidate", operation: "candidate_review", sermonId: context.sermonId, targetEventId: childPoolEventId });
  refs.adultPoolEventId = adultPoolEventId;
  await appendAi(database, { analysisEventId, baseAnalysisEventId: null, current: refs, difficulty: "adult",
    eventCount: 8, eventId: adultPoolEventId, input: context.input, intentConfirmationEventId,
    jobId: context.generationJobId, kind: "candidate", sermonId: context.sermonId, task: "adult_candidates" });
  refs.adultReviewEventId = adultReviewEventId;
  await appendHumanReview(database, { analysisEventId, current: refs, difficulty: "adult", eventCount: 9,
    eventId: adultReviewEventId, input: context.input, intentConfirmationEventId,
    kind: "candidate", operation: "candidate_review", sermonId: context.sermonId, targetEventId: adultPoolEventId });

  return { adultPoolEventId, adultReviewEventId, analysisEventId, childPoolEventId, childReviewEventId,
    critiqueEventId, eventCount: 9, intentConfirmationEventId, summaryReviewEventId, summarySnapshotEventId };
}

export async function appendSyntheticComparisonContent(
  database: D1Database,
  context: { generationJobId: string; input: InputTuple; sermonId: string },
  reviewed: ReviewedContentFixture,
) {
  const eventId = `summary-compare_${crypto.randomUUID()}`;
  const eventCount = reviewed.eventCount + 1;
  await appendAi(database, {
    analysisEventId: reviewed.analysisEventId,
    baseAnalysisEventId: null,
    current: reviewed,
    difficulty: null,
    eventCount,
    eventId,
    input: context.input,
    intentConfirmationEventId: reviewed.intentConfirmationEventId,
    jobId: context.generationJobId,
    kind: "summary",
    sermonId: context.sermonId,
    task: "summary",
  });
  return { eventCount, eventId };
}

export type HumanFailureMode =
  | "intent_confirm_mismatch"
  | "summary_edit"
  | "summary_review_mismatch"
  | "candidate_review_mismatch";

export function humanFailureStatements(
  database: D1Database,
  context: { input: InputTuple; sermonId: string },
  reviewed: ReviewedContentFixture,
  options: {
    baseSnapshotEventId?: string;
    commandKey?: string;
    eventId?: string;
    keepInvalidReview?: boolean;
    mode?: HumanFailureMode;
    omit?: "chunk" | "current" | "detail" | "head" | "payload" | "seal" | "verify";
  } = {},
) {
  const mode = options.mode ?? "summary_edit";
  const eventId = options.eventId ?? `human:${crypto.randomUUID()}`;
  const eventCount = reviewed.eventCount + 1;
  const createdAt = "2026-09-17T02:02:00.000Z";
  const intentMismatch = mode === "intent_confirm_mismatch";
  const summaryReviewMismatch = mode === "summary_review_mismatch";
  const candidateReviewMismatch = mode === "candidate_review_mismatch";
  const kind = intentMismatch ? "intent_confirmation" : candidateReviewMismatch ? "candidate" : "summary";
  const difficulty = candidateReviewMismatch ? "child" : null;
  const operation = intentMismatch ? "intent_confirm"
    : summaryReviewMismatch ? "summary_review"
      : candidateReviewMismatch ? "candidate_review" : "summary_edit";
  const statements: D1PreparedStatement[] = [insert(database, "sermon_content_events", {
    sermon_id: context.sermonId,
    event_id: eventId,
    content_sequence: eventCount,
    aggregate_version: context.input.version + eventCount,
    origin: "human",
    kind,
    difficulty,
    generation_job_id: null,
    step_key: null,
    input_version: context.input.version,
    source_id: context.input.source_id,
    document_id: context.input.document_id,
    document_sha256: context.input.document_sha256,
    confirmation_id: context.input.confirmation_id,
    base_analysis_event_id: null,
    analysis_event_id: intentMismatch ? reviewed.summarySnapshotEventId : reviewed.analysisEventId,
    intent_confirmation_event_id: intentMismatch ? null : reviewed.intentConfirmationEventId,
    payload_sha256: payloadSha256,
    payload_byte_length: payload.byteLength,
    payload_chunk_count: 1,
    state: "assembling",
    required_state: "sealed",
    created_by_actor_id: actorId,
    created_at: createdAt,
  })];
  if (options.omit !== "detail") statements.push(insert(database, "sermon_content_human_events", {
    sermon_id: context.sermonId,
    event_id: eventId,
    operation,
    command_key: options.commandKey ?? `command:${crypto.randomUUID()}`,
    base_snapshot_event_id: mode === "summary_edit"
      ? (options.baseSnapshotEventId ?? reviewed.summarySnapshotEventId) : null,
    target_snapshot_event_id: intentMismatch ? reviewed.summarySnapshotEventId
      : summaryReviewMismatch ? reviewed.childPoolEventId
        : candidateReviewMismatch ? reviewed.adultPoolEventId : null,
    restore_source_event_id: null,
    critique_event_id: intentMismatch ? reviewed.critiqueEventId : null,
    intent_confirmation_event_id: intentMismatch ? null : reviewed.intentConfirmationEventId,
    expected_current_review_event_id: mode === "summary_edit" || summaryReviewMismatch
      ? reviewed.summaryReviewEventId
      : candidateReviewMismatch ? reviewed.childReviewEventId : null,
    created_by_actor_id: actorId,
    created_at: createdAt,
  }));
  if (options.omit !== "payload") statements.push(insert(database, "sermon_content_payloads", {
    sermon_id: context.sermonId, event_id: eventId, codec: "content-event-json-utf8-v1",
    chunk_bytes: 65536, chunk_count: 1, byte_length: payload.byteLength,
    payload_sha256: payloadSha256, verified: 0,
  }));
  if (options.omit !== "chunk" && options.omit !== "payload") statements.push(insert(database, "sermon_content_chunks", {
    sermon_id: context.sermonId, event_id: eventId, position: 0, byte_length: payload.byteLength,
    chunk_sha256: chunkSha256, body: payload, verified: 1,
  }));
  if (options.omit !== "head") statements.push(database.prepare(`UPDATE sermon_content_heads
    SET event_count=?,last_event_id=?,required_event_count=?,required_event_id=?
    WHERE sermon_id=? AND event_count=?`).bind(
    eventCount, eventId, eventCount, eventId, context.sermonId, reviewed.eventCount,
  ));
  if (options.omit !== "current") statements.push(database.prepare(`UPDATE sermon_content_current SET
    event_count=?,last_event_id=?,selected_analysis_event_id=?,intent_critique_event_id=?,
    intent_confirmation_event_id=?,summary_snapshot_event_id=?,summary_review_event_id=?,
    child_pool_event_id=?,child_review_event_id=?,adult_pool_event_id=?,adult_review_event_id=?,
    required_event_count=?,required_event_id=? WHERE sermon_id=? AND event_count=?`).bind(
    eventCount,
    eventId,
    reviewed.analysisEventId,
    reviewed.critiqueEventId,
    intentMismatch ? eventId : reviewed.intentConfirmationEventId,
    mode === "summary_edit" ? eventId : reviewed.summarySnapshotEventId,
    mode === "summary_edit" ? (options.keepInvalidReview ? reviewed.summaryReviewEventId : null)
      : summaryReviewMismatch ? eventId : reviewed.summaryReviewEventId,
    reviewed.childPoolEventId,
    candidateReviewMismatch ? eventId : reviewed.childReviewEventId,
    reviewed.adultPoolEventId,
    reviewed.adultReviewEventId,
    eventCount,
    eventId,
    context.sermonId,
    reviewed.eventCount,
  ));
  if (options.omit !== "verify") statements.push(database.prepare(
    "UPDATE sermon_content_payloads SET verified=1 WHERE sermon_id=? AND event_id=? AND verified=0",
  ).bind(context.sermonId, eventId));
  if (options.omit !== "seal") statements.push(database.prepare(
    "UPDATE sermon_content_events SET state='sealed' WHERE sermon_id=? AND event_id=? AND state='assembling'",
  ).bind(context.sermonId, eventId));
  return { eventId, statements };
}

export function reviewedFinalTicketStatements(
  database: D1Database,
  context: { input: InputTuple; quizSetId: string; sermonId: string },
  reviewed: ReviewedContentFixture,
  options: {
    fingerprint?: string;
    omit?: "chunk" | "input" | "seal";
    swapChildAdultReview?: boolean;
    ticketId?: string;
  } = {},
) {
  const ticketId = options.ticketId ?? `ticket:${crypto.randomUUID()}`;
  const fingerprint = options.fingerprint ?? "a".repeat(64);
  const childPlacement = "1".repeat(64);
  const adultPlacement = "2".repeat(64);
  const statements: D1PreparedStatement[] = [insert(database, "final_check_tickets", {
    id: ticketId, sermon_id: context.sermonId, quiz_set_id: context.quizSetId,
    aggregate_version: context.input.version + reviewed.eventCount, metadata_revision: 1,
    input_version: context.input.version, content_event_count: reviewed.eventCount,
    summary_review_id: reviewed.summaryReviewEventId, child_review_id: reviewed.childReviewEventId,
    adult_review_id: reviewed.adultReviewEventId, child_placement_ticket_id: childPlacement,
    adult_placement_ticket_id: adultPlacement, ticket_fingerprint: fingerprint,
    payload_sha256: payloadSha256, payload_byte_length: payload.byteLength, payload_chunk_count: 1,
    state: "assembling", required_state: "sealed", created_at: "2026-09-17T02:01:00.000Z",
  })];
  if (options.omit !== "input") statements.push(insert(database, "final_check_ticket_inputs", {
    ticket_id: ticketId, sermon_id: context.sermonId,
    intent_confirmation_event_id: reviewed.intentConfirmationEventId,
    summary_snapshot_event_id: reviewed.summarySnapshotEventId,
    summary_review_event_id: reviewed.summaryReviewEventId,
    child_pool_event_id: reviewed.childPoolEventId,
    child_review_event_id: options.swapChildAdultReview ? reviewed.adultReviewEventId : reviewed.childReviewEventId,
    adult_pool_event_id: reviewed.adultPoolEventId,
    adult_review_event_id: options.swapChildAdultReview ? reviewed.childReviewEventId : reviewed.adultReviewEventId,
    child_placement_ticket_fingerprint: childPlacement, adult_placement_ticket_fingerprint: adultPlacement,
    child_selection_index: 0, adult_selection_index: 0,
  }));
  if (options.omit !== "chunk") statements.push(insert(database, "final_check_ticket_chunks", {
    ticket_id: ticketId, position: 0, byte_length: payload.byteLength,
    chunk_sha256: chunkSha256, body: payload, verified: 1,
  }));
  if (options.omit !== "seal") statements.push(database.prepare(
    "UPDATE final_check_tickets SET state='sealed' WHERE id=? AND state='assembling'",
  ).bind(ticketId));
  return { ticketId, statements };
}

export async function insertReviewedFinalTicket(
  database: D1Database,
  context: { input: InputTuple; quizSetId: string; sermonId: string },
  reviewed: ReviewedContentFixture,
  ticketId = `ticket:${crypto.randomUUID()}`,
) {
  const bundle = reviewedFinalTicketStatements(database, context, reviewed, { ticketId });
  await database.batch(bundle.statements);
  return ticketId;
}
