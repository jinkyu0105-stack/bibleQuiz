import { beforeAll, describe, expect, it } from "vitest";

import {
  createGenerationRuntimeStore,
  GenerationRuntimeStoreError,
  type ClaimGenerationStepCommand,
  type CreateGenerationJobCommand,
  type GenerationDomainResultPort,
  type GenerationResultReference,
} from "../_shared/repositories/generation-runtime-store";
import {
  dispatchGeneration,
  reconcileGenerationAuthority,
  runGenerationStep,
  type GenerationDispatchPayload,
  type GenerationDispatchProbeResult,
  type GenerationDispatchSendResult,
  type GenerationDispatchTransport,
  type GenerationStepTransport,
} from "../_shared/services/generation-runtime";
import {
  generationDb,
  generationTestHash,
  seedGenerationContext,
  type GenerationContext,
} from "./test/generation-storage-fixture";

const t0 = "2026-09-17T00:00:00.000Z";
const t1 = "2026-09-17T00:00:01.000Z";
const t2 = "2026-09-17T00:00:02.000Z";
const t3 = "2026-09-17T00:00:03.000Z";
const t4 = "2026-09-17T00:00:04.000Z";
const lease = "2026-09-17T00:10:00.000Z";

function createCommand(context: GenerationContext, suffix = crypto.randomUUID()): CreateGenerationJobCommand {
  const jobId = `job:${suffix}`;
  return {
    id: jobId,
    sermonId: context.sermonId,
    quizSetId: context.quizSetId,
    requestScope: "full",
    requestKey: `request:${suffix}`,
    requestFingerprint: generationTestHash("a"),
    workflowInstanceId: `workflow:${suffix}`,
    startInput: { state: "absent" },
    startMetadataRevision: 1,
    settingsRevision: null,
    selectionRevision: null,
    actorId: generationTestHash("b"),
    createdAt: t0,
    dispatchId: `dispatch:${suffix}`,
    dispatchKey: `start:${suffix}`,
    dispatchPayloadFingerprint: generationTestHash("c"),
  };
}

class SyntheticWorkflowTransport implements GenerationDispatchTransport {
  readonly calls: GenerationDispatchPayload[] = [];
  readonly instances = new Map<string, { requestFingerprint: string; dispatchKeys: Set<string> }>();
  sendOutcome: GenerationDispatchSendResult["outcome"] = "accepted";
  probeOverride: GenerationDispatchProbeResult | null = null;

  async send(payload: GenerationDispatchPayload): Promise<GenerationDispatchSendResult> {
    this.calls.push(structuredClone(payload));
    if (this.sendOutcome !== "confirmed_missing") {
      const instance = this.instances.get(payload.workflowInstanceId) ?? {
        requestFingerprint: payload.requestFingerprint,
        dispatchKeys: new Set<string>(),
      };
      instance.dispatchKeys.add(payload.dispatchKey);
      this.instances.set(payload.workflowInstanceId, instance);
    }
    return { outcome: this.sendOutcome };
  }

  async probe(workflowInstanceId: string, dispatchKey: string): Promise<GenerationDispatchProbeResult> {
    if (this.probeOverride) return this.probeOverride;
    const instance = this.instances.get(workflowInstanceId);
    return instance ? {
      outcome: "exists",
      requestFingerprint: instance.requestFingerprint,
      dispatchAcknowledged: instance.dispatchKeys.has(dispatchKey),
    } : { outcome: "missing" };
  }
}

const resultPort: GenerationDomainResultPort = {
  prepareInsert(database, reference) {
    return database.prepare(`INSERT INTO generation_test_results (id,kind,version,fingerprint)
      VALUES (?,?,?,?)`).bind(reference.id, reference.kind, reference.version, reference.fingerprint);
  },
  async probe(database, reference) {
    try {
      const result = await database.prepare(
        "SELECT id,kind,version,fingerprint FROM generation_test_results WHERE id=?",
      ).bind(reference.id).all();
      if (!result.success || result.results.length > 1) return "unavailable";
      if (result.results.length === 0) return "absent";
      const row = result.results[0];
      return row?.id === reference.id && row.kind === reference.kind && row.version === reference.version &&
        row.fingerprint === reference.fingerprint ? "exact" : "mismatch";
    } catch {
      return "unavailable";
    }
  },
};

class SyntheticStepTransport implements GenerationStepTransport {
  calls = 0;
  outcome: "completed" | "response_lost" = "completed";
  readonly result: GenerationResultReference;

  constructor(resultId = `result:${crypto.randomUUID()}`) {
    this.result = { kind: "validation_result", id: resultId, version: 1, fingerprint: generationTestHash("e") };
  }

  async invoke() {
    this.calls++;
    return this.outcome === "completed"
      ? { outcome: "completed" as const, result: this.result }
      : { outcome: "response_lost" as const };
  }
}

function stepCommand(jobId: string, overrides: Partial<ClaimGenerationStepCommand> = {}): ClaimGenerationStepCommand {
  return {
    jobId,
    stepKey: "summary:1",
    task: "validate",
    effectClass: "pure",
    inputFingerprint: generationTestHash("d"),
    inputVersion: null,
    sourceId: null,
    documentId: null,
    documentSha256: null,
    confirmationId: null,
    metadataRevision: 1,
    bindingId: null,
    ticketId: null,
    claimToken: `claim:${crypto.randomUUID()}`,
    leaseExpiresAt: lease,
    now: t2,
    ...overrides,
  };
}

async function createRunning(
  database: D1Database = generationDb,
  transport = new SyntheticWorkflowTransport(),
) {
  const context = await seedGenerationContext();
  const store = createGenerationRuntimeStore(database);
  const command = createCommand(context);
  const created = await store.createJob(command);
  expect(created.outcome).toBe("created");
  const dispatched = await dispatchGeneration(store, transport, {
    dispatchId: command.dispatchId,
    claimToken: `dispatch-claim:${crypto.randomUUID()}`,
    leaseExpiresAt: lease,
    now: t1,
  });
  expect(dispatched.outcome).toBe("acknowledged");
  return { command, context, store, transport };
}

function responseLossDatabase(): D1Database {
  let lost = false;
  return new Proxy(generationDb, {
    get(target, key) {
      if (key === "batch") return async (statements: D1PreparedStatement[]) => {
        const results = await target.batch(statements);
        if (!lost) {
          lost = true;
          throw new Error("PRIVATE_COMMITTED_RESPONSE_CANARY");
        }
        return results;
      };
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

beforeAll(async () => {
  await generationDb.prepare(`CREATE TABLE IF NOT EXISTS generation_test_results (
    id TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL,
    version INTEGER NOT NULL,
    fingerprint TEXT NOT NULL
  )`).run();
});

describe("P5-33 generation runtime store and synthetic transports", () => {
  it("completes J31-02 request replay and rejects the same request key with another fingerprint", async () => {
    const context = await seedGenerationContext();
    const store = createGenerationRuntimeStore(generationDb);
    const command = createCommand(context);
    expect((await store.createJob(command)).outcome).toBe("created");
    expect((await store.createJob({ ...command, id: `ignored:${crypto.randomUUID()}` })).outcome).toBe("replayed");
    await expect(store.createJob({ ...command, requestFingerprint: generationTestHash("f") }))
      .rejects.toMatchObject({ code: "GENERATION_REQUEST_CONFLICT" });
    expect((await generationDb.prepare("SELECT count(*) AS total FROM generation_jobs WHERE request_key=?")
      .bind(command.requestKey).first<{ total: number }>())?.total).toBe(1);
  });

  it("J31-05 recovers a pending start after a pre-call crash with the fixed instance", async () => {
    const context = await seedGenerationContext();
    const store = createGenerationRuntimeStore(generationDb);
    const command = createCommand(context);
    await store.createJob(command);
    const transport = new SyntheticWorkflowTransport();
    const result = await dispatchGeneration(store, transport, {
      dispatchId: command.dispatchId, claimToken: "claim:start", leaseExpiresAt: lease, now: t1,
    });
    expect(result.outcome).toBe("acknowledged");
    expect(transport.calls).toMatchObject([{ workflowInstanceId: command.workflowInstanceId, dispatchKey: command.dispatchKey }]);
    expect(new Set(transport.calls.map((call) => call.workflowInstanceId))).toEqual(new Set([command.workflowInstanceId]));
  });

  it("J31-06 probes the same instance after a lost create response and replays without another start", async () => {
    const context = await seedGenerationContext();
    const store = createGenerationRuntimeStore(generationDb);
    const command = createCommand(context);
    await store.createJob(command);
    const transport = new SyntheticWorkflowTransport();
    transport.sendOutcome = "response_lost";
    expect((await dispatchGeneration(store, transport, {
      dispatchId: command.dispatchId, claimToken: "claim:lost", leaseExpiresAt: lease, now: t1,
    })).outcome).toBe("acknowledged");
    expect((await dispatchGeneration(store, transport, {
      dispatchId: command.dispatchId, claimToken: "claim:replay", leaseExpiresAt: lease, now: t2,
    })).outcome).toBe("replayed");
    expect(transport.calls).toHaveLength(1);
  });

  it("J31-07 keeps an unavailable probe uncertain and closes a mismatched instance without a new ID", async () => {
    const firstContext = await seedGenerationContext();
    const firstStore = createGenerationRuntimeStore(generationDb);
    const first = createCommand(firstContext);
    await firstStore.createJob(first);
    const unavailable = new SyntheticWorkflowTransport();
    unavailable.sendOutcome = "response_lost";
    unavailable.probeOverride = { outcome: "unavailable" };
    expect((await dispatchGeneration(firstStore, unavailable, {
      dispatchId: first.dispatchId, claimToken: "claim:uncertain", leaseExpiresAt: lease, now: t1,
    })).outcome).toBe("uncertain");
    expect((await firstStore.dispatchById(first.dispatchId))?.state).toBe("uncertain");
    expect((await dispatchGeneration(firstStore, unavailable, {
      dispatchId: first.dispatchId, claimToken: "claim:not-used", leaseExpiresAt: lease, now: t2,
    })).outcome).toBe("uncertain");
    expect(unavailable.calls).toHaveLength(1);

    const secondContext = await seedGenerationContext();
    const secondStore = createGenerationRuntimeStore(generationDb);
    const second = createCommand(secondContext);
    await secondStore.createJob(second);
    const mismatch = new SyntheticWorkflowTransport();
    mismatch.sendOutcome = "response_lost";
    mismatch.probeOverride = {
      outcome: "exists", requestFingerprint: generationTestHash("f"), dispatchAcknowledged: true,
    };
    expect((await dispatchGeneration(secondStore, mismatch, {
      dispatchId: second.dispatchId, claimToken: "claim:mismatch", leaseExpiresAt: lease, now: t1,
    })).outcome).toBe("terminal");
    expect((await secondStore.jobById(second.id))?.status).toBe("failed");
    expect(mismatch.calls[0]?.workflowInstanceId).toBe(second.workflowInstanceId);
  });

  it("completes J31-09 step replay without a second transport or result write and rejects input mismatch", async () => {
    const { command, store } = await createRunning();
    const transport = new SyntheticStepTransport();
    const claim = stepCommand(command.id);
    const first = await runGenerationStep(store, transport, resultPort, {
      claim, providerRequestIdOpaque: null, nextStep: "intent_review", effectStartedAt: t3, completedAt: t4,
    });
    expect(first.outcome).toBe("succeeded");
    const replay = await runGenerationStep(store, transport, resultPort, {
      claim: { ...claim, claimToken: "claim:ignored", now: t4 }, providerRequestIdOpaque: null,
      nextStep: "intent_review", effectStartedAt: t3, completedAt: t4,
    });
    expect(replay.outcome).toBe("replayed");
    expect(transport.calls).toBe(1);
    await expect(store.claimStep({ ...claim, inputFingerprint: generationTestHash("f"), claimToken: "claim:mismatch" }))
      .rejects.toMatchObject({ code: "GENERATION_STEP_INPUT_MISMATCH" });
  });

  it("J31-12 never blind-retries after effect_started before a crash or after a lost provider response", async () => {
    const beforeCall = await createRunning();
    const beforeTransport = new SyntheticStepTransport();
    const beforeClaim = stepCommand(beforeCall.command.id, { effectClass: "ai_provider", claimToken: "claim:before" });
    const claimed = await beforeCall.store.claimStep(beforeClaim);
    expect(claimed.outcome).toBe("claimed");
    if (claimed.outcome !== "claimed") throw new Error("unreachable");
    await beforeCall.store.markStepEffectStarted(beforeCall.command.id, beforeClaim.stepKey, 1,
      beforeClaim.claimToken, generationTestHash("1"), t3);
    expect((await runGenerationStep(beforeCall.store, beforeTransport, resultPort, {
      claim: beforeClaim, providerRequestIdOpaque: generationTestHash("1"), nextStep: "unused",
      effectStartedAt: t3, completedAt: t4,
    })).outcome).toBe("uncertain");
    expect(beforeTransport.calls).toBe(0);

    const afterCall = await createRunning();
    const lostTransport = new SyntheticStepTransport();
    lostTransport.outcome = "response_lost";
    const lostClaim = stepCommand(afterCall.command.id, { effectClass: "ai_provider", claimToken: "claim:after" });
    expect((await runGenerationStep(afterCall.store, lostTransport, resultPort, {
      claim: lostClaim, providerRequestIdOpaque: generationTestHash("2"), nextStep: "unused",
      effectStartedAt: t3, completedAt: t4,
    })).outcome).toBe("uncertain");
    expect((await runGenerationStep(afterCall.store, lostTransport, resultPort, {
      claim: lostClaim, providerRequestIdOpaque: generationTestHash("2"), nextStep: "unused",
      effectStartedAt: t3, completedAt: t4,
    })).outcome).toBe("uncertain");
    expect(lostTransport.calls).toBe(1);
  });

  it("J31-14 resolves a committed D1 response loss only from its exact result and receipt", async () => {
    const running = await createRunning();
    const lostStore = createGenerationRuntimeStore(responseLossDatabase());
    const transport = new SyntheticStepTransport();
    const outcome = await runGenerationStep(lostStore, transport, resultPort, {
      claim: stepCommand(running.command.id), providerRequestIdOpaque: null, nextStep: "intent_review",
      effectStartedAt: t3, completedAt: t4,
    });
    expect(outcome.outcome).toBe("replayed");
    expect(transport.calls).toBe(1);
    expect((await lostStore.receiptByKey(running.command.id, "summary:1"))?.state).toBe("succeeded");
  });

  it("J31-13/J31-14 treats an exact result without its own succeeded receipt as uncertain", async () => {
    const running = await createRunning();
    const store = running.store;
    const transport = new SyntheticStepTransport();
    await generationDb.prepare("INSERT INTO generation_test_results (id,kind,version,fingerprint) VALUES (?,?,?,?)")
      .bind(transport.result.id, transport.result.kind, transport.result.version, transport.result.fingerprint).run();
    await expect(runGenerationStep(store, transport, resultPort, {
      claim: stepCommand(running.command.id), providerRequestIdOpaque: null, nextStep: "intent_review",
      effectStartedAt: t3, completedAt: t4,
    })).rejects.toMatchObject({ code: "GENERATION_STEP_UNCERTAIN" });
    expect((await store.receiptByKey(running.command.id, "summary:1"))?.state).toBe("claimed");
  });

  it("J31-15 ignores forged signal content and does not resume without authoritative readiness", async () => {
    const running = await createRunning();
    await running.store.enterWait(running.command.id, 1, "transcript_review", generationTestHash("7"), t2);
    const result = await reconcileGenerationAuthority(running.store, {
      readCurrent: async () => ({ outcome: "waiting" }),
    }, {
      jobId: running.command.id,
      signalPayload: { confirmationId: "forged", transcript: "PRIVATE_SIGNAL_CANARY" },
      now: t3,
    });
    expect(result).toEqual({ outcome: "waiting" });
    expect((await generationDb.prepare(
      "SELECT count(*) AS total FROM generation_job_dispatches WHERE generation_job_id=? AND kind<>'start'",
    ).bind(running.command.id).first<{ total: number }>())?.total).toBe(0);
  });

  it("J31-16 recreates one deterministic resume dispatch and probes a lost signal on the same instance", async () => {
    const transport = new SyntheticWorkflowTransport();
    const running = await createRunning(generationDb, transport);
    await running.store.enterWait(running.command.id, 1, "transcript_review", generationTestHash("7"), t2);
    const authority = { readCurrent: async () => ({
      outcome: "ready" as const,
      lineageFingerprint: generationTestHash("7"),
      resumePayloadFingerprint: generationTestHash("8"),
    }) };
    const first = await reconcileGenerationAuthority(running.store, authority, {
      jobId: running.command.id, signalPayload: { ignored: true }, now: t3,
    });
    const replay = await reconcileGenerationAuthority(running.store, authority, {
      jobId: running.command.id, signalPayload: { ignored: "again" }, now: t3,
    });
    expect(first.outcome).toBe("resume_created");
    expect(replay).toEqual({ outcome: "resume_replayed", dispatchId: first.outcome === "resume_created" ? first.dispatchId : "" });
    if (first.outcome !== "resume_created") throw new Error("unreachable");
    transport.sendOutcome = "response_lost";
    expect((await dispatchGeneration(running.store, transport, {
      dispatchId: first.dispatchId, claimToken: "claim:resume", leaseExpiresAt: lease, now: t4,
    })).outcome).toBe("acknowledged");
    expect(transport.calls.filter((call) => call.dispatchKind === "resume_transcript_review")).toHaveLength(1);
    expect(new Set(transport.calls.map((call) => call.workflowInstanceId))).toEqual(new Set([running.command.workflowInstanceId]));
  });

  it("J31-17 marks changed transcript lineage stale once and starts no later step", async () => {
    const running = await createRunning();
    await running.store.enterWait(running.command.id, 1, "transcript_review", generationTestHash("7"), t2);
    const result = await reconcileGenerationAuthority(running.store, {
      readCurrent: async () => ({
        outcome: "ready", lineageFingerprint: generationTestHash("9"),
        resumePayloadFingerprint: generationTestHash("8"),
      }),
    }, { jobId: running.command.id, signalPayload: {}, now: t3 });
    expect(result).toEqual({ outcome: "stale" });
    expect((await running.store.jobById(running.command.id))?.status).toBe("stale");
    expect((await generationDb.prepare("SELECT count(*) AS total FROM generation_step_receipts WHERE generation_job_id=?")
      .bind(running.command.id).first<{ total: number }>())?.total).toBe(0);
  });

  it("J31-18 closes a running job stale when authoritative intent/metadata ticket changes", async () => {
    const running = await createRunning();
    const calls = { provider: 0 };
    const result = await reconcileGenerationAuthority(running.store, {
      readCurrent: async () => ({ outcome: "stale", reasonFingerprint: generationTestHash("6") }),
    }, { jobId: running.command.id, signalPayload: { metadataRevision: 999 }, now: t2 });
    expect(result).toEqual({ outcome: "stale" });
    expect((await running.store.jobById(running.command.id))?.status).toBe("stale");
    expect(calls.provider).toBe(0);
  });

  it("keeps private transport errors out of generation rows and fixed-code exceptions", async () => {
    const context = await seedGenerationContext();
    const store = createGenerationRuntimeStore(generationDb);
    const command = createCommand(context);
    await store.createJob(command);
    const transport: GenerationDispatchTransport = {
      send: async () => { throw new Error("PRIVATE_HEADER_EMAIL_TRANSCRIPT_CANARY"); },
      probe: async () => ({ outcome: "unavailable" }),
    };
    expect((await dispatchGeneration(store, transport, {
      dispatchId: command.dispatchId, claimToken: "claim:private", leaseExpiresAt: lease, now: t1,
    })).outcome).toBe("uncertain");
    const rows = await Promise.all([
      generationDb.prepare("SELECT * FROM generation_jobs WHERE id=?").bind(command.id).all(),
      generationDb.prepare("SELECT * FROM generation_job_events WHERE generation_job_id=?").bind(command.id).all(),
      generationDb.prepare("SELECT * FROM generation_job_dispatches WHERE generation_job_id=?").bind(command.id).all(),
    ]);
    expect(JSON.stringify(rows)).not.toContain("PRIVATE_HEADER_EMAIL_TRANSCRIPT_CANARY");
    expect(new GenerationRuntimeStoreError("GENERATION_INVALID").message).toBe("GENERATION_INVALID");
  });
});
