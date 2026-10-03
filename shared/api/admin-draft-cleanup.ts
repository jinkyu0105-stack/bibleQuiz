import { z } from "zod";
export const draftCleanupListSchema = z.strictObject({
  items: z.array(z.strictObject({
    sermonId: z.string(), title: z.string(), dueAt: z.iso.datetime().nullable(),
    state: z.enum(["scheduled", "due", "blocked", "purged"]),
    reason: z.enum(["active_call", "publication_missing", "activity_unknown", "unreadable", "expired"]).nullable(),
  })),
});
export type DraftCleanupList = z.infer<typeof draftCleanupListSchema>;
