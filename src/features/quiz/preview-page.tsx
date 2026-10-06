import { QuizArtwork } from "./QuizArtwork";
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
      <section className="sermon-header" aria-labelledby="sermon-heading">
        <div className="sermon-visual"><QuizArtwork difficulty={difficulty} /><div className="sermon-title">
          <p className="eyebrow">함께 읽고, 천천히 새기는 시간</p>
          <h2 id="sermon-heading">마음에 새기는 말씀 <small>(예시)</small></h2>
          <p>한 칸씩 채우며 말씀을 돌아보세요.</p>
        <dl className="sermon-meta">
          <div><dt>설교일 예시</dt><dd>2026년 8월 31일</dd></div>
          <div><dt>성경 장절 예시</dt><dd>마태복음 5:1-12 <span>개역개정</span></dd></div>
          <div><dt>성경 읽기</dt><dd><a href="https://www.bskorea.or.kr/bible/korbibReadpage.php?version=GAE&book=mat&chap=5&sec=1" target="_blank" rel="noreferrer">대한성서공회에서 읽기 <span className="sr-only">(새 창)</span></a></dd></div>
        </dl>
        <a className="primary-button hero-action" href="#quiz-panel">퀴즈 풀기 <span aria-hidden="true">↓</span></a>
        </div></div>
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
