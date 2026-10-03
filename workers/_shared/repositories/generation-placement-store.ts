import { z } from "zod";
import { createHumanContentRuntimeStore } from "./human-content-runtime-store";

const rowSchema = z.object({ id: z.uuid(), job_id: z.string(), revision: z.int().min(2), ticket_id: z.string(), actor_digest: z.string(), created_at: z.string() });
export async function readPlacementSelection(db: D1Database, jobId: string) {
  const raw = await db.prepare("SELECT * FROM generation_placement_selections WHERE job_id=? ORDER BY revision DESC LIMIT 1").bind(jobId).first();
  if (!raw) return null;
  const row = rowSchema.parse(raw);
  const ticket = await createHumanContentRuntimeStore(db).readFinalTicket(row.ticket_id);
  if (!ticket) throw new Error("PLACEMENT_SELECTION_UNAVAILABLE");
  return { row, ticket, selection: { state: "present" as const, settingsRevision: row.revision, selectionRevision: row.revision,
    value: { child: { options: ticket.payload.placements.child.ticket.options, index: ticket.payload.placements.child.index },
      adult: { options: ticket.payload.placements.adult.ticket.options, index: ticket.payload.placements.adult.index } } } };
}
