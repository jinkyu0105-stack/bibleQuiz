import { finalCheckSelectionSchema } from "../../../shared/api/placement-options";
export { finalCheckSelectionSchema } from "../../../shared/api/placement-options";
import { z } from "zod";

import { publicPuzzleGridSchema, publicSermonSchema } from "../../../shared/api/public-quiz";
import { placementTicketSchema } from "./candidate-placement";
import {
  finalCheckMetadataSnapshotSchema,
  finalCheckPublicMetadataSchema,
} from "./final-check-metadata-contract";
import { summaryBindingSchema } from "./sermon-summary-contract";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const placement = z.strictObject({ ticket: placementTicketSchema, index: z.int().min(0).max(2) });

/** Server-captured references plus validated sermon metadata; no transcript, AI result or supplied grid. */
export const finalCheckTicketSchema = z.strictObject({
  sermonId: id,
  expectedVersion: z.int().positive(),
  metadata: finalCheckMetadataSnapshotSchema,
  binding: summaryBindingSchema,
  summary: z.strictObject({ summaryId: id, reviewId: id, binding: summaryBindingSchema }),
  placements: z.strictObject({ child: placement, adult: placement }),
}).superRefine((ticket, context) => {
  if (ticket.metadata.sermonId !== ticket.sermonId ||
    ticket.binding.transcript.version !== ticket.expectedVersion ||
    (["child", "adult"] as const).some((difficulty) => {
      const ref = ticket.placements[difficulty].ticket;
      return ref.sermonId !== ticket.sermonId || ref.difficulty !== difficulty || ref.expectedVersion !== ticket.expectedVersion;
    })) context.addIssue({ code: "custom", message: "Invalid final input references" });
});
export type FinalCheckTicket = z.infer<typeof finalCheckTicketSchema>;
export type FinalCheckSelection = z.infer<typeof finalCheckSelectionSchema>;

// Only explicit public content. A successful input check is not a published quiz DTO.
export const finalCheckPreviewSchema = z.strictObject({
  metadata: finalCheckPublicMetadataSchema,
  summary: publicSermonSchema.shape.summary.unwrap(),
  variants: z.strictObject({ child: publicPuzzleGridSchema, adult: publicPuzzleGridSchema }),
});
