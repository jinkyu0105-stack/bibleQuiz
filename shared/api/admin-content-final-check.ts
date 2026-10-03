import { z } from "zod";

export const adminFinalCheckRequestSchema = z.strictObject({ requestKey: z.uuid().optional() });
export const adminFinalCheckStatusSchema = z.strictObject({
  requestKey: z.uuid(),
  outcome: z.enum(["queued", "running", "review_ready", "needs_revision", "failed"]),
});

