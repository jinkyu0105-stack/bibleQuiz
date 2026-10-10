import { Link, useLoaderData, useLocation, useSearchParams } from "react-router-dom";
import { GlassPanel } from "../../components/glass/GlassPanel";
import { GlassArrow } from "../../components/glass/GlassArrow";
import { GlassLink } from "../../components/glass/GlassLink";
import { useGlass } from "../../components/glass/useGlass";
import { RecentArchive } from "../archive/RecentArchive";
import { Component as PublicQuiz, PublicQuizContent } from "./public-page";
import type { QuizLoadResult } from "./public-loader";

export function Component() {
  const [params] = useSearchParams();
  // Existing shared /?level= links still open the same quiz and saved draft.
  return params.has("level") ? <PublicQuiz /> : <HomeContent />;
}

function HomeContent() {
  const result = useLoaderData<QuizLoadResult>();
  const cta = useGlass<HTMLAnchorElement>();
  const location = useLocation();
  const weeklyTarget = { search: location.search, hash: "#weekly" };
  const quiz = result.state === "ready" ? result.data.quiz : null;
  return <div id="home-view">
    <section className="sky-home-hero" aria-labelledby="home-title">
      <div className="hero-content"><p className="hero-kicker">한 주의 말씀을, 함께.</p><h1 id="home-title">말씀을 가까이.<br />일상에 깊이.</h1><p className="hero-description">듣고, 기억하고, 함께 나누는 시간.<br />이번 주 말씀을 성경퀴즈로 만나세요.</p><Link ref={cta} className="button hero-cta glass glass-clear" data-glass-lens="" data-glint="" to={weeklyTarget}>이번 주 퀴즈 <span aria-hidden="true">↗</span></Link></div>
      <Link className="descent-cue" to={weeklyTarget}><span>조금 더 아래로</span><span aria-hidden="true">↓</span></Link>
      <p className="hero-side-note">어린이부터 장년까지<br />같은 말씀, 함께하는 기쁨</p>
    </section>
    <section id="weekly" className="weekly-section" aria-labelledby="weekly-title">
      <div className="section-heading"><p className="eyebrow">이번 주 성경퀴즈</p><h2 id="weekly-title">기억에 남는 말씀,<br />함께 풀어 보세요.</h2><p>나에게 맞는 퀴즈를 고르고<br />한 칸씩, 천천히 채워 가세요.</p></div>
      {quiz ? <GlassPanel as="div" className="weekly-sheet">
        <div className="sheet-meta"><span className="status-mark">{quiz.acceptingSubmissions ? "함께 풀어요" : quiz.mode === "practice" ? "다시 풀어 보세요" : "이번 주 말씀"}</span><time dateTime={quiz.sermon.date}>{quiz.sermon.date}</time></div>
        <h3>{quiz.sermon.title}</h3><p className="weekly-reference">{quiz.sermon.bibleReferenceLabel} · {quiz.sermon.translation}</p>
        {quiz.sermon.summary && <p className="weekly-summary">{quiz.sermon.summary.text.length > 150 ? `${quiz.sermon.summary.text.slice(0, 150)}…` : quiz.sermon.summary.text}</p>}
        <div className="difficulty-links">{(["child", "adult"] as const).filter(level => quiz.availableDifficulties.includes(level)).map((level, index) => <Link key={level} to={`/quiz/${quiz.slug}?level=${level}`}><span className="difficulty-number">0{index + 1}</span><span><strong>{level === "child" ? "어린이 퀴즈" : "장년 퀴즈"}</strong><small>{level === "child" ? "쉽고 친근한 단서로 시작해요" : "말씀을 한 번 더 깊이 생각해요"}</small></span><GlassArrow /></Link>)}</div>
        {quiz.sermon.summary && <p className="summary-disclosure">{quiz.sermon.summary.disclosure}</p>}
      </GlassPanel> : <GlassPanel as="div" className="weekly-sheet"><PublicQuizContent /></GlassPanel>}
    </section>
    {result.state === "ready" && result.data.otherOpenQuizzes.length > 0 && <GlassPanel className="home-other-quizzes"><h2>아직 참여할 수 있는 퀴즈</h2>{result.data.otherOpenQuizzes.map(other => <div key={other.slug}><h3>{other.title}</h3><p>{other.sermonDate} · {other.bibleReferenceLabel}</p>{other.availableDifficulties.map(level => <GlassLink key={level} to={`/quiz/${other.slug}?level=${level}`}>{level === "child" ? "어린이용" : "장년용"} 풀기</GlassLink>)}</div>)}</GlassPanel>}
    <RecentArchive landing />
  </div>;
}
