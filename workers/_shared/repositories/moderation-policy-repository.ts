import { asc, eq } from "drizzle-orm";

import type { Database } from "../db/client";
import {
  moderationExceptions,
  moderationTerms,
  reservedNames,
} from "../db/schema";
import {
  assertModerationPolicy,
  InvalidModerationPolicy,
  type ModerationPolicy,
} from "../services/content-moderation";

export class InvalidStoredModerationPolicy extends Error {
  constructor() {
    super("INVALID_STORED_MODERATION_POLICY");
  }
}

export function createModerationPolicyRepository(database: Database) {
  return {
    async loadActivePolicy(): Promise<ModerationPolicy> {
      const [reservedRows, termRows, exceptionRows] = await database.batch([
        database.select({
          id: reservedNames.id,
          normalizedValue: reservedNames.normalizedValue,
        }).from(reservedNames).where(eq(reservedNames.enabled, true)).orderBy(asc(reservedNames.id)),
        database.select({
          id: moderationTerms.id,
          matchMode: moderationTerms.matchMode,
          normalizedPattern: moderationTerms.normalizedPattern,
          scope: moderationTerms.scope,
        }).from(moderationTerms).where(eq(moderationTerms.enabled, true)).orderBy(asc(moderationTerms.id)),
        database.select({
          id: moderationExceptions.id,
          normalizedValue: moderationExceptions.normalizedValue,
          scope: moderationExceptions.scope,
        }).from(moderationExceptions).where(eq(moderationExceptions.enabled, true)).orderBy(asc(moderationExceptions.id)),
      ] as const);

      const policy: ModerationPolicy = {
        exceptions: exceptionRows.map((row) => ({
          enabled: true,
          id: row.id,
          normalizedValue: row.normalizedValue,
          scope: row.scope,
        })),
        reservedNames: reservedRows.map((row) => ({
          enabled: true,
          id: row.id,
          normalizedValue: row.normalizedValue,
        })),
        rules: termRows.map((row) => ({
          enabled: true,
          id: row.id,
          matchMode: row.matchMode,
          normalizedPattern: row.normalizedPattern,
          scope: row.scope,
        })),
      };

      try {
        assertModerationPolicy(policy);
        return policy;
      } catch (error) {
        if (error instanceof InvalidModerationPolicy) {
          throw new InvalidStoredModerationPolicy();
        }
        throw error;
      }
    },
  };
}
