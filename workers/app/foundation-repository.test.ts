import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { createDatabase } from "../_shared/db/client";
import { createFoundationRepository } from "../_shared/repositories/foundation-repository";

interface TestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

const testEnv = env as TestEnv;

beforeAll(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

describe("foundation D1 repository", () => {
  it("writes and reads a validated sermon through Drizzle", async () => {
    const repository = createFoundationRepository(createDatabase(testEnv.DB));
    const now = "2026-08-26T00:00:00.000Z";

    await repository.createBibleTranslation({
      createdAt: now,
      displayName: "개역개정",
      edition: "reference-only",
      id: "0198-foundation-translation",
      mode: "reference_only",
      publisherOrRightsholder: "대한성서공회",
      status: "pending",
      updatedAt: now,
    });
    await repository.createSermon({
      bibleReferenceJson: [
        { book: "요한복음", chapter: 3, verseEnd: 3, verseStart: 1 },
      ],
      bibleReferenceLabel: "요한복음 3:1-3",
      bibleTranslationId: "0198-foundation-translation",
      churchName: "다사랑교회",
      createdAt: now,
      id: "0198-foundation-sermon",
      sermonDate: "2026-08-23",
      sermonTitle: "테스트 설교",
      slugSuffix: "test01",
      updatedAt: now,
      youtubeUrl: "https://www.youtube.com/watch?v=94eQ16j7rKI",
      youtubeVideoId: "94eQ16j7rKI",
    });

    const sermon = await repository.findSermonByVideoId("94eQ16j7rKI");

    expect(sermon).toMatchObject({
      bibleReferenceJson: [
        { book: "요한복음", chapter: 3, verseEnd: 3, verseStart: 1 },
      ],
      churchName: "다사랑교회",
      sermonDate: "2026-08-23",
    });
  });

  it("upserts site state without exposing a database route", async () => {
    const repository = createFoundationRepository(createDatabase(testEnv.DB));

    await repository.setSiteState(
      "featured_quiz_set_id",
      "quiz-set-1",
      "2026-08-26T00:00:00.000Z",
    );
    await repository.setSiteState(
      "featured_quiz_set_id",
      "quiz-set-2",
      "2026-08-26T00:01:00.000Z",
    );

    await expect(
      repository.getSiteState("featured_quiz_set_id"),
    ).resolves.toBe("quiz-set-2");
  });

  it("enforces D1 foreign keys and enum checks", async () => {
    const foreignKeys = await testEnv.DB.prepare("PRAGMA foreign_keys").first<{
      foreign_keys: number;
    }>();
    expect(foreignKeys?.foreign_keys).toBe(1);

    await expect(
      testEnv.DB.prepare(
        `INSERT INTO bible_translations (
          id, display_name, edition, publisher_or_rightsholder,
          mode, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          "invalid-translation",
          "잘못된 번역본",
          "test",
          "test",
          "unsupported_mode",
          "pending",
          "2026-08-26T00:00:00.000Z",
          "2026-08-26T00:00:00.000Z",
        )
        .run(),
    ).rejects.toThrow(/CHECK constraint failed/);

    await expect(
      testEnv.DB.prepare(
        `INSERT INTO sermons (
          id, slug_suffix, church_name, youtube_url, youtube_video_id,
          sermon_title, sermon_date, bible_translation_id,
          bible_reference_json, bible_reference_label, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          "foreign-key-sermon",
          "fk-test",
          "다사랑교회",
          "https://www.youtube.com/watch?v=fk-test",
          "fk-test",
          "외래키 테스트",
          "2026-08-23",
          "missing-translation",
          "[]",
          "테스트 1:1",
          "2026-08-26T00:00:00.000Z",
          "2026-08-26T00:00:00.000Z",
        )
        .run(),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);
  });
});
