import { expect, it } from "vitest";
import { extractSermonTitleMetadata, parseYouTubeVideoId, suggestSermonDate } from "./sermon-registration";
it("suggests valid title dates, KST Sundays and upload mismatch without AI", () => {
  const now = new Date("2026-09-19T15:00:00Z");
  expect(suggestSermonDate("260913 설교", now).date).toBe("2026-09-13");
  expect(suggestSermonDate("20260906 설교", now).date).toBe("2026-09-06");
  expect(suggestSermonDate("20260230 잘못된 날짜", now).date).toBe("2026-09-20");
  expect(suggestSermonDate("제목", now, "2026-09-18T00:00:00Z").date).toBe("2026-09-13");
  expect(suggestSermonDate("260101 설교", now, "2026-09-18T00:00:00Z").distant).toBe(true);
  expect(suggestSermonDate("202609201 앞자리", now).reason).toBe("작업 생성일 기준 최근 일요일");
});
it("uses exact YouTube hosts and one video id", () => {
  for (const value of ["abcdefghijk", "https://youtu.be/abcdefghijk?t=2", "https://www.youtube.com/watch?v=abcdefghijk", "https://youtube.com/live/abcdefghijk"])
    expect(parseYouTubeVideoId(value)).toBe("abcdefghijk");
  for (const value of ["https://youtube.com.evil.invalid/watch?v=abcdefghijk", "https://u:p@youtube.com/watch?v=abcdefghijk", "https://youtube.com/watch?v=abcdefghijk&v=abcdefghijk"])
    expect(parseYouTubeVideoId(value)).toBeNull();
});

it.each([
  ["260927 주일예배 - 합성 설교 제목(시편 147:1~20)", "합성 설교 제목", "시편 147:1–20"],
  ["20260927 주일 예배 | 합성 제목 [요 3:16]", "합성 제목", "요한복음 3:16"],
  ["260927 합성 제목 - 시 147:1-20", "합성 제목", "시편 147:1–20"],
  ["합성 제목 (요한복음 3장 16절-18절)", "합성 제목", "요한복음 3:16–18"],
  ["합성 제목 (요 3:99)", "합성 제목 (요 3:99)", null],
  ["합성 제목 (요 3:16-4:2)", "합성 제목 (요 3:16-4:2)", null],
  ["합성 제목 (요 3:16) (시 147:1)", "합성 제목 (요 3:16) (시 147:1)", null],
  ["20260230 합성 제목", "20260230 합성 제목", null],
  ["합성 제목 (부제)", "합성 제목 (부제)", null],
  ["260927 주일예배 - 합성 제목", "합성 제목", null],
])("extracts explicit video title fields without inventing metadata: %s", (input, title, referenceInput) => {
  expect(extractSermonTitleMetadata(input)).toEqual({ title, referenceInput });
});
