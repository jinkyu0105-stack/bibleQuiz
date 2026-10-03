import { publicQuizResponseSchema, type Difficulty, type PublicQuizData } from "../../shared/api/public-quiz";
import { previewQuiz } from "../../src/features/quiz/preview-data";

// Test runner only. Never imported by a browser production entrypoint.
export function publicResponse(difficulty: Difficulty = "child", revision = 1): { data: PublicQuizData } {
  return publicQuizResponseSchema.parse({ data: { quiz: {
    quizSetId: "public-test-set", slug: "2026-08-31-test01",
    sermon: { title: "함께 돌아보는 한 주 (테스트)", date: "2026-08-31", churchName: "다사랑교회",
      bibleReferenceLabel: "마태복음 5:1-12", translation: "개역개정",
      bibleReadingUrl: "https://www.bskorea.or.kr/bible/korbibReadpage.php?version=GAE",
      summary: { text: "관리자가 검토한 요약을 표시하는 테스트 데이터입니다.", disclosure: "아래 내용은 설교 영상의 공개 자막을 바탕으로 AI가 요약한 것으로, 설교자의 원문이 아닙니다." } },
    status: "published", submissionState: "open", pauseReason: null,
    publishedAt: "2026-08-31T00:00:00.000Z", opensAt: "2026-08-31T00:00:00.000Z", closesAt: "2099-09-07T00:00:00.000Z", closesAtLabel: "2099년 9월 7일 오전 9:00 (한국 시간)",
    mode: "participation", acceptingSubmissions: true, availability: "open", availableDifficulties: ["child", "adult"],
    variant: { id: `public-test-${difficulty}`, difficulty, revision, grid: previewQuiz(difficulty).grid,
      desktopBackgroundPath: null, mobileBackgroundPath: null },
    submissionCount: 0, solutionAccess: "after_submission",
  }, otherOpenQuizzes: [] } });
}
