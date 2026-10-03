import { z } from "zod";
import { ownSubmissionSchema } from "./submission";
import { publicPuzzleGridSchema } from "./public-quiz";
export const problemHistorySchema=z.strictObject({items:z.array(z.strictObject({notice:z.string(),grid:publicPuzzleGridSchema.nullable(),submission:ownSubmissionSchema}))});
