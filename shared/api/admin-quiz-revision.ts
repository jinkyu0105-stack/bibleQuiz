import { z } from "zod";
import { displayMetadataSchema } from "./admin-display-text";
import { quizSetIdSchema } from "./admin-finalization";
import { difficultySchema, publicPuzzleGridSchema, quizSlugSchema } from "./public-quiz";
import { revealedSolutionSchema } from "./solution";

const text = z.string().trim().min(1);
export const revisionEntrySchema = z.strictObject({ id: quizSetIdSchema, answer: z.string().max(100), clue: z.string().max(2000),
  // The old evidence is retained by the server. A human explanation supplements it.
  evidence: z.string().max(4000) });
export const revisionContentSchema = z.strictObject({ metadata: displayMetadataSchema, churchName: text.max(100),
  bibleReferenceLabel: text.max(300), summary: z.string().max(20000),
  child: z.array(revisionEntrySchema).min(2).max(100), adult: z.array(revisionEntrySchema).min(2).max(100),
});
export const revisionLayoutSchema = z.strictObject({ grid: publicPuzzleGridSchema, solution: revealedSolutionSchema });
export const revisionBodySchema = z.strictObject({ content: revisionContentSchema,
  layouts: z.strictObject({ child: revisionLayoutSchema.nullable(), adult: revisionLayoutSchema.nullable() }),
  reviewed: z.strictObject({ summary: z.boolean(), child: z.boolean(), adult: z.boolean() }),
});
const basis = { sessionId: z.uuid(), expectedRevision: z.int().positive() };
const mutation = { ...basis, requestKey: z.uuid() };
export const revisionCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("start"), requestKey: z.uuid(), expectedCycle: z.int().nonnegative() }),
  z.strictObject({ action: z.literal("save"), ...mutation, content: revisionContentSchema }),
  z.strictObject({ action: z.literal("trial"), ...basis, difficulty: difficultySchema, gridSize: z.int().min(5).max(10), seed: text.max(128) }),
  z.strictObject({ action: z.literal("layout"), ...mutation, difficulty: difficultySchema, gridSize: z.int().min(5).max(10), seed: text.max(128) }),
  z.strictObject({ action: z.literal("review"), ...mutation, area: z.enum(["summary", "child", "adult"]), confirmed: z.literal(true) }),
  z.strictObject({ action: z.literal("publish"), ...mutation, confirmation: z.literal("publish") }),
]);
export const revisionViewSchema = z.strictObject({ quizSetId: quizSetIdSchema, sessionId: z.uuid().nullable(), cycle: z.int().nonnegative(),
  revision: z.int().nonnegative(), state: z.enum(["not_started", "editing", "expired", "published"]),
  body: revisionBodySchema.nullable(), sourceEvidence: z.record(z.string(), z.json()),
  slug: quizSlugSchema, disclosure: z.string(), translation: z.string(), bibleReadingUrl: z.url(),
  issues: z.array(z.string()), canPublish: z.boolean(), savedAt: z.iso.datetime().nullable(),
  publication: z.strictObject({ publishedAt: z.iso.datetime(), closesAt: z.iso.datetime() }).nullable(),
});
export const revisionTrialSchema = z.strictObject({ difficulty: difficultySchema, gridSize: z.int(), seed: z.string(),
  layout: revisionLayoutSchema.nullable(), issues: z.array(z.string()) });
export type RevisionBody = z.infer<typeof revisionBodySchema>;
export type RevisionContent = z.infer<typeof revisionContentSchema>;
export type RevisionView = z.infer<typeof revisionViewSchema>;
export type RevisionLayout = z.infer<typeof revisionLayoutSchema>;
