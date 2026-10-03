// Standalone opt-in Preview entry. No fetch/scheduled handler, key or real AI transport.
import { ContentWorkflow, type ContentWorkflowParams } from "./index";
import { runContentGeneration, type GenerationUnit } from "../_shared/services/content-generation";
import { createSermonInputStore } from "../_shared/repositories/sermon-input-store";
import { createSermonInputService } from "../_shared/services/sermon-input";
import { meterD1 } from "../../scripts/p5-71-d1-meter";
import { marker, syntheticProvider, syntheticTranscript } from "../../scripts/p5-71-synthetic-provider";
import type { ContentFinalCheckParams } from "../_shared/services/content-final-check-workflow";

export async function runPreviewMeasurement(db: D1Database, params: ContentWorkflowParams, instanceId: string,
  enabled?: string, scenario?: string, unit?: GenerationUnit, archiveResponses = false) {
  if (enabled !== "true") return { outcome: "disabled" as const };
  if (scenario !== "success" && scenario !== "invalid_output") return { outcome: "unavailable" as const };
  // Refuse unrelated jobs before any mutation. Synthetic input is checked again by the no-network transport.
  const preflight = meterD1(db);
  const owner = await preflight.db.prepare(`SELECT m.title,j.sermon_id FROM generation_jobs j JOIN generation_job_dispatches d
    ON d.generation_job_id=j.id JOIN sermon_metadata_drafts m ON m.sermon_id=j.sermon_id
    WHERE j.id=? AND j.workflow_instance_id=? AND d.id=?`).bind(instanceId, instanceId, params.dispatchId).first<{ title: string; sermon_id: string }>();
  if (owner?.title !== marker) return { outcome: "unavailable" as const };
  const current = await createSermonInputService(createSermonInputStore(preflight.db)).current(owner.sermon_id);
  if (current.outcome !== "loaded" || current.input?.content.format !== "plain_text") return { outcome: "unavailable" as const };
  const text = current.input.content.text;
  if (![11715, 30000].includes(text.length) || text !== syntheticTranscript(text.length)) return { outcome: "unavailable" as const };
  const measured = meterD1(db), provider = syntheticProvider(scenario), started = Date.now();
  const measuredUnit: GenerationUnit | undefined = unit ? (name, action) => unit(name, async () => {
    const before = { ...measured.counts }, responses = provider.stats.syntheticResponses;
    try { return await action(); }
    finally { console.log(JSON.stringify({ code: "P571_MEASUREMENT_UNIT", unit: name,
      d1Calls: measured.counts.d1Calls - before.d1Calls, sqlStatements: measured.counts.sqlStatements - before.sqlStatements,
      blockedCalls: measured.counts.blockedCalls - before.blockedCalls,
      syntheticResponses: provider.stats.syntheticResponses - responses, paidCalls: 0, cpuMs: null })); }
  }) : undefined;
  try {
    return await runContentGeneration({ DB: measured.db, AI_GENERATION_ENABLED: "true", OPENAI_API_KEY: "synthetic-only-not-a-key" },
      params, instanceId, { fetch: provider.fetch, unit: measuredUnit, archiveResponses });
  } finally {
    console.log(JSON.stringify({ code: "P571_MEASUREMENT", jobId: instanceId, dispatchId: params.dispatchId,
      scenario, preflightD1Calls: preflight.counts.d1Calls, ...measured.counts, ...provider.stats, wallMs: Date.now() - started, cpuMs: null }));
  }
}

export class PreviewMeasurementWorkflow extends ContentWorkflow {
  protected override async executeFinalCheck(params: ContentFinalCheckParams) {
    const env = this.env as typeof this.env & { P571_MEASUREMENT_ENABLED?: string };
    if (env.P571_MEASUREMENT_ENABLED !== "true") throw new Error("MEASUREMENT_DISABLED");
    const owner = await env.DB.prepare("SELECT title FROM sermon_metadata_drafts WHERE sermon_id=?").bind(params.sermonId).first<{ title: string }>();
    const current = await createSermonInputService(createSermonInputStore(env.DB)).current(params.sermonId);
    if (owner?.title !== marker || current.outcome !== "loaded" || current.input?.content.format !== "plain_text" ||
      ![11715, 30000].includes(current.input.content.text.length) ||
      current.input.content.text !== syntheticTranscript(current.input.content.text.length)) throw new Error("MEASUREMENT_OWNER_UNAVAILABLE");
    return super.executeFinalCheck(params);
  }
  protected override executeGeneration(params: ContentWorkflowParams, instanceId: string, unit?: GenerationUnit) {
    const env = this.env as typeof this.env & { P571_MEASUREMENT_ENABLED?: string; P571_SCENARIO?: string };
    return runPreviewMeasurement(env.DB, params, instanceId, env.P571_MEASUREMENT_ENABLED, env.P571_SCENARIO, unit,
      env.AI_RESPONSE_ARCHIVE_ENABLED === "true");
  }
}

export default {};
