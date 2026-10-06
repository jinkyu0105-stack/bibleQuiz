import { QuizArtwork } from "./QuizArtwork";
import { BlankExportPanel } from "../export/BlankExportPanel";
import { ProblemHistory } from "./ProblemHistory";
import { useMemo } from "react";
import { Link, useLoaderData, useLocation, useNavigation, useRevalidator, useSearchParams } from "react-router-dom";
import { RecentArchive } from "../archive/RecentArchive";
import type { PublicQuiz } from "../../../shared/api/public-quiz";
import { DifficultyTabs } from "./DifficultyTabs";
import { QuizLoading } from "./QuizLoading";
import { QuizDeadline } from "./QuizDeadline";
import { QuizWorkspace } from "./QuizWorkspace";
import type { OwnSubmissionLoadResult, QuizLoadResult } from "./public-loader";
import { quizInputView } from "./quiz-view";

function availabilityText(quiz: PublicQuiz) {
  switch (quiz.availability) {
    case "paused": return quiz.pauseReason ?? "문제를 확인하는 동안 제출이 잠시 중지되었습니다.";
    case "upcoming": return "아직 참여 시작 전입니다.";
    case "closed": return "참여 기간이 끝났습니다.";
    case "archived": return "마감된 퀴즈입니다. 기록을 남기지 않고 다시 풀어볼 수 있습니다.";
    case "open": return "참여 기간 중인 퀴즈입니다.";
  }
}

function submissionAccess(quiz: PublicQuiz, ownSubmission: OwnSubmissionLoadResult) {
  if (quiz.mode !== "participation") return undefined;
  if (ownSubmission.state === "error") {
    return { state: "disabled" as const, message: "기존 제출 여부를 확인한 뒤 제출할 수 있습니다." };
  }
  if (ownSubmission.data?.status === "deleted") {
    return { state: "disabled" as const, message: "이 브라우저에서 삭제한 제출은 다시 제출할 수 없습니다." };
  }
  if (quiz.availability === "paused") {
    return { state: "disabled" as const, message: quiz.pauseReason ?? "문제를 확인하는 동안 제출이 잠시 중지되었습니다." };
  }
  if (quiz.availability === "upcoming") {
    return { state: "disabled" as const, message: "참여 시작 시간이 되면 제출할 수 있습니다." };
  }
  if (quiz.availability !== "open" || !quiz.acceptingSubmissions) {
    return { state: "disabled" as const, message: "참여 기간이 끝나 지금은 제출할 수 없습니다." };
  }
  return {
    state: "enabled" as const,
    target: {
      difficulty: quiz.variant.difficulty,
      revision: quiz.variant.revision,
      slug: quiz.slug,
    },
  };
}

export function Component() {
  const location = useLocation();
  return <><PublicQuizContent />{location.pathname === "/" && <RecentArchive />}</>;
}

function PublicQuizContent() {
  const result = useLoaderData<QuizLoadResult>();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const [params, setParams] = useSearchParams();
  const quiz = result.state === "ready" ? result.data.quiz : null;
  const ownSubmission = result.state === "ready" ? result.ownSubmission : null;
  const inputView = useMemo(() => quiz ? quizInputView(quiz) : null, [quiz]);
  const loading = navigation.state === "loading" || revalidator.state === "loading";
  // Keep the tabs mounted during keyboard navigation; the old workspace is not interactive while fetching.
  if (!quiz || !inputView) {
    if (loading) return <QuizLoading />;
    return <section className="placeholder" aria-labelledby="quiz-state-heading">
      <h2 id="quiz-state-heading">{result.state === "error" ? "퀴즈를 불러오지 못했습니다." : result.state === "not-found" ? "퀴즈를 찾을 수 없습니다." : "말씀 퀴즈를 준비하고 있습니다."}</h2>
      <p>{result.state === "error" ? "연결 상태를 확인하고 다시 시도해 주세요. 저장한 입력은 지우지 않았습니다." : result.state === "not-found" ? "주소를 확인해 주세요. 아직 공개되지 않았거나 선택한 난이도의 퀴즈가 없을 수 있습니다." : "아직 공개된 퀴즈가 없습니다. 발행되면 이곳에서 풀 수 있습니다."}</p>
      {result.state === "error" ? <>
        <button className="primary-button" type="button" onClick={() => void revalidator.revalidate()}>다시 시도</button>
        {result.requestId && <p className="request-id">문의용 번호: {result.requestId}</p>}
      </> : result.state === "not-found" ? <Link className="text-link" to="/">이번 주 퀴즈로 이동</Link> : null}
      {import.meta.env.DEV && <p><Link className="text-link" to="/dev/quiz?level=child">입력 시험 화면 열기</Link></p>}
    </section>;
  }
  const difficulty = quiz.variant.difficulty;
  const restoredSubmission = ownSubmission?.state === "ready" ? ownSubmission.data ?? undefined : undefined;
  const currentSubmissionAccess = submissionAccess(quiz, ownSubmission!);
  return <article className="quiz-page" data-difficulty={difficulty}>
    <section className="sermon-header" aria-labelledby="sermon-heading">
      <div className="sermon-visual"><QuizArtwork difficulty={difficulty} desktopPath={quiz.variant.desktopBackgroundPath} mobilePath={quiz.variant.mobileBackgroundPath} /><div className="sermon-title"><h2 id="sermon-heading">{quiz.sermon.title}</h2>
      <dl className="sermon-meta">
        <div><dt>설교일</dt><dd><time dateTime={quiz.sermon.date}>{quiz.sermon.date}</time></dd></div>
        <div><dt>성경 장절</dt><dd>{quiz.sermon.bibleReferenceLabel} <span>{quiz.sermon.translation}</span></dd></div>
        <div><dt>성경 읽기</dt><dd><a href={quiz.sermon.bibleReadingUrl} target="_blank" rel="noreferrer">대한성서공회에서 읽기 <span className="sr-only">(새 창, 장절을 선택해 주세요)</span></a></dd></div>
      </dl>
      <a className="primary-button hero-action" href="#quiz-panel">퀴즈 풀기 <span aria-hidden="true">↓</span></a>
      </div></div>
      {quiz.sermon.summary && <section className="sermon-summary" aria-labelledby="summary-heading">
        <h3 id="summary-heading">AI가 요약한 설교 핵심 내용</h3>
        <p className="summary-copy">{quiz.sermon.summary.text}</p><p>{quiz.sermon.summary.disclosure}</p>
      </section>}
      <p className="published-date">발행일 <time dateTime={quiz.publishedAt}>{new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "long" }).format(new Date(quiz.publishedAt))}</time></p>
      <Link className="text-link" to={`/quiz/${quiz.slug}?level=${difficulty}`}>이 퀴즈의 고유 주소</Link>
    </section>
    <DifficultyTabs difficulty={difficulty} available={quiz.availableDifficulties} onChange={(level) => {
      if (level === difficulty) return;
      const next = new URLSearchParams(params); next.set("level", level);
      setParams(next, { preventScrollReset: true });
    }} />
    <div role="tabpanel" id="quiz-panel" aria-labelledby={`tab-${difficulty}`} aria-busy={loading}>
      {loading ? <QuizLoading /> : <>
        <aside className="quiz-availability"><p>{availabilityText(quiz)}</p><p>{quiz.acceptingSubmissions ? "한 글자 이상 작성한 부분 답안도 제출할 수 있습니다." : "입력한 내용은 현재 브라우저에 임시 저장됩니다."}</p><p>현재 {difficulty === "child" ? "어린이용" : "장년용"}에 {quiz.submissionCount}명이 참여했습니다.</p></aside>
        {ownSubmission?.state === "error" && <aside className="quiz-availability" role="alert">
          <p>기존 제출 결과를 확인하지 못했습니다. 중복 제출을 막기 위해 확인 전에는 새 제출을 받지 않습니다.</p>
          <button className="primary-button" type="button" onClick={() => void revalidator.revalidate()}>제출 결과 다시 확인</button>
          {ownSubmission.requestId && <p className="request-id">문의용 번호: {ownSubmission.requestId}</p>}
        </aside>}
        {quiz.correction && <aside className="quiz-availability"><p>{quiz.correction.nonRanked ? "정정된 지난 퀴즈": "문제 수정본"}</p><p>{quiz.correction.notice}</p><ProblemHistory key={`${quiz.slug}:${difficulty}`} slug={quiz.slug} difficulty={difficulty}/></aside>}
        <QuizWorkspace key={`${inputView.quizId}:${inputView.variantRevision}`} quiz={inputView} deadline={<QuizDeadline
          closesAt={quiz.closesAt}
          closesAtLabel={quiz.closesAtLabel}
          refreshOnExpiry={quiz.availability === "open" || quiz.availability === "paused" || quiz.availability === "upcoming"}
          onExpire={() => void revalidator.revalidate()}
        />} participationBoard={{
          target: { difficulty, slug: quiz.slug },
          visibility: quiz.status === "archived" ? "public" : "after-submission",
          printable: !quiz.correction?.nonRanked,
        }} submissionDeletion={{
          difficulty,
          quizRevision: quiz.variant.revision,
          quizVariantId: quiz.variant.id,
          slug: quiz.slug,
        }} solutionDisclosure={{
          policy: quiz.solutionAccess,
          target: {
            difficulty,
            grid: quiz.variant.grid,
            quizRevision: quiz.variant.revision,
            quizVariantId: quiz.variant.id,
            slug: quiz.slug,
          },
        }}
        {...(currentSubmissionAccess === undefined ? {} : { submission: currentSubmissionAccess })}
        {...(quiz.mode === "practice" ? { practiceCheck: {
          difficulty,
          grid: quiz.variant.grid,
          quizRevision: quiz.variant.revision,
          quizVariantId: quiz.variant.id,
          slug: quiz.slug,
        } } : {})}
        {...(restoredSubmission === undefined ? {} : { initialSubmission: restoredSubmission })} />
      </>}
    </div>
    <BlankExportPanel key={`${quiz.slug}:${difficulty}`} slug={quiz.slug} difficulty={difficulty} available={quiz.availableDifficulties} />
    {result.state === "ready" && result.data.otherOpenQuizzes.length > 0 && <section className="other-open-quizzes" aria-labelledby="other-open-heading">
      <h2 id="other-open-heading">아직 참여할 수 있는 퀴즈</h2>
      <ul>{result.data.otherOpenQuizzes.map((other) => <li key={other.slug}>
        <h3>{other.title}</h3><p>{other.sermonDate} · {other.bibleReferenceLabel}</p>
        <p>마감: {new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "long", timeStyle: "short" }).format(new Date(other.closesAt))} (한국 시간)</p>
        <div>{other.availableDifficulties.map((level) => <Link className="text-link" key={level} to={`/quiz/${other.slug}?level=${level}`}>{level === "child" ? "어린이용" : "장년용"} 풀기</Link>)}</div>
      </li>)}</ul>
    </section>}
  </article>;
}
