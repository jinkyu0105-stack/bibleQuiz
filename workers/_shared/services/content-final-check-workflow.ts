import { z } from "zod";
import { sha256Bytes } from "../storage/sha256";
import { lifecycleId } from "./generation-lifecycle-contract";
import type { ContentWorkflowParams } from "./content-generation";

export const contentFinalCheckParamsSchema = z.strictObject({ kind: z.literal("final-check"),
  jobId: lifecycleId, sermonId: lifecycleId, quizSetId: lifecycleId, requestKey: z.uuid() });
export type ContentFinalCheckParams = z.infer<typeof contentFinalCheckParamsSchema>;
export const displayPreparationParamsSchema = contentFinalCheckParamsSchema.extend({ kind: z.literal("display-prepare") });
export type DisplayPreparationParams = z.infer<typeof displayPreparationParamsSchema>;
export type ContentWorkflowMessage = ContentWorkflowParams | ContentFinalCheckParams | DisplayPreparationParams;
const finalOutput = z.strictObject({ outcome: z.enum(["review_ready", "needs_revision"]) });

export async function finalCheckInstanceId(jobId: string, requestKey: string) {
  lifecycleId.parse(jobId); z.uuid().parse(requestKey);
  return `final-${(await sha256Bytes(new TextEncoder().encode(jobId))).slice(0, 24)}-${requestKey}`;
}
export async function displayPreparationInstanceId(jobId: string, requestKey: string) {
  return (await finalCheckInstanceId(jobId, requestKey)).replace(/^final-/u, "display-");
}
export function displayPreparationEnabled(env: { CONTENT_DISPLAY_PREPARATION_ENABLED?: string; CONTENT_DISPLAY_PREPARATION_SERMON_IDS?: string }, sermonId: string) {
  if (env.CONTENT_DISPLAY_PREPARATION_ENABLED !== "true") return false;
  try {
    const ids: unknown = JSON.parse(env.CONTENT_DISPLAY_PREPARATION_SERMON_IDS ?? "[]");
    return Array.isArray(ids) && ids.every(id => typeof id === "string") && ids.includes(sermonId);
  } catch { return false; }
}
export async function queueDisplayPreparation(workflow: Workflow<ContentWorkflowMessage>, raw: DisplayPreparationParams) {
  const params = displayPreparationParamsSchema.parse(raw), id = await displayPreparationInstanceId(params.jobId, params.requestKey);
  try { await workflow.create({ id, params }); }
  catch { await (await workflow.get(id)).status(); }
  return { outcome: "queued" as const, requestKey: params.requestKey };
}
export async function readDisplayPreparation(workflow: Workflow<ContentWorkflowMessage>, jobId: string, requestKey: string) {
  const state = await (await workflow.get(await displayPreparationInstanceId(jobId, requestKey))).status();
  return { requestKey, outcome: state.status === "complete" && z.strictObject({ outcome: z.literal("prepared") }).safeParse(state.output).success
    ? "prepared" : state.status === "queued" ? "queued" : ["running", "waiting"].includes(state.status) ? "running" : "failed" };
}

/** The explicit request key addresses one final-only instance. Neither a lost
 * response nor a duplicate click creates an AI generation job or provider call. */
export async function queueContentFinalCheck(workflow: Workflow<ContentWorkflowMessage>, params: ContentFinalCheckParams) {
  const parsed = contentFinalCheckParamsSchema.parse(params), id = await finalCheckInstanceId(parsed.jobId, parsed.requestKey);
  try { await workflow.create({ id, params: parsed }); }
  catch {
    // Only a readable instance with this exact identity resolves an ambiguous
    // create. Never restart an errored instance or turn an unknown send into success.
    await (await workflow.get(id)).status();
  }
  return { outcome: "queued" as const, requestKey: parsed.requestKey };
}

export async function readContentFinalCheck(workflow: Workflow<ContentWorkflowMessage>, jobId: string, requestKey: string) {
  const status = await (await workflow.get(await finalCheckInstanceId(jobId, requestKey))).status();
  const completed = status.status === "complete" ? finalOutput.safeParse(status.output) : null;
  const outcome = completed?.success ? completed.data.outcome : status.status === "queued" ? "queued" as const :
    ["running", "waiting"].includes(status.status) ? "running" as const : "failed" as const;
  return { requestKey, outcome };
}
