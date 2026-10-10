import { Link } from "react-router-dom";
import type { Difficulty } from "../../../shared/api/public-quiz";

export type SermonHeroProps = {
  difficulty: Difficulty;
  title: string;
  date: string;
  reference: string;
  translation: string;
  readingUrl: string;
  excerpt?: string | undefined;
  desktopPath?: string | null | undefined;
  mobilePath?: string | null | undefined;
};

function HeroMeta({ date, reference, translation, readingUrl }: SermonHeroProps) {
  return <dl className="sermon-meta">
    <div><dt>설교일</dt><dd><time dateTime={date}>{date.replaceAll("-", ". ")}</time></dd></div>
    <div><dt>성경 장절</dt><dd>{reference}<small>{translation}</small></dd></div>
    <div><dt>성경 읽기</dt><dd><a href={readingUrl} target="_blank" rel="noreferrer">대한성서공회 <span aria-hidden="true">↗</span><span className="sr-only">에서 읽기 (새 창, 장절을 선택해 주세요)</span></a></dd></div>
  </dl>;
}

export function SermonHero(props: SermonHeroProps) {
  return <section className="sermon-header sky-quiz-heading" aria-labelledby="sermon-heading">
    <Link className="back-link" to="/#weekly">← 이번 주 말씀</Link>
    <p className="eyebrow">{props.difficulty === "child" ? "어린이" : "장년"} 성경퀴즈</p>
    <h2 id="sermon-heading">{props.title}</h2>
    <HeroMeta {...props} />
    <div className="hero-actions"><a className="hero-action" href="#quiz-panel">{props.difficulty === "child" ? "함께 퀴즈 풀기" : "퀴즈 풀기"} <span aria-hidden="true">↗</span></a><a className="hero-summary-link" href="#sermon-details">설교 핵심 내용 <span aria-hidden="true">↓</span></a></div>
  </section>;
}
