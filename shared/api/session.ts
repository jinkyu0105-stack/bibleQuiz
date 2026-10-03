import { z } from "zod";

export const sessionRequestSchema = z.strictObject({});

export const sessionDataSchema = z.strictObject({
  expiresAt: z.iso.datetime(),
});

export type SessionData = z.infer<typeof sessionDataSchema>;

