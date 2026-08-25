import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";

export interface ContentWorkflowParams {
  requestedAt: string;
}

export class ContentWorkflow extends WorkflowEntrypoint<
  Record<string, never>,
  ContentWorkflowParams
> {
  override async run(
    event: WorkflowEvent<ContentWorkflowParams>,
    step: WorkflowStep,
  ) {
    return step.do("confirm scaffold", async () => ({
      requestedAt: event.payload.requestedAt,
      status: "scaffold_only" as const,
    }));
  }
}
