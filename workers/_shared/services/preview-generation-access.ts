import { z } from "zod";

const syntheticIds = z.array(z.uuid()).max(3);
/** The measurement override grants only full generation for explicitly registered
 * synthetic fixtures at the existing Access-protected Preview origin. The private
 * Workflow independently rejects any title/input other than the exact fixture. */
export function fullGenerationEnabled(bindings: {
  CONTENT_WORKFLOW?: unknown; AI_GENERATION_ENABLED?: string; P571_SYNTHETIC_SERMON_IDS?: string;
}, sermonId: string, requestUrl: string) {
  if (!bindings.CONTENT_WORKFLOW) return false;
  if (bindings.AI_GENERATION_ENABLED === "true") return true;
  if (new URL(requestUrl).origin !== "https://biblequiz-app-preview.jinkyu0105.workers.dev") return false;
  try {
    const parsed = syntheticIds.safeParse(JSON.parse(bindings.P571_SYNTHETIC_SERMON_IDS ?? "[]"));
    return parsed.success && parsed.data.includes(sermonId);
  } catch { return false; }
}
