import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";

export interface BackupWorkflowParams {
  requestedAt: string;
}

export class BackupWorkflow extends WorkflowEntrypoint<
  Record<string, never>,
  BackupWorkflowParams
> {
  override async run(
    event: WorkflowEvent<BackupWorkflowParams>,
    step: WorkflowStep,
  ) {
    return step.do("confirm scaffold", async () => ({
      requestedAt: event.payload.requestedAt,
      status: "scaffold_only" as const,
    }));
  }
}
