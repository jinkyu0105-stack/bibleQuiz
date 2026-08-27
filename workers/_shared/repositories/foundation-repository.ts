import { count, eq } from "drizzle-orm";

import type { Database } from "../db/client";
import {
  bibleTranslations,
  sermons,
  siteState,
  type NewBibleTranslationRow,
  type NewSermonRow,
  type SermonRow,
} from "../db/schema";
import { bibleReferencesSchema } from "../db/validation";

export interface FoundationRepository {
  createBibleTranslation(
    translation: NewBibleTranslationRow,
  ): Promise<void>;
  createSermon(sermon: NewSermonRow): Promise<void>;
  findSermonByVideoId(videoId: string): Promise<SermonRow | undefined>;
  getSiteState(key: string): Promise<string | undefined>;
  isDatabaseReady(): Promise<boolean>;
  setSiteState(key: string, value: string, updatedAt: string): Promise<void>;
}

export function createFoundationRepository(
  database: Database,
): FoundationRepository {
  return {
    async createBibleTranslation(translation) {
      await database.insert(bibleTranslations).values(translation);
    },

    async createSermon(sermon) {
      bibleReferencesSchema.parse(sermon.bibleReferenceJson);
      await database.insert(sermons).values(sermon);
    },

    async findSermonByVideoId(videoId) {
      return database.query.sermons.findFirst({
        where: eq(sermons.youtubeVideoId, videoId),
      });
    },

    async getSiteState(key) {
      const row = await database.query.siteState.findFirst({
        columns: { value: true },
        where: eq(siteState.key, key),
      });
      return row?.value;
    },

    async isDatabaseReady() {
      const [result] = await database
        .select({ rowCount: count() })
        .from(siteState);
      return result !== undefined && result.rowCount >= 0;
    },

    async setSiteState(key, value, updatedAt) {
      await database
        .insert(siteState)
        .values({ key, updatedAt, value })
        .onConflictDoUpdate({
          set: { updatedAt, value },
          target: siteState.key,
        });
    },
  };
}
