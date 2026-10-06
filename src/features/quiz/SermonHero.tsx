import { Link } from "react-router-dom";
import type { Difficulty } from "../../../shared/api/public-quiz";
import { QuizArtwork } from "./QuizArtwork";

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

function HeroRail({ side }: { side: "adult" | "child" }) {
  return <nav className={`hero-rail ${side}-rail`} aria-label="화면 바로가기">
    <a className="garden-mark" href="#sermon-heading" aria-label="설교 제목으로"><span aria-hidden="true" /></a>
    <div className="hero-rail-links">
      <a href="#quiz-panel"><span aria-hidden="true">01</span>퀴즈</a>
      <a href="#sermon-details"><span aria-hidden="true">02</span>말씀</a>
      <Link to="/archive"><span aria-hidden="true">03</span>기록</Link>
    </div>
    <span className="rail-caption" aria-hidden="true">한 칸씩, 마음에 새기다</span>
  </nav>;
}

function HeroMeta({ date, reference, translation, readingUrl }: SermonHeroProps) {
  return <dl className="sermon-meta">
    <div><dt>설교일</dt><dd><time dateTime={date}>{date.replaceAll("-", ". ")}</time></dd></div>
    <div><dt>성경 장절</dt><dd>{reference}<small>{translation}</small></dd></div>
    <div><dt>성경 읽기</dt><dd><a href={readingUrl} target="_blank" rel="noreferrer">대한성서공회 <span aria-hidden="true">↗</span><span className="sr-only">에서 읽기 (새 창, 장절을 선택해 주세요)</span></a></dd></div>
  </dl>;
}

function HeroExcerpt({ excerpt }: { excerpt?: string | undefined }) {
  // The complete reviewed summary remains available immediately below the hero.
  const text = excerpt?.trim();
  return <p className="hero-excerpt">{text ? text.length > 120 ? `${text.slice(0, 120)}…` : text : "말씀을 읽고, 한 칸씩 채우며 오늘의 마음에 새겨 보세요."}</p>;
}

function AdultSermonHero(props: SermonHeroProps) {
  return <section className="sermon-header adult-hero" aria-labelledby="sermon-heading">
    <QuizArtwork difficulty="adult" desktopPath={props.desktopPath ?? null} mobilePath={props.mobilePath ?? null} />
    <div className="forest-trellis" aria-hidden="true" />
    <HeroRail side="adult" />
    <div className="adult-hero-content sermon-title">
      <p className="hero-kicker">이번 주의 말씀 <span>장년 낱말 퀴즈</span></p>
      <h2 id="sermon-heading">{props.title}</h2>
      <HeroExcerpt excerpt={props.excerpt} />
      <div className="hero-actions"><a className="hero-action" href="#quiz-panel">퀴즈 풀기 <span aria-hidden="true">↗</span></a><a className="hero-summary-link" href="#sermon-details">설교 핵심 내용 <span aria-hidden="true">↓</span></a></div>
      <HeroMeta {...props} />
    </div>
  </section>;
}

function ChildSermonHero(props: SermonHeroProps) {
  return <section className="sermon-header child-hero" aria-labelledby="sermon-heading">
    <div className="child-garden"><QuizArtwork difficulty="child" desktopPath={props.desktopPath ?? null} mobilePath={props.mobilePath ?? null} /></div>
    <HeroRail side="child" />
    <div className="child-hero-content sermon-title">
      <p className="hero-kicker">작은 마음에 자라는 말씀 <span>어린이 낱말 퀴즈</span></p>
      <h2 id="sermon-heading">{props.title}</h2>
      <HeroExcerpt excerpt={props.excerpt} />
      <div className="hero-actions"><a className="hero-action" href="#quiz-panel">함께 퀴즈 풀기 <span aria-hidden="true">↗</span></a><a className="hero-summary-link" href="#sermon-details">말씀 먼저 읽기 <span aria-hidden="true">↓</span></a></div>
    </div>
    <div className="child-hero-ribbon"><p><strong>한 칸, 한 칸</strong><span>말씀과 가까워지는 시간</span></p><HeroMeta {...props} /></div>
  </section>;
}

export function SermonHero(props: SermonHeroProps) {
  return props.difficulty === "adult" ? <AdultSermonHero {...props} /> : <ChildSermonHero {...props} />;
}
