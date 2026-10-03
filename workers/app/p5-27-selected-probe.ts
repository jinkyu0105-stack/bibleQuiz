// Temporary standalone entrypoint. Never imported by the application runtime.
import { createSermonInputStore } from "../_shared/repositories/sermon-input-store";
import { createSermonInputService } from "../_shared/services/sermon-input";
import { prepareManualTranscriptSource } from "../_shared/services/manual-transcript-source";

interface Bindings { DB: D1Database }
type Profile = "typical" | "boundary" | "concurrent";
interface Sample { profile: Profile; index: number }
const runId = "p5-27-caption-30000-20260916";
// A numeric synthetic process marker distinguishes observed concurrent isolates.
let isolate: number | undefined;
function valid(value: unknown): value is Sample {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  return Object.keys(r).length === 2 && ["typical", "boundary", "concurrent"].includes(String(r.profile)) &&
    Number.isInteger(r.index) && Number(r.index) >= 0 && Number(r.index) < (r.profile === "concurrent" ? 20 : 100);
}
function counted(db: D1Database) {
  const counts = { queries: 0, mutationStatements: 0, operationReads: 0 };
  const proxy = new Proxy(db, { get(target, key) {
    if (key === "prepare") return (sql: string) => {
      counts.queries++;
      if (sql.startsWith("SELECT e.* FROM sermon_input_heads")) counts.operationReads++;
      return target.prepare(sql);
    };
    if (key === "batch") return (statements: D1PreparedStatement[]) => {
      counts.mutationStatements += statements.length; return target.batch(statements);
    };
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  return { db: proxy, counts };
}
export default {
  async fetch(request, bindings) {
    const url = new URL(request.url);
    if (url.hostname !== "p5-27.invalid" || request.method !== "POST" || request.headers.get("x-p5-27-internal") !== "p5-27-service-binding-only") return new Response("Not Found", { status: 404 });
    try {
      if (url.pathname === "/__p5-27/ready") {
        const results = await bindings.DB.batch<{ count: number }>([
          bindings.DB.prepare("SELECT count(*) AS count FROM sermons WHERE id LIKE 'p527-%'"),
          bindings.DB.prepare("SELECT count(*) AS count FROM sermon_input_heads WHERE sermon_id LIKE 'p527-%'"),
        ]);
        return Response.json({ code: "P5_27_READY", runId, sermons: results[0]?.results[0]?.count, heads: results[1]?.results[0]?.count });
      }
      if (url.pathname !== "/__p5-27/leaf") return new Response("Not Found", { status: 404 });
      const sample: unknown = await request.json();
      if (!valid(sample)) return Response.json({ code: "INVALID" }, { status: 400 });
      isolate ??= crypto.getRandomValues(new Uint32Array(1))[0]!;
      const sermonId = sample.profile === "concurrent" ? "p527-concurrent" : `p527-${sample.profile}-${String(sample.index).padStart(3, "0")}`;
      // Retain per-invocation fixture preparation in CPU accounting, as in r2.
      const input = await prepareManualTranscriptSource({ sourceMode: "manual_paste", manualSourceKind: "youtube_visible_transcript",
        sourceCoverage: "full_transcript", rawTranscriptText: sample.profile === "typical" ? "TEST_ONLY_P5_27_TYPICAL" : "가".repeat(30_000) });
      if (input.outcome !== "validated") throw new Error("Synthetic input invalid");
      const measured = counted(bindings.DB);
      const result = await createSermonInputService(createSermonInputStore(measured.db)).importPreparedManual(sermonId,
        0, input.source,
        { kind: "human", adminId: "p5-27-synthetic", now: "2026-09-16T00:00:00.000Z" });
      const summary = { code: "P5_27_LEAF", runId, ...sample, isolate,
        outcome: result.outcome === "saved" ? "updated" : "failed",
        failureCode: result.outcome === "failed" ? result.code : null,
        ...measured.counts, replayCount: 0 };
      // The runner keeps this numeric response; native invocation tails supply
      // CPU and the profile/index URL. Duplicating it through console.log would
      // add diagnostic formatting/inspection work to the measured operation.
      return Response.json(summary);
    } catch {
      // No exception details, request data, IDs, hashes or private bodies in logs.
      return Response.json({ code: "FAILED", runId }, { status: 500 });
    }
  },
} satisfies ExportedHandler<Bindings>;
