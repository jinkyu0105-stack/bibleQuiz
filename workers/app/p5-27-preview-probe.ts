import { openPackedHistoryOperation } from "../_shared/repositories/sermon-history-packed-spike";
import { prepareManualTranscriptSource } from "../_shared/services/manual-transcript-source";
import { SermonHistoryReadError } from "../_shared/repositories/sermon-history-reader";
import { SermonHistoryWriteError } from "../_shared/repositories/sermon-history-writer";
import { HistoryResourceLimitError } from "../_shared/storage/history-resource-limits";

interface ProbeBindings {
  DB: D1Database;
}

type ProbeProfile = "typical" | "boundary" | "concurrent";
interface LeafRequest {
  index: number;
  profile: ProbeProfile;
}

const runId = "p5-27-20260915-r2";
const internalHeader = "p5-27-service-binding-only";
type ProbePhase = "request" | "ready" | "read" | "payload" | "execute";
const safeFailureCodes = new Set([
  "HISTORY_READ_INVALID", "HISTORY_READ_CORRUPT", "HISTORY_READ_CHANGED", "HISTORY_READ_UNAVAILABLE",
  "HISTORY_WRITE_INVALID", "HISTORY_WRITE_CORRUPT", "HISTORY_WRITE_UNAVAILABLE", "HISTORY_WRITE_FAILED",
  "HISTORY_WRITE_UNCERTAIN", "HISTORY_RESOURCE_LIMIT",
]);

function safeFailureCode(error: unknown): string {
  if ((error instanceof SermonHistoryReadError || error instanceof SermonHistoryWriteError ||
    error instanceof HistoryResourceLimitError) && safeFailureCodes.has(error.code)) return error.code;
  return "UNCLASSIFIED";
}

function isLeafRequest(input: unknown): input is LeafRequest {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
  const value = input as Record<string, unknown>;
  return Object.keys(value).length === 2 &&
    Number.isInteger(value.index) && Number(value.index) >= 0 &&
    Number(value.index) < (value.profile === "concurrent" ? 20 : 100) &&
    (value.profile === "typical" || value.profile === "boundary" || value.profile === "concurrent");
}

async function runLeaf(bindings: ProbeBindings, request: LeafRequest, phase: (value: ProbePhase) => void) {
  const sermonId = request.profile === "concurrent" ? "p527-concurrent" :
    `p527-${request.profile}-${request.index.toString().padStart(3, "0")}`;
  phase("read");
  const operation = await openPackedHistoryOperation(bindings.DB, sermonId);
  phase("payload");
  const payload = await prepareManualTranscriptSource({
    sourceMode: "sermon_notes",
    manualSourceKind: "sermon_summary",
    sourceCoverage: "partial_notes",
    rawTranscriptText: request.profile === "typical" ? "TEST_ONLY_P5_27_TYPICAL" : "x".repeat(200_000),
  });
  if (payload.outcome !== "validated") throw new Error("P5_27_PAYLOAD_INVALID");
  phase("execute");
  const result = await operation.execute({
    action: "import_source", expectedVersion: 0, payload: payload.source,
  }, { kind: "human", adminId: "p5-27-synthetic", now: "2026-09-15T00:00:00.000Z" });
  const summary = {
    code: "P5_27_LEAF", runId, index: request.index, profile: request.profile,
    outcome: result.outcome,
    failureCode: result.outcome === "failed" ? result.code : null,
    mutationStatements: operation.metrics.mutationStatements,
    queries: operation.metrics.readQueries + operation.metrics.mutationStatements + operation.metrics.probeQueries,
    operationReads: operation.metrics.operationReads,
    replayCount: 0,
  };
  console.log(JSON.stringify(summary));
  return Response.json(summary);
}

export default {
  async fetch(request, bindings) {
    const url = new URL(request.url);
    if (url.hostname !== "p5-27.invalid" || request.method !== "POST" ||
      request.headers.get("x-p5-27-internal") !== internalHeader) {
      return new Response("Not Found", { status: 404 });
    }
    let phase: ProbePhase = "request";
    let leaf: LeafRequest | null = null;
    try {
      if (url.pathname === "/__p5-27/ready") {
        phase = "ready";
        const [sermons, heads] = await bindings.DB.batch<{ count: number }>([
          bindings.DB.prepare("SELECT count(*) AS count FROM sermons WHERE id LIKE 'p527-%'"),
          bindings.DB.prepare("SELECT count(*) AS count FROM sermon_history_heads WHERE sermon_id LIKE 'p527-%'"),
        ]);
        return Response.json({ code: "P5_27_READY", runId,
          sermons: sermons?.results[0]?.count, heads: heads?.results[0]?.count });
      }
      if (url.pathname === "/__p5-27/leaf") {
        const body: unknown = await request.json();
        if (!isLeafRequest(body)) return Response.json({ code: "INVALID" }, { status: 400 });
        leaf = body;
        return await runLeaf(bindings, body, (value) => { phase = value; });
      }
    } catch (error) {
      const failure = { runId, phase, profile: leaf?.profile ?? null, index: leaf?.index ?? null,
        failureCode: safeFailureCode(error) };
      console.error(JSON.stringify({ code: "P5_27_PROBE_FAILED", ...failure }));
      return Response.json({ code: "FAILED", ...failure }, { status: 500 });
    }
    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<ProbeBindings>;
