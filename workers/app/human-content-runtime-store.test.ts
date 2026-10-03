import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createBibleReference } from "../../shared/bible-reference";
import { createDatabase } from "../_shared/db/client";
import {
  createHumanContentRuntimeStore,
  fingerprintFinalCheckTicket,
  HumanContentRuntimeStoreError,
  type AppendHumanContentCommand,
  type CommitFinalCheckTicketCommand,
  type HumanContentCurrentRefs,
} from "../_shared/repositories/human-content-runtime-store";
import { createSermonInputStore, type InputEvent } from "../_shared/repositories/sermon-input-store";
import { createSermonMetadataRepository } from "../_shared/repositories/sermon-metadata-repository";
import { finalCheckTicketSchema, type FinalCheckTicket } from "../_shared/services/final-check-contract";
import {
  acknowledgeStartPlan,
  claimStartDispatch,
  executeGeneration,
  generationCreatePlan,
  generationDb,
  generationTestHash,
  seedGenerationContext,
  type GenerationContext,
  type GenerationCreatePlan,
} from "./test/generation-storage-fixture";
import {
  appendSyntheticComparisonContent,
  seedReviewedHumanContent,
  type ReviewedContentFixture,
} from "./test/human-content-storage-fixture";
import { metadataCommand } from "./test/sermon-metadata-fixture";

const now = "2026-09-17T04:00:00.000Z";
const later = "2026-09-17T04:00:01.000Z";
const actorId = generationTestHash("9");

type ReviewedRuntime = {
  context: GenerationContext;
  input: InputEvent;
  plan: GenerationCreatePlan;
  reviewed: ReviewedContentFixture;
};

async function confirmedInput(context: GenerationContext): Promise<InputEvent> {
  const store = createSermonInputStore(generationDb);
  const sourceId = crypto.randomUUID();
  const confirmationId = crypto.randomUUID();
  const documentSha256 = generationTestHash("1");
  const common = {
    sermon_id: context.sermonId,
    source_type: "caption_plain" as const,
    source_id: sourceId,
    document_id: sourceId,
    document_sha256: documentSha256,
    actor_id: generationTestHash("2"),
  };
  expect(await store.append({
    ...common,
    version: 1,
    id: sourceId,
    kind: "source",
    confirmation_id: null,
    parent_document_id: null,
    related_id: null,
    created_at: now,
  }, { contractVersion: 1, content: "합성 입력" })).toBe("saved");
  expect(await store.append({
    ...common,
    version: 2,
    id: confirmationId,
    kind: "confirm",
    confirmation_id: confirmationId,
    parent_document_id: sourceId,
    related_id: null,
    created_at: later,
  }, { contractVersion: 1, reviewed: true })).toBe("saved");
  const input = await store.head(context.sermonId);
  if (!input) throw new Error("synthetic input unavailable");
  return input;
}

async function reviewedRuntime(): Promise<ReviewedRuntime> {
  const context = await seedGenerationContext();
  const input = await confirmedInput(context);
  const plan = generationCreatePlan(context);
  const job = plan.steps[0]!;
  job.values[8] = "present";
  job.values[9] = input.version;
  job.values[10] = input.source_id;
  job.values[11] = input.document_id;
  job.values[12] = input.document_sha256;
  job.values[13] = input.confirmation_id;
  await executeGeneration(plan.steps);
  expect((await claimStartDispatch(plan)).meta.changes).toBe(1);
  await executeGeneration(acknowledgeStartPlan(plan));
  const reviewed = await seedReviewedHumanContent(generationDb, {
    generationJobId: plan.jobId,
    input,
    sermonId: context.sermonId,
  });
  return { context, input, plan, reviewed };
}

function summaryEditCommand(
  runtime: ReviewedRuntime,
  current: HumanContentCurrentRefs,
  privateCanary = "PRIVATE_HUMAN_CONTENT_CANARY",
): AppendHumanContentCommand {
  return {
    sermonId: runtime.context.sermonId,
    eventId: `summary-edit_${crypto.randomUUID()}`,
    commandKey: `command_${crypto.randomUUID()}`,
    actorId,
    createdAt: "2026-09-17T04:01:00.000Z",
    expectedInput: {
      version: runtime.input.version,
      sourceId: runtime.input.source_id,
      documentId: runtime.input.document_id,
      documentSha256: runtime.input.document_sha256,
      confirmationId: runtime.input.confirmation_id,
    },
    expectedCurrent: current,
    operation: "summary_edit",
    difficulty: null,
    baseSnapshotEventId: current.summarySnapshotEventId,
    targetSnapshotEventId: null,
    restoreSourceEventId: null,
    critiqueEventId: null,
    intentConfirmationEventId: current.intentConfirmationEventId,
    expectedCurrentReviewEventId: current.summaryReviewEventId,
    payload: {
      contractVersion: 1,
      operation: "summary_edit",
      command: { baseSummaryId: current.summarySnapshotEventId, privateCanary },
      materializedSnapshot: { id: "materialized-summary", text: "합성 요약" },
    },
  };
}

function reference() {
  const result = createBibleReference({ bookId: "JHN", chapter: 3, verseStart: 16, verseEnd: 18 });
  if (!result.ok) throw new Error("reference fixture");
  return result.value;
}

function ticketPayload(runtime: ReviewedRuntime, current: HumanContentCurrentRefs): FinalCheckTicket {
  if (!runtime.input.confirmation_id || !current.selectedAnalysisEventId || !current.intentConfirmationEventId ||
    !current.summarySnapshotEventId || !current.summaryReviewEventId || !current.childPoolEventId ||
    !current.childReviewEventId || !current.adultPoolEventId || !current.adultReviewEventId) {
    throw new Error("reviewed current fixture incomplete");
  }
  const version = runtime.input.version + current.eventCount;
  const transcript = {
    sourceId: runtime.input.source_id,
    sourceRevision: 1,
    sourceSha256: runtime.input.document_sha256,
    revisionId: runtime.input.document_id,
    transcriptSha256: runtime.input.document_sha256,
    checksumFormat: "sha256:utf8-working-text:v1" as const,
    confirmationId: runtime.input.confirmation_id,
    version,
  };
  const binding = {
    transcript,
    analysisId: current.selectedAnalysisEventId,
    intentConfirmationId: current.intentConfirmationEventId,
  };
  const options = {
    gridSizes: [5],
    targetWordCounts: [4],
    seed: "p539-synthetic",
    maxTrials: 8,
    searchBudgetPerTrial: 1000,
  };
  return finalCheckTicketSchema.parse({
    sermonId: runtime.context.sermonId,
    expectedVersion: version,
    metadata: {
      contractVersion: 1,
      sermonId: runtime.context.sermonId,
      metadataRevision: 1,
      title: "합성 설교",
      sermonDate: "2026-09-17",
      bibleReference: reference(),
    },
    binding,
    summary: { summaryId: current.summarySnapshotEventId, reviewId: current.summaryReviewEventId, binding },
    placements: {
      child: {
        ticket: { sermonId: runtime.context.sermonId, difficulty: "child", expectedVersion: version,
          poolId: current.childPoolEventId, reviewId: current.childReviewEventId, binding, options },
        index: 0,
      },
      adult: {
        ticket: { sermonId: runtime.context.sermonId, difficulty: "adult", expectedVersion: version,
          poolId: current.adultPoolEventId, reviewId: current.adultReviewEventId, binding, options },
        index: 0,
      },
    },
  });
}

async function ticketCommand(
  runtime: ReviewedRuntime,
  current: HumanContentCurrentRefs,
): Promise<CommitFinalCheckTicketCommand> {
  const payload = ticketPayload(runtime, current);
  const fingerprints = await fingerprintFinalCheckTicket(payload);
  return {
    ticketId: `ticket_${crypto.randomUUID()}`,
    quizSetId: runtime.context.quizSetId,
    sermonId: runtime.context.sermonId,
    createdAt: "2026-09-17T04:02:00.000Z",
    expectedInput: {
      version: runtime.input.version,
      sourceId: runtime.input.source_id,
      documentId: runtime.input.document_id,
      documentSha256: runtime.input.document_sha256,
      confirmationId: runtime.input.confirmation_id,
    },
    expectedCurrent: current,
    expectedMetadataRevision: 1,
    expectedTicketFingerprint: fingerprints.ticketFingerprint,
    inputs: {
      intentConfirmationEventId: current.intentConfirmationEventId!,
      summarySnapshotEventId: current.summarySnapshotEventId!,
      summaryReviewEventId: current.summaryReviewEventId!,
      childPoolEventId: current.childPoolEventId!,
      childReviewEventId: current.childReviewEventId!,
      adultPoolEventId: current.adultPoolEventId!,
      adultReviewEventId: current.adultReviewEventId!,
      childPlacementTicketFingerprint: fingerprints.childPlacementTicketFingerprint,
      adultPlacementTicketFingerprint: fingerprints.adultPlacementTicketFingerprint,
      childSelectionIndex: payload.placements.child.index,
      adultSelectionIndex: payload.placements.adult.index,
    },
    payload,
  };
}

function afterCommittedBatch(database: D1Database, afterCommit?: () => Promise<void>): D1Database {
  let intercepted = false;
  return new Proxy(database, {
    get(target, key) {
      if (key === "batch") return async (statements: D1PreparedStatement[]) => {
        const result = await target.batch(statements);
        if (!intercepted) {
          intercepted = true;
          await afterCommit?.();
          throw new Error("PRIVATE_COMMITTED_RESPONSE_CANARY");
        }
        return result;
      };
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function unavailableDatabase(database: D1Database): D1Database {
  return new Proxy(database, {
    get(target, key) {
      if (key === "prepare") return () => { throw new Error("PRIVATE_READ_FAILURE_CANARY"); };
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

describe("P5-39 human content/final ticket private runtime store / isolated D1", () => {
  it("writes a human event atomically and reads only the bounded current payload set", async () => {
    const runtime = await reviewedRuntime();
    const store = createHumanContentRuntimeStore(generationDb);
    const before = await store.readCurrent(runtime.context.sermonId);
    expect(before?.status).toBe("current");
    if (!before) throw new Error("current fixture missing");
    const command = summaryEditCommand(runtime, before.current);
    const result = await store.appendHuman(command);
    expect(result).toMatchObject({ outcome: "saved", eventId: command.eventId,
      current: { eventCount: 10, summarySnapshotEventId: command.eventId, summaryReviewEventId: null } });
    const after = await store.readCurrent(runtime.context.sermonId);
    expect(after).toMatchObject({ status: "current", current: {
      eventCount: 10, summarySnapshotEventId: command.eventId, summaryReviewEventId: null,
      childReviewEventId: runtime.reviewed.childReviewEventId,
      adultReviewEventId: runtime.reviewed.adultReviewEventId,
    } });
    expect(after?.events.length).toBeLessThanOrEqual(10);
    expect(await store.probeHumanAppend(command)).toBe("exact");
  });

  it("P37-10 preserves reviews for a comparison AI append but makes the old final ticket stale", async () => {
    const runtime = await reviewedRuntime();
    const store = createHumanContentRuntimeStore(generationDb);
    const current = await store.readCurrent(runtime.context.sermonId);
    if (!current) throw new Error("current fixture missing");
    const command = await ticketCommand(runtime, current.current);
    expect(await store.commitFinalTicket(command)).toMatchObject({ outcome: "committed", status: "current" });
    await appendSyntheticComparisonContent(generationDb, {
      generationJobId: runtime.plan.jobId,
      input: runtime.input,
      sermonId: runtime.context.sermonId,
    }, runtime.reviewed);
    const changed = await store.readCurrent(runtime.context.sermonId);
    expect(changed).toMatchObject({ status: "current", current: {
      eventCount: 10,
      summaryReviewEventId: runtime.reviewed.summaryReviewEventId,
      childReviewEventId: runtime.reviewed.childReviewEventId,
      adultReviewEventId: runtime.reviewed.adultReviewEventId,
    } });
    expect(await store.readFinalTicket(command.ticketId)).toMatchObject({ status: "stale" });
    expect(await store.probeFinalTicket(command)).toBe("committed_but_stale");
  });

  it.each(["input", "content", "metadata"] as const)(
    "P37-11 keeps an old ticket stale after a visible-value %s ABA",
    async (kind) => {
      const runtime = await reviewedRuntime();
      const store = createHumanContentRuntimeStore(generationDb);
      const current = await store.readCurrent(runtime.context.sermonId);
      if (!current) throw new Error("current fixture missing");
      const command = await ticketCommand(runtime, current.current);
      await store.commitFinalTicket(command);
      if (kind === "input") {
        const inputs = createSermonInputStore(generationDb);
        const confirmationId = crypto.randomUUID();
        expect(await inputs.append({
          sermon_id: runtime.context.sermonId,
          version: runtime.input.version + 1,
          id: confirmationId,
          kind: "confirm",
          source_type: runtime.input.source_type,
          source_id: runtime.input.source_id,
          document_id: runtime.input.document_id,
          confirmation_id: confirmationId,
          parent_document_id: runtime.input.document_id,
          related_id: null,
          document_sha256: runtime.input.document_sha256,
          actor_id: actorId,
          created_at: "2026-09-17T04:03:00.000Z",
        }, { contractVersion: 1, reviewed: true })).toBe("saved");
      } else if (kind === "content") {
        await appendSyntheticComparisonContent(generationDb, {
          generationJobId: runtime.plan.jobId,
          input: runtime.input,
          sermonId: runtime.context.sermonId,
        }, runtime.reviewed);
      } else {
        const metadata = createSermonMetadataRepository(createDatabase((env as Env).DB));
        await metadata.save({ ...metadataCommand(runtime.context.sermonId, 1), title: "합성 변경" });
        await metadata.save(metadataCommand(runtime.context.sermonId, 2));
      }
      expect(await store.probeFinalTicket(command)).toBe("committed_but_stale");
    },
  );

  it("P37-14 rejects placement fingerprint/options disagreement before writing a ticket", async () => {
    const runtime = await reviewedRuntime();
    const store = createHumanContentRuntimeStore(generationDb);
    const current = await store.readCurrent(runtime.context.sermonId);
    if (!current) throw new Error("current fixture missing");
    const command = await ticketCommand(runtime, current.current);
    command.payload.placements.child.ticket.options.seed = "tampered-options";
    await expect(store.commitFinalTicket(command)).rejects.toMatchObject({ code: "FINAL_TICKET_INVALID" });
    expect(await generationDb.prepare("SELECT id FROM final_check_tickets WHERE id=?")
      .bind(command.ticketId).first()).toBeNull();
  });

  it("P37-15 resolves a committed human response loss from the exact event/payload/head/current bundle", async () => {
    const runtime = await reviewedRuntime();
    const base = createHumanContentRuntimeStore(generationDb);
    const current = await base.readCurrent(runtime.context.sermonId);
    if (!current) throw new Error("current fixture missing");
    const command = summaryEditCommand(runtime, current.current);
    const store = createHumanContentRuntimeStore(afterCommittedBatch(generationDb));
    expect(await store.appendHuman(command)).toMatchObject({ outcome: "replayed", eventId: command.eventId });
    expect((await generationDb.prepare("SELECT count(*) AS total FROM sermon_content_events WHERE event_id=?")
      .bind(command.eventId).first<{ total: number }>())?.total).toBe(1);
  });

  it("P37-16 treats mismatch and read failure as non-success without appending a new event", async () => {
    const runtime = await reviewedRuntime();
    const store = createHumanContentRuntimeStore(generationDb);
    const current = await store.readCurrent(runtime.context.sermonId);
    if (!current) throw new Error("current fixture missing");
    const command = summaryEditCommand(runtime, current.current);
    await store.appendHuman(command);
    const altered = structuredClone(command);
    altered.payload.command = { privateCanary: "PRIVATE_MISMATCH_CANARY" };
    expect(await store.probeHumanAppend(altered)).toBe("mismatch");
    expect(await createHumanContentRuntimeStore(unavailableDatabase(generationDb)).probeHumanAppend(command)).toBe("unavailable");
    expect((await generationDb.prepare("SELECT count(*) AS total FROM sermon_content_events WHERE sermon_id=?")
      .bind(runtime.context.sermonId).first<{ total: number }>())?.total).toBe(10);
  });

  it("P37-17 reports a committed ticket response loss followed by new content as committed_but_stale", async () => {
    const runtime = await reviewedRuntime();
    const base = createHumanContentRuntimeStore(generationDb);
    const current = await base.readCurrent(runtime.context.sermonId);
    if (!current) throw new Error("current fixture missing");
    const command = await ticketCommand(runtime, current.current);
    const database = afterCommittedBatch(generationDb, async () => {
      await appendSyntheticComparisonContent(generationDb, {
        generationJobId: runtime.plan.jobId,
        input: runtime.input,
        sermonId: runtime.context.sermonId,
      }, runtime.reviewed);
    });
    const result = await createHumanContentRuntimeStore(database).commitFinalTicket(command);
    expect(result).toMatchObject({ outcome: "replayed", status: "committed_but_stale" });
    expect(await base.readFinalTicket(command.ticketId)).toMatchObject({ status: "stale" });
  });

  it("P37-18 fails closed when a current payload or ticket chunk is corrupted", async () => {
    const runtime = await reviewedRuntime();
    const store = createHumanContentRuntimeStore(generationDb);
    const current = await store.readCurrent(runtime.context.sermonId);
    if (!current) throw new Error("current fixture missing");
    const command = await ticketCommand(runtime, current.current);
    await store.commitFinalTicket(command);
    await generationDb.prepare("DROP TRIGGER sermon_content_chunk_update_guard").run();
    await generationDb.prepare(`UPDATE sermon_content_chunks SET body=zeroblob(byte_length)
      WHERE sermon_id=? AND event_id=?`).bind(runtime.context.sermonId, runtime.reviewed.summaryReviewEventId).run();
    await expect(store.readCurrent(runtime.context.sermonId)).rejects.toMatchObject({ code: "HUMAN_CONTENT_STORAGE_CORRUPT" });
    await generationDb.prepare("DROP TRIGGER final_check_ticket_chunk_update_guard").run();
    await generationDb.prepare("UPDATE final_check_ticket_chunks SET body=zeroblob(byte_length) WHERE ticket_id=?")
      .bind(command.ticketId).run();
    await expect(store.readFinalTicket(command.ticketId)).rejects.toMatchObject({ code: "HUMAN_CONTENT_STORAGE_CORRUPT" });
  });

  it("P37-20 keeps private canaries out of stable errors and exposes no public DTO", async () => {
    const runtime = await reviewedRuntime();
    const store = createHumanContentRuntimeStore(generationDb);
    const current = await store.readCurrent(runtime.context.sermonId);
    if (!current) throw new Error("current fixture missing");
    const canary = "PRIVATE_P37_20_ACTOR_QUOTE_ANSWER_CANARY";
    const command = summaryEditCommand(runtime, current.current, canary);
    await store.appendHuman(command);
    const conflicting = structuredClone(command);
    conflicting.payload.command = { privateCanary: `${canary}_CHANGED` };
    let caught: unknown;
    try { await store.appendHuman(conflicting); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(HumanContentRuntimeStoreError);
    expect((caught as Error).message).toBe("HUMAN_CONTENT_STATE_CONFLICT");
    expect((caught as Error).message).not.toContain(canary);
    expect(Object.keys(store).sort()).toEqual([
      "appendHuman", "commitFinalTicket", "probeFinalTicket", "probeHumanAppend", "readCurrent", "readFinalTicket",
    ]);
  });
});
