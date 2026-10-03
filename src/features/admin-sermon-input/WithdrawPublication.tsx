import { QuizRevisionEditor } from "./QuizRevisionEditor";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { publishedMetadataListSchema, type PublishedMetadata } from "../../../shared/api/admin-display-text";
import { withdrawRequestSchema, withdrawResultSchema, withdrawalListSchema, withdrawalViewSchema, type WithdrawalView } from "../../../shared/api/admin-withdraw";
import styles from "./admin-sermon-input.module.css";
async function request<T>(url: string, schema: z.ZodType<T>, signal: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch(url, { method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  if (!response.ok) throw new Error("unavailable");
  const payload = await response.json() as { data?: unknown }; return schema.parse(payload.data);
}
const dateTime = (value: string) => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
export function WithdrawPublication({ initialQuizSetId = "", initialReviewId = "" }: { initialQuizSetId?: string; initialReviewId?: string } = {}) {
  const [items, setItems] = useState<PublishedMetadata[] | null>(null);
  const [withdrawn, setWithdrawn] = useState<z.infer<typeof withdrawalListSchema>["items"]>([]);
  const [id, setId] = useState(initialQuizSetId), [reason, setReason] = useState(""), [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState(0), [reviewId, setReviewId] = useState(initialReviewId), [review, setReview] = useState<WithdrawalView | null>(null);
  const pending = useRef<{ signature: string; key: string } | null>(null), mutation = useRef<AbortController | null>(null);
  const lock = useRef(false);
  useEffect(() => () => mutation.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      request("/api/admin/published-quizzes", publishedMetadataListSchema, controller.signal),
      request("/api/admin/withdrawn-quizzes", withdrawalListSchema, controller.signal),
    ]).then(([published, saved]) => { if (!controller.signal.aborted) { setItems(published.items.filter(q => q.status === "published")); setWithdrawn(saved.items); } })
      .catch(() => { if (!controller.signal.aborted) setError("목록을 불러오지 못했습니다. 목록 다시 확인을 눌러 주세요."); });
    return () => controller.abort();
  }, [attempt]);
  useEffect(() => {
    if (!reviewId) return;
    const controller = new AbortController();
    void request(`/api/admin/quiz-sets/${reviewId}/withdraw-to-review`, withdrawalViewSchema, controller.signal)
      .then(value => { if (!controller.signal.aborted) setReview(value); })
      .catch(() => { if (!controller.signal.aborted) setError("검수 시작 자료를 불러오지 못했습니다. 목록 다시 확인을 눌러 주세요."); });
    return () => controller.abort();
  }, [reviewId, attempt]);
  const selected = items?.find(q => q.quizSetId === id);
  async function withdraw() {
    if (!selected || lock.current) return;
    const fields = { expectedPublishedAt: selected.publishedAt, expectedDisplayRevision: selected.revision, reason, confirmation: "withdraw" };
    const signature = JSON.stringify({ id, ...fields });
    if (pending.current?.signature !== signature) pending.current = { signature, key: crypto.randomUUID() };
    const command = withdrawRequestSchema.safeParse({ ...fields, requestKey: pending.current.key });
    if (!command.success) { setError("철회 사유를 2~500자로 입력해 주세요."); return; }
    const controller = new AbortController(); mutation.current = controller; lock.current = true; setBusy(true); setError("");
    try {
      await request(`/api/admin/quiz-sets/${id}/withdraw-to-review`, withdrawResultSchema, controller.signal, command.data);
      if (!controller.signal.aborted) {
        setMessage("발행을 철회하고 검수 대기로 돌렸습니다. 문제·정답과 발행 이력은 보존됩니다.");
        setReview(null); setReviewId(id); setId(""); setReason(""); setConfirm(false); pending.current = null; setAttempt(a => a + 1);
      }
    } catch { if (!controller.signal.aborted) setError("철회를 확인하지 못했습니다. 제출·마감·정정 여부를 확인해 주세요. 입력한 사유는 유지되며 같은 요청을 다시 확인할 수 있습니다."); }
    finally { lock.current = false; if (!controller.signal.aborted) setBusy(false); }
  }
  return <section className={styles.panel} aria-labelledby="withdraw-title">
    <h2 id="withdraw-title">첫 제출 전 발행 철회</h2>
    <p>어린이·장년 전체에 제출 기록이 없을 때 공개를 취소하고 검수 대기로 돌립니다. 저장할 때 제출 여부를 다시 확인합니다.</p>
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
    <button type="button" disabled={busy} onClick={() => { setError(""); setConfirm(false); setAttempt(a => a + 1); }}>목록 다시 확인</button>
    {items === null ? !error && <p role="status">철회 가능한 발행 목록을 불러오고 있습니다.</p> : items.length === 0 ? <p>현재 발행 중인 퀴즈가 없습니다.</p> : <>
      <label>철회할 퀴즈<select aria-label="철회할 퀴즈" disabled={busy} value={id} onChange={e => { setId(e.target.value); setConfirm(false); setReason(""); pending.current = null; }}>
        <option value="">퀴즈 선택</option>{items.map(q => <option key={q.quizSetId} value={q.quizSetId}>{q.metadata.sermonDate} · {q.metadata.title}</option>)}
      </select></label>
      {selected && <form onSubmit={e => { e.preventDefault(); setError(""); setConfirm(true); }}>
        <fieldset disabled={busy} className={styles.displayFields}>
          <legend>발행 철회</legend>
          <p>발행 {dateTime(selected.publishedAt)} · 마감 {dateTime(selected.closesAt)} (한국 시간)</p>
          <label>철회 사유<input value={reason} required minLength={2} maxLength={500} onChange={e => { setReason(e.target.value); setConfirm(false); }} /></label>
          {!confirm ? <button type="submit">발행 철회 확인</button> : <div role="group" aria-label="발행 철회 최종 확인">
            <p>공개 링크에서 풀이와 제출을 중단합니다. 다른 열린 퀴즈를 메인에 표시하며, 없으면 지난 퀴즈를 읽기 전용으로 소개하거나 준비 안내를 표시합니다.</p>
            <p>최신 제목·설교일과 요약·두 난이도 문제·정답을 검수 시작 자료로 보관합니다.</p>
            <button type="button" onClick={() => setConfirm(false)}>취소</button>
            <button type="button" onClick={() => void withdraw()}>{busy ? "철회 확인 중" : "지금 발행 철회"}</button>
          </div>}
        </fieldset>
      </form>}
    </>}
    {withdrawn.length > 0 && <label>철회한 퀴즈 검수 자료<select aria-label="철회한 퀴즈 검수 자료" disabled={busy} value={reviewId} onChange={e => { setReview(null); setReviewId(e.target.value); }}>
      <option value="">퀴즈 선택</option>{withdrawn.map(q => <option key={q.quizSetId} value={q.quizSetId}>{q.title}</option>)}
    </select></label>}
    {review && <article aria-label="철회 후 검수 시작 자료">
      <h3>{review.review.metadata.title}</h3><p>검수본 {review.reviewRevision} · 철회 {dateTime(review.withdrawnAt)} (한국 시간)</p>
      <p>설교일 {review.review.metadata.sermonDate} · {review.review.bibleReferenceLabel}</p><p>철회 사유: {review.reason}</p>
      <p>{review.review.summary}</p>
      {review.review.variants.map(variant => <details key={variant.difficulty}><summary>{variant.difficulty === "child" ? "어린이" : "장년"} 문제·정답 보존 자료</summary>
        <ol>{variant.entries.map((entry, index) => {
          return <li key={index}>{entry.clue} · 정답: {variant.entryAnswers[entry.id]}</li>;
        })}</ol>
      </details>)}
      <QuizRevisionEditor key={review.quizSetId} quizSetId={review.quizSetId} />
    </article>}
  </section>;
}
