import { runScheduledDraftCleanup } from "../_shared/services/draft-cleanup";
import { createDatabase } from "../_shared/db/client";
import { createQuizFinalizationScheduler } from "../_shared/services/quiz-finalization-scheduler";
import { app, type AppBindings } from "./app";
import { fetchWithAdminCompute, type AdminComputeBindings } from "./admin-compute";

export { app };
export { AdminCompute } from "./admin-compute";

export async function runScheduledFinalization(
  controller: ScheduledController,
  bindings: AppBindings,
) {
  if (bindings.OPERATIONS_CRON_ENABLED !== "true") return { outcome: "disabled" as const };
  const now = new Date(controller.scheduledTime);
  try {
    const summary = await createQuizFinalizationScheduler(createDatabase(bindings.DB)).run(now);
    // Cleanup uses the existing seven-day guards and remains independently opt-in.
    const cleanup = await runScheduledDraftCleanup(bindings, now.toISOString());
    const level = summary.failed === 0 ? "info" : "error";
    console[level](JSON.stringify({
      code: summary.failed === 0
        ? "QUIZ_FINALIZATION_SCHEDULE_COMPLETE"
        : "QUIZ_FINALIZATION_SCHEDULE_PARTIAL",
      level,
      ...summary,
      cleanup: cleanup.outcome,
    }));
    if (summary.failed > 0) throw new Error("QUIZ_FINALIZATION_SCHEDULE_PARTIAL");
    return { outcome: "completed" as const, summary, cleanup: cleanup.outcome };
  } catch {
    console.error(JSON.stringify({
      code: "QUIZ_FINALIZATION_SCHEDULE_FAILED",
      level: "error",
    }));
    throw new Error("QUIZ_FINALIZATION_SCHEDULE_FAILED");
  }
}

export default {
  fetch: fetchWithAdminCompute,
  scheduled(controller, bindings, context) {
    context.waitUntil(runScheduledFinalization(controller, bindings));
  },
} satisfies ExportedHandler<AdminComputeBindings>;

// A binding is configured only in the opt-in local generation profile.
export { ContentWorkflow } from "../content/index";
