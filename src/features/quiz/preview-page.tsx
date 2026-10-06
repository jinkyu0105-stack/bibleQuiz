import { SermonHero } from "./SermonHero";
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { QuizWorkspace } from "./QuizWorkspace";
import { previewQuiz, type Difficulty } from "./preview-data";
import { DifficultyTabs } from "./DifficultyTabs";

export function Component() {
  const [params, setParams] = useSearchParams();
  const difficulty: Difficulty = params.get("level") === "adult" ? "adult" : "child";
  const sizeQuery = Number(params.get("size"));
  const size = [5, 8, 10].includes(sizeQuery) ? sizeQuery : undefined;
  const quiz = useMemo(() => previewQuiz(difficulty, size), [difficulty, size]);
  function changeLevel(level: Difficulty) {
    const next = new URLSearchParams(params);
    next.set("level", level);
    setParams(next, { preventScrollReset: true });
  }
  return (
    <article className="quiz-page" data-difficulty={difficulty}>
      <aside className="preview-notice" aria-label="개발용 시험 안내">
        <strong>입력 시험 화면</strong>
        <span>발행된 설교 퀴즈가 아닙니다. 입력은 이 브라우저에만 저장되며 서버로 제출되지 않습니다.</span>
      </aside>
      <SermonHero difficulty={difficulty} title="마음에 새기는 말씀 (예시)" date="2026-08-31"
        reference="마태복음 5:1-12" translation="개역개정"
        readingUrl="https://www.bskorea.or.kr/bible/korbibReadpage.php?version=GAE&book=mat&chap=5&sec=1" />
      <section className="sermon-details" id="sermon-details" aria-label="설교 내용과 발행 정보">
        <details className="sermon-summary">
          <summary>AI가 요약한 설교 핵심 내용</summary>
          <p>이 시험 화면에는 실제 설교 요약이 없습니다. 발행 화면에서는 관리자가 검토한 AI 요약과 고지 문구를 제공합니다.</p>
        </details>
      </section>
      <DifficultyTabs difficulty={difficulty} onChange={changeLevel} />
      <div role="tabpanel" id="quiz-panel" aria-labelledby={`tab-${difficulty}`}>
        <QuizWorkspace key={`${quiz.quizId}:${quiz.variantRevision}`} quiz={quiz} deadline="시험 화면에는 실제 마감이 없습니다." />
      </div>
    </article>
  );
}
