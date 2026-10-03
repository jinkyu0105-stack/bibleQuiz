import { AiCostDetails } from "./AiCostDetails";
import { QuizDeadline } from "./QuizDeadline";
import { PublishedWording } from "./PublishedWording";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { displayTextRequestSchema, displayTextResultSchema, displayTextViewSchema, publishedMetadataListSchema,
  type DisplayTextView, type PublishedMetadata } from "../../../shared/api/admin-display-text";
import styles from "./admin-sermon-input.module.css";

async function request<T>(url: string, schema: z.ZodType<T>, signal: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch(url, { method: body ? "PATCH" : "GET", credentials: "same-origin", cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  if (!response.ok) throw new Error("unavailable");
  const data = await response.json() as { data?: unknown };
  return schema.parse(data.data);
}
const dateTime = (value: string) => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

function Editor({ quizSetId, onSaved }: { quizSetId: string; onSaved: () => void }) {
  const [showDeadline, setShowDeadline] = useState(false);
  const [showWording, setShowWording] = useState(false);
  const [view, setView] = useState<DisplayTextView | null>(null), [attempt, setAttempt] = useState(0);
  const [title, setTitle] = useState(""), [date, setDate] = useState(""), [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const pending = useRef<{ signature: string; key: string } | null>(null);
  const mutation = useRef<AbortController | null>(null);
  useEffect(() => () => mutation.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    void request(`/api/admin/quiz-sets/${quizSetId}/display-text`, displayTextViewSchema, controller.signal).then(data => {
      if (controller.signal.aborted) return;
      setView(data); setTitle(data.quiz.metadata.title); setDate(data.quiz.metadata.sermonDate); setReason(""); setError(""); pending.current = null;
    }).catch(() => { if (!controller.signal.aborted) setError("현재 표시 정보를 불러오지 못했습니다. 최신 내용을 다시 확인해 주세요."); });
    return () => controller.abort();
  }, [quizSetId, attempt]);
  async function save(event: FormEvent) {
    event.preventDefault(); if (!view || busy) return;
    const fields = { expectedRevision: view.quiz.revision, before: view.quiz.metadata, after: { title, sermonDate: date }, reason };
    const signature = JSON.stringify(fields);
    if (pending.current?.signature !== signature) pending.current = { signature, key: crypto.randomUUID() };
    const command = displayTextRequestSchema.safeParse({ ...fields, requestKey: pending.current.key });
    if (!command.success) { setError("바뀐 제목·설교일과 2~500자의 정정 사유를 확인해 주세요."); return; }
    const controller = new AbortController(); mutation.current = controller; setBusy(true); setError(""); setMessage("");
    try {
      await request(`/api/admin/quiz-sets/${quizSetId}/display-text`, displayTextResultSchema, controller.signal, command.data);
      if (!controller.signal.aborted) { setMessage("정정을 저장했습니다. 공개 화면과 지난 퀴즈에 반영됩니다."); setView(null); setAttempt(a => a + 1); onSaved(); }
    } catch {
      if (!controller.signal.aborted) setError("저장을 확인하지 못했습니다. 같은 내용으로 다시 저장하거나 최신 내용을 불러와 다른 정정을 확인해 주세요. 입력한 내용은 유지됩니다.");
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }
  const weekday = date && Number.isFinite(Date.parse(`${date}T00:00:00Z`))
    ? new Intl.DateTimeFormat("ko-KR", { timeZone: "UTC", weekday: "long" }).format(new Date(`${date}T00:00:00Z`)) : "";
  return <div className={styles.displayEditor}>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
    <AiCostDetails quizSetId={quizSetId} />
    <button type="button" disabled={busy} onClick={() => { setError(""); setView(null); setAttempt(a => a + 1); }}>최신 내용 불러오기</button>
    {!view ? !error && <p role="status">현재 표시 정보를 불러오고 있습니다.</p> : <>
      <p><a href={`/quiz/${view.quiz.slug}`}>공개된 퀴즈 보기</a> · {view.quiz.status === "archived" ? "지난 퀴즈" : "발행된 퀴즈"}</p>
      <p>발행 {dateTime(view.quiz.publishedAt)} · 마감 {dateTime(view.quiz.closesAt)} (한국 시간)</p>
      <form onSubmit={event => void save(event)}>
        <fieldset disabled={busy} className={styles.displayFields}>
          <legend>제목·설교일 정정</legend>
          <div className={styles.formGrid}>
            <label>설교 제목<input value={title} maxLength={300} required onChange={e => setTitle(e.target.value)} /></label>
            <label>설교 일자<input type="date" value={date} required onChange={e => setDate(e.target.value)} /></label>
            <label>정정 사유<input value={reason} minLength={2} maxLength={500} required onChange={e => setReason(e.target.value)} /></label>
          </div>
          {weekday && <p>{weekday}{weekday !== "일요일" && "입니다. 특별예배 등 의도한 날짜인지 확인해 주세요."}</p>}
          <p>공개 링크와 접수 기간, 문제·정답·참여 기록은 그대로 유지됩니다. 단서나 요약의 의미 변경은 문제 오류 처리에서 진행합니다.</p>
          <button className="primary-button" type="submit">{busy ? "저장 중" : "정정 저장"}</button>
        </fieldset>
      </form>
      <button type="button" onClick={() => setShowWording(v => !v)}>{showWording ? "일반 문구 닫기" : "요약·단서 오탈자 수정"}</button>
      {showWording && <PublishedWording quizSetId={quizSetId} />}
      <button type="button" onClick={() => setShowDeadline(v => !v)}>{showDeadline ? "마감 변경 닫기" : "마감 일시 변경"}</button>
      {showDeadline && <QuizDeadline quizSetId={quizSetId} onSaved={() => { setAttempt(a => a + 1); onSaved(); }} />}
      <details><summary>정정 이력 ({view.history.length})</summary>
        {view.history.length === 0 ? <p>아직 정정한 기록이 없습니다.</p> : <ol className={styles.cleanupList}>{view.history.map(item => <li key={item.revision}>
          <strong>{dateTime(item.createdAt)} (한국 시간)</strong>
          <p>제목: {item.before.title} → {item.after.title}</p><p>설교일: {item.before.sermonDate} → {item.after.sermonDate}</p><p>사유: {item.reason}</p>
        </li>)}</ol>}
      </details>
    </>}
  </div>;
}

export function PublishedMetadata({ initialQuizSetId = "" }: { initialQuizSetId?: string } = {}) {
  const [items, setItems] = useState<PublishedMetadata[] | null>(null), [id, setId] = useState(initialQuizSetId);
  const [attempt, setAttempt] = useState(0), [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void request("/api/admin/published-quizzes", publishedMetadataListSchema, controller.signal).then(data => {
      if (!controller.signal.aborted) { setItems(data.items); setError(false); }
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [attempt]);
  return <section className={styles.panel} aria-labelledby="published-metadata-title">
    <h2 id="published-metadata-title">발행 정보 정정</h2>
    <p>발행된 퀴즈의 제목·설교일과 요약·단서 오탈자를 바로잡습니다. 초안 정리 후에도 이용할 수 있습니다.</p>
    {error ? <p role="alert">발행 목록을 불러오지 못했습니다. <button type="button" onClick={() => { setError(false); setAttempt(a => a + 1); }}>목록 다시 확인</button></p>
      : items === null ? <p role="status">발행 목록을 불러오고 있습니다.</p>
      : items.length === 0 ? <p>아직 발행된 퀴즈가 없습니다.</p>
      : <label>정정할 퀴즈<select value={id} onChange={event => setId(event.target.value)}><option value="">퀴즈 선택</option>
        {items.map(item => <option key={item.quizSetId} value={item.quizSetId}>{item.metadata.sermonDate} · {item.metadata.title}</option>)}
      </select></label>}
    {id && <Editor key={id} quizSetId={id} onSaved={() => setAttempt(a => a + 1)} />}
  </section>;
}
