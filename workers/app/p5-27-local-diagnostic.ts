// Synthetic local workerd diagnostic only. No Wrangler deployment configuration.
import { openPackedHistoryOperation } from "../_shared/repositories/sermon-history-packed-spike";
import { SermonHistoryReadError } from "../_shared/repositories/sermon-history-reader";
import { SermonHistoryWriteError } from "../_shared/repositories/sermon-history-writer";
import { prepareManualTranscriptSource } from "../_shared/services/manual-transcript-source";
import previewProbe from "./p5-27-preview-probe";

const human = { kind: "human", adminId: "p5-27-synthetic", now: "2026-09-15T00:00:00.000Z" };
const modes = ["baseline", "wrapper", "payload", "operation", "read", "race"] as const;
type Mode = typeof modes[number];

async function payload(profile: string) {
  const result = await prepareManualTranscriptSource({
    sourceMode: "sermon_notes", manualSourceKind: "sermon_summary", sourceCoverage: "partial_notes",
    rawTranscriptText: profile === "typical" ? "TEST_ONLY_P5_27_TYPICAL" : "x".repeat(200_000),
  });
  if (result.outcome !== "validated") throw new Error("SYNTHETIC_PAYLOAD_INVALID");
  return result.source;
}

export default {
  async fetch(request, bindings) {
    const url = new URL(request.url);
    if (url.hostname !== "p5-27-local.invalid" || request.method !== "POST") return new Response(null, { status: 404 });
    const mode = url.pathname.slice(1) as Mode;
    const body: unknown = await request.json();
    if (!modes.includes(mode) || !body || typeof body !== "object") return new Response(null, { status: 400 });
    const { profile, index, sermonId } = body as Record<string, unknown>;
    if ((profile !== "typical" && profile !== "boundary" && profile !== "concurrent") ||
      !Number.isInteger(index) || Number(index) < 0 || Number(index) >= 100 ||
      typeof sermonId !== "string" || !/^p527-[a-z0-9-]{1,80}$/u.test(sermonId)) return new Response(null, { status: 400 });
    if (mode === "baseline") return previewProbe.fetch(new Request("https://p5-27.invalid/__p5-27/leaf", {
      method: "POST", headers: { "x-p5-27-internal": "p5-27-service-binding-only" },
      body: JSON.stringify({ profile, index }),
    }), bindings);
    if (mode === "wrapper") {
      // Excludes DB/domain work, retains the original result serialization/logging shape.
      const summary = { code: "P5_27_LEAF", runId: "p5-27-local-only", index, profile,
        outcome: "updated", failureCode: null, mutationStatements: 21, queries: 34, operationReads: 1, replayCount: 0 };
      console.log(JSON.stringify(summary));
      return Response.json(summary);
    }
    const spans: { phase: string; wallMs: number; statements?: number }[] = [];
    let phase = "read", batches = 0, winner: string | null = null;
    const started = performance.now();
    const db = new Proxy(bindings.DB, {
      get(target, key) {
        if (key === "batch") return async (statements: D1PreparedStatement[]) => {
          const start = performance.now();
          const result = await target.batch(statements);
          spans.push({ phase: `batch-${++batches}`, wallMs: performance.now() - start, statements: statements.length });
          if (mode === "race" && batches === 1) {
            // Deterministically commit another real operation between H0 and H1.
            const other = await openPackedHistoryOperation(target, sermonId);
            winner = (await other.execute({ action: "import_source", expectedVersion: 0,
              payload: await payload(profile) }, human)).outcome;
          }
          return result;
        };
        const value: unknown = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    try {
      if (mode === "payload") {
        phase = "payload";
        await payload(profile);
        return Response.json({ outcome: "validated", wallMs: performance.now() - started });
      }
      const operation = await openPackedHistoryOperation(db, sermonId);
      spans.push({ phase: "read", wallMs: performance.now() - started });
      if (mode === "read") return Response.json({ outcome: "read", spans, metrics: operation.metrics });
      phase = "payload";
      const payloadStart = performance.now();
      const source = await payload(profile);
      spans.push({ phase, wallMs: performance.now() - payloadStart });
      phase = "execute";
      const executeStart = performance.now();
      const result = await operation.execute({ action: "import_source", expectedVersion: 0, payload: source }, human);
      spans.push({ phase, wallMs: performance.now() - executeStart });
      return Response.json({ outcome: result.outcome, failureCode: result.outcome === "failed" ? result.code : null,
        spans, metrics: operation.metrics, wallMs: performance.now() - started });
    } catch (error) {
      // Fixed allowlisted codes only: never exception text, SQL, content, hash or cause.
      const failureCode = error instanceof SermonHistoryReadError || error instanceof SermonHistoryWriteError
        ? error.code : "UNCLASSIFIED";
      return Response.json({ outcome: "caught", failureCode, phase, winner, spans,
        wallMs: performance.now() - started }, { status: 500 });
    }
  },
} satisfies ExportedHandler<{ DB: D1Database }>;
