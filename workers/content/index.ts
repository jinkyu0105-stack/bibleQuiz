import { runScheduledDraftCleanup } from "../_shared/services/draft-cleanup";
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { runContentGeneration, contentWorkflowParamsSchema, type ContentGenerationBindings, type ContentWorkflowParams, type GenerationUnit } from "../_shared/services/content-generation";
import { createGenerationLifecycleStore } from "../_shared/repositories/generation-lifecycle-store";
import { contentFinalCheckParamsSchema, finalCheckInstanceId, displayPreparationParamsSchema, displayPreparationInstanceId, displayPreparationEnabled, type ContentFinalCheckParams, type ContentWorkflowMessage } from "../_shared/services/content-final-check-workflow";
import { finishContentGeneration } from "../_shared/services/content-generation-final";
import { prepareDisplayEvent, prepareDisplayFinalPart, verifyPreparedDisplayFinal } from "../_shared/services/content-display-preparation";

export type { ContentWorkflowParams } from "../_shared/services/content-generation";
export class ContentWorkflow extends WorkflowEntrypoint<ContentGenerationBindings, ContentWorkflowMessage> {
  protected async executeFinalCheck(params: ContentFinalCheckParams) {
    const job = await createGenerationLifecycleStore(this.env.DB).readJob(params.jobId);
    if (job.outcome !== "present" || job.value.sermon_id !== params.sermonId || job.value.quiz_set_id !== params.quizSetId ||
      job.value.request_scope !== "full") throw new Error("FINAL_CHECK_OWNER_UNAVAILABLE");
    const result = await finishContentGeneration(this.env.DB, { jobId: params.jobId, sermonId: params.sermonId, quizSetId: params.quizSetId });
    // Workflow state contains only a small disposition. Draft graphs and grids
    // remain in D1 and are read through the existing Access-protected view.
    return { outcome: result.outcome === "review_ready" ? "review_ready" as const : "needs_revision" as const };
  }
  /** Local trial subclass may wrap fetch for a private archive; production uses the normal transport. */
  protected generationOptions(): { fetch?: typeof fetch; archiveResponses?: boolean } {
    return { archiveResponses: this.env.AI_RESPONSE_ARCHIVE_ENABLED === "true" };
  }
  protected executeGeneration(params: ContentWorkflowParams, instanceId: string, unit?: GenerationUnit) {
    return runContentGeneration(this.env, params, instanceId, { ...this.generationOptions(), unit });
  }

  override async run(event: WorkflowEvent<ContentWorkflowMessage>, step: WorkflowStep) {
    if ("kind" in event.payload && event.payload.kind === "display-prepare") {
      const params = displayPreparationParamsSchema.parse(event.payload);
      if (event.instanceId !== await displayPreparationInstanceId(params.jobId, params.requestKey) ||
        !displayPreparationEnabled(this.env, params.sermonId)) throw new Error("DISPLAY_PREPARATION_DISABLED");
      const initial = await step.do("display-owner", { retries: { limit: 0, delay: "1 second" } }, async () => {
        const job = await createGenerationLifecycleStore(this.env.DB).readJob(params.jobId);
        if (job.outcome !== "present" || job.value.sermon_id !== params.sermonId || job.value.quiz_set_id !== params.quizSetId ||
          job.value.request_scope !== "full" || job.value.execution_contract_version !== 3) throw new Error("DISPLAY_PREPARATION_OWNER_UNAVAILABLE");
        const events = await this.env.DB.prepare(`SELECT e.event_id FROM sermon_content_events e
          JOIN sermon_content_domain_lineage l ON l.sermon_id=e.sermon_id AND l.event_id=e.event_id
          WHERE e.sermon_id=? AND e.state='sealed' ORDER BY e.content_sequence`).bind(params.sermonId).all<{event_id: string}>();
        const proof = await this.env.DB.prepare("SELECT ticket_id FROM generation_final_validation_proofs WHERE job_id=?")
          .bind(params.jobId).first<{ticket_id: string}>();
        return { eventIds: events.results.map(e => e.event_id), ticketId: proof?.ticket_id ?? null };
      });
      for (const [index, id] of initial.eventIds.entries()) await step.do(`display-event-${index}`,
        { retries: { limit: 0, delay: "1 second" } }, () => prepareDisplayEvent(this.env.DB, params, id));
      if (initial.ticketId) for (const difficulty of ["child", "adult"] as const) await step.do(`display-grid-${difficulty}`,
        { retries: { limit: 0, delay: "1 second" } }, () => prepareDisplayFinalPart(this.env.DB, params, initial.ticketId!, difficulty));
      if (initial.ticketId) await step.do("display-verify", { retries: { limit: 0, delay: "1 second" } },
        () => verifyPreparedDisplayFinal(this.env.DB, params, initial.ticketId!));
      return { outcome: "prepared" };
    }
    if ("kind" in event.payload) {
      const params = contentFinalCheckParamsSchema.parse(event.payload);
      if (event.instanceId !== await finalCheckInstanceId(params.jobId, params.requestKey)) throw new Error("FINAL_CHECK_ID_MISMATCH");
      const result = await step.do("final-check", { retries: { limit: 0, delay: "1 second" }, timeout: "30 minutes" },
        () => this.executeFinalCheck(params));
      if (result.outcome === "review_ready") await step.do("notify-generation-finished", { retries: { limit: 0, delay: "1 second" } }, async () => {
        const workflow = (this.env as ContentGenerationBindings & { CONTENT_WORKFLOW?: Workflow<ContentWorkflowMessage> }).CONTENT_WORKFLOW;
        try { await (await workflow?.get(params.jobId))?.sendEvent({ type: "content-resume", payload: { dispatchId: `dispatch-${params.jobId}` } }); }
        catch { /* The durable completed job remains authoritative. */ }
        return { outcome: "notified" };
      });
      return result;
    }
    const run = async (params: ContentWorkflowParams) => {
      const unit: GenerationUnit = (name, action) => step.do(`generate-${params.dispatchId}-${name}`,
        { retries: { limit: 0, delay: "1 second" }, timeout: "30 minutes" }, action);
      const result = await this.executeGeneration(params, event.instanceId, unit);
      // Keep the previous completion marker for operators and local tooling.
      // Step outputs contain only small dispositions; private graphs stay in D1.
      return step.do(`generate-${params.dispatchId}`,
        { retries: { limit: 0, delay: "1 second" }, timeout: "30 minutes" }, () => Promise.resolve(result));
    };
    let result = await run(event.payload);
    const store = createGenerationLifecycleStore(this.env.DB), job = await store.readJob(event.instanceId);
    if (job.outcome !== "present" || job.value.request_scope !== "full") return result;
    // D1 is the authority. Events contain only an ID, never private text or approval.
    for (let ordinal = 0; result.outcome === "awaiting_intent_review" || result.outcome === "awaiting_content_review"; ordinal++) {
      const received = await step.waitForEvent(`human-review-${ordinal}`, { type: "content-resume" });
      const params = contentWorkflowParamsSchema.safeParse(received.payload);
      if (!params.success) continue;
      const delivered = await store.readDispatch(params.data.dispatchId);
      if (delivered.outcome !== "present" || delivered.value.job.id !== event.instanceId) continue;
      if (delivered.value.job.status === "review_ready") return { outcome: "review_ready" };
      result = await run(params.data);
    }
    return result;
  }
}

// No cron is registered in configuration. Remote enabling/deployment is separate.
export default {
  async scheduled(event: ScheduledController, env: ContentGenerationBindings & { DRAFT_CLEANUP_ENABLED?: string }) {
    return runScheduledDraftCleanup(env, new Date(event.scheduledTime).toISOString());
  },
};
