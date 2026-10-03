import { z } from "zod";

export const adminSubmissionIdSchema = z.string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/u);

export const adminModerationReasonSchema = z.string()
  .trim()
  .min(2)
  .max(500)
  .refine((value) => [...value].every((character) => {
    const codePoint = character.codePointAt(0)!;
    return codePoint > 31 && codePoint !== 127;
  }));

export const moderateSubmissionRequestSchema = z.object({
  action: z.enum(["hide", "unhide"]),
  reason: adminModerationReasonSchema,
}).strict();

export const deleteSubmissionAsAdminRequestSchema = z.object({
  confirmation: z.literal("delete"),
  reason: adminModerationReasonSchema,
}).strict();

const moderationOutcomeSchema = z.enum(["changed", "replayed"]);

export const moderatedSubmissionDataSchema = z.object({
  outcome: moderationOutcomeSchema,
  status: z.enum(["hidden", "visible"]),
  submissionId: adminSubmissionIdSchema,
}).strict();

export const deletedSubmissionAsAdminDataSchema = z.object({
  deletedAt: z.iso.datetime(),
  outcome: moderationOutcomeSchema,
  status: z.literal("deleted"),
  submissionId: adminSubmissionIdSchema,
}).strict();

export type ModerateSubmissionRequest = z.infer<typeof moderateSubmissionRequestSchema>;
export type ModeratedSubmissionData = z.infer<typeof moderatedSubmissionDataSchema>;
export type DeletedSubmissionAsAdminData = z.infer<typeof deletedSubmissionAsAdminDataSchema>;
