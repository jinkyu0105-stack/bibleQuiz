import { AdminEmoji, AdminLabel, AdminTooltip } from "../../components/AdminHelp";
import { AdminBoardHeader, AdminIndexedBoard, AdminRefreshButton, AdminIconLink } from "../../components/AdminListTools";
import { AdminIcon } from "../../components/AdminIcon";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ButtonLink } from "../../components/Button";
import { weeklyDashboardSchema, type WeeklyQuiz } from "../../../shared/api/admin-weekly";
import { draftCleanupListSchema } from "../../../shared/api/admin-draft-cleanup";
import { weeklyRequest } from "./client";
import { MonthlySermonTheme } from "./MonthlySermonTheme";
import styles from "./dashboard.module.css";

const date = (value: string) => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric" }).format(new Date(value));
const time = (value: string) => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
const isDraft = (quiz: WeeklyQuiz) => !["published", "archived"].includes(quiz.status);
function stage(quiz: WeeklyQuiz) {
  if (quiz.expired) return "본문 정리됨";
  if (quiz.status === "archived") return "마감";
  if (quiz.status === "published") return quiz.submissionStatus === "paused" ? "접수 중지" : "공개 중";
  if (quiz.jobStatus === "failed") return "생성 확인 필요";
  if (quiz.jobStatus === "running") return "생성 중";
  if (quiz.status === "needs_revision") return "수정 필요";
  return "작성 중";
}
const progress: Record<string, string> = { intent_review: "설교 의도 검토", content_review: "요약·문제 검토", finish: "발행 전 확인" };
type Filter = "all" | "draft" | "published" | "archived";
export function Component() {
  const [data, setData] = useState<ReturnType<typeof weeklyDashboardSchema.parse> | null>(null);
  const [cleanup, setCleanup] = useState<ReturnType<typeof draftCleanupListSchema.parse> | null>(null);
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [checkedAt, setCheckedAt] = useState(Date.now);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    void weeklyRequest("/api/admin/dashboard", weeklyDashboardSchema, "GET", undefined, controller.signal).then(next => {
      if (!controller.signal.aborted) { setData(next); setCheckedAt(Date.now()); setLoading(false); }
    }).catch(() => { if (!controller.signal.aborted) { setMessage("퀴즈 목록을 불러오지 못했습니다. 다시 시도해 주세요."); setLoading(false); } });
    void weeklyRequest("/api/admin/draft-cleanup", draftCleanupListSchema, "GET", undefined, controller.signal).then(next => {
      if (!controller.signal.aborted) setCleanup(next);
    }).catch(() => { if (!controller.signal.aborted) setCleanup(null); });
    return () => controller.abort();
  }, [attempt]);
  const items = data?.items ?? [];
  const drafts = items.filter(isDraft), published = items.filter(q => q.status === "published"), archived = items.filter(q => q.status === "archived");
  const featured = items.find(q => q.quizSetId === data?.homeQuiz?.quizSetId);
  const rows = items.filter(q => (filter === "all" || (filter === "draft" ? isDraft(q) : q.status === filter)) && `${q.title} ${q.sermonDate}`.includes(search.trim()));
  const due = cleanup?.items.filter(q => q.state === "blocked" || (q.state !== "purged" && q.dueAt && Date.parse(q.dueAt) - checkedAt <= 86_400_000)) ?? [];
  return <div className={styles.page} data-admin-board="quizzes">
    <AdminBoardHeader title="퀴즈 관리" description="퀴즈를 준비하고, 공개와 참여를 관리하세요." terms={["초안", "발행", "자동 선택", "대표 지정"]} screenshots={["dashboard"]} actions={<ButtonLink variant="primary" to="/admin/new">퀴즈 준비 <span aria-hidden="true">＋</span></ButtonLink>}/>
    {message && <p className={styles.alert} role="alert">{message}</p>}
    <div className={styles.statusBar} data-admin-summary>
    <div className={styles.overview} role="group" aria-label="운영 요약">
      <button type="button" data-admin-tone="success" aria-pressed={filter === "published"} onClick={() => setFilter("published")}><span className={styles.metricLabel}><AdminEmoji>📣</AdminEmoji>공개 중</span><span className={styles.metricValue}><strong>{data ? published.length : "—"}</strong><small>건</small></span></button>
      <button type="button" data-admin-tone="action" aria-pressed={filter === "draft"} onClick={() => setFilter("draft")}><span className={styles.metricLabel}><AdminEmoji>✏️</AdminEmoji>작성 중</span><span className={styles.metricValue}><strong>{data ? drafts.filter(q => !q.expired).length : "—"}</strong><small>건</small></span></button>
      <Link data-admin-tone="attention" to="/admin/privacy-requests"><span className={styles.metricLabel}><AdminEmoji>💬</AdminEmoji>답변 대기</span><span className={styles.metricValue}><strong>{data?.unansweredCount ?? "—"}</strong><small>건</small></span></Link>
    </div>
    {data && <section className={styles.featured} aria-labelledby="home-quiz-heading">
      <div className={styles.featuredCopy}><span className={styles.caption}><AdminEmoji>📡</AdminEmoji>Live</span>
        <h3 id="home-quiz-heading">{featured?.title ?? "아직 공개된 퀴즈가 없습니다"}</h3>
        <p>{featured ? `${date(featured.sermonDate)} · ${featured.status === "archived" ? "지난 퀴즈" : "공개 중"}${data.homeQuiz?.selection === "automatic" ? " · 자동 선택" : " · 대표 지정"}` : "준비한 퀴즈를 발행하면 이곳에 표시됩니다."}</p>
      </div>
      {featured?.slug && <ButtonLink to={`/quiz/${featured.slug}`}>공개 화면 <span aria-hidden="true">↗</span></ButtonLink>}
    </section>}
    </div>
    <MonthlySermonTheme/>
    <section className={styles.library} aria-labelledby="quiz-library-heading" aria-busy={loading}>
      <div className={styles.sectionHeading}><h3 id="quiz-library-heading"><AdminLabel text="퀴즈 목록"/> <span>{items.length}</span></h3>
        <AdminRefreshButton disabled={loading} onClick={() => { setMessage(""); setLoading(true); setAttempt(v => v + 1); }} label="운영 상태 새로고침" title="퀴즈 목록 새로고침"/>
      </div>
      <AdminIndexedBoard label="퀴즈 상태" value={filter} onChange={setFilter} options={([['all', '전체', items.length, 'action'], ['draft', '작성 중', drafts.length, 'action'], ['published', '공개 중', published.length, 'success'], ['archived', '지난 퀴즈', archived.length, 'guide']] as const).map(([value,label,count,tone])=>({value,label,count,tone}))} controls={
        <label className={styles.search}><span className="sr-only">퀴즈 검색</span><input type="search" placeholder="제목 또는 날짜 검색" value={search} onChange={e => setSearch(e.target.value)}/></label>
      }>
      {!data && loading ? <div className={styles.empty} role="status">퀴즈를 불러오고 있습니다.</div> : !data ? <div className={styles.empty}>새로고침을 눌러 목록을 다시 불러오세요.</div> : rows.length === 0 ? <div className={styles.empty}><h4>{items.length ? "조건에 맞는 퀴즈가 없습니다" : "첫 퀴즈를 준비해 보세요"}</h4><p>{items.length ? "검색어나 상태를 바꾸면 다른 퀴즈를 볼 수 있습니다." : "설교 영상 등록부터 문제 검토와 발행까지 한 화면에서 이어집니다."}</p>{!items.length && <ButtonLink to="/admin/new">퀴즈 준비하기</ButtonLink>}</div> :
        <><div className={styles.boardHeading} aria-hidden="true"><span>설교일</span><span>퀴즈</span><span>참여 · 관리</span></div>
        <ul className={styles.quizList}>{rows.map(q => {
          const description = [q.quizSetId === data.homeQuiz?.quizSetId ? "홈에 표시되는 퀴즈" : "", isDraft(q) ? q.expired ? "발행 기록과 비용은 보존됩니다." : progress[q.stage ?? ""] ?? "설교 등록·입력 확인" : q.closesAt ? `${q.status === "archived" ? "마감일" : "접수 마감"} ${time(q.closesAt)}${q.status === "published" && Date.parse(q.closesAt) <= checkedAt ? " · 마감 처리 대기" : ""}` : ""].filter(Boolean).join(" · ");
          return <li key={q.quizSetId}><article className={styles.quizRow} data-admin-quiz-row>
            <time className={styles.date} dateTime={q.sermonDate}><span className="sr-only">설교일 {q.sermonDate}</span><span aria-hidden="true">{q.sermonDate.slice(0, 4)}</span><strong aria-hidden="true">{q.sermonDate.slice(5).replace("-", ".")}</strong></time>
            <div className={styles.quizCopy}>
              <AdminTooltip label={description || stage(q)}>{descriptionId => <span className={styles.status} tabIndex={0} aria-describedby={descriptionId} data-state={q.expired ? "archived" : q.status} data-tone={q.expired || q.status === "archived" ? "neutral" : q.submissionStatus === "paused" || q.jobStatus === "failed" || q.status === "needs_revision" ? "attention" : q.status === "published" ? "success" : "action"}>{stage(q)}</span>}</AdminTooltip>
              <h4>{q.title}</h4>
            </div>
            <div className={styles.rowActions}>
              {!isDraft(q) && <div className={styles.participants}>
                {([['child', '어린이', q.childVisibleCount], ['adult', '장년', q.adultVisibleCount]] as const).map(([icon,label,count]) => <AdminTooltip key={icon} label={`${label} ${count}명 참여`}><span className={styles.participant} tabIndex={0} role="img" aria-label={`${label} ${count}명 참여`}><AdminIcon name={icon}/><span aria-hidden="true">{count}</span></span></AdminTooltip>)}
              </div>}
              {!q.expired && <AdminIconLink to={`/admin/quiz/${q.quizSetId}`} icon={isDraft(q) ? "edit" : "settings"} label={isDraft(q) ? "초안 편집" : "퀴즈 설정"}/>}
              {!isDraft(q) && <AdminIconLink to={`/admin/submissions?quiz=${q.quizSetId}`} icon="people" label="참여 기록"/>}
            </div>
          </article></li>;
        })}</ul></>}

      </AdminIndexedBoard>
    </section>
    {due.length > 0 && <details className={styles.cleanup}><summary><span><AdminLabel text="초안 보관 알림"/></span><span>{due.length}건</span></summary><p>본문 정리 예정이거나 확인이 필요한 초안입니다.</p><ul>{due.map(q => <li key={q.sermonId}><span>{q.title}</span><span>{q.state === "blocked" ? "확인 필요" : q.dueAt ? time(q.dueAt) : "시각 미확인"}</span></li>)}</ul><Link to="/admin/tools#cleanup">보관 현황 열기 →</Link></details>}
    <footer className={styles.footer}><Link data-tone="guide" to="/admin/manual">퀴즈 운영이 처음이신가요? <span>사용 안내 ↗</span></Link><Link to="/admin/operations">비용·백업 확인 ↗</Link></footer>
  </div>;
}
