import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { deadlineCommitSchema, deadlinePreviewSchema, deadlineProposalSchema, deadlineResultSchema, deadlineViewSchema,
  type DeadlinePreview, type DeadlineView } from "../../../shared/api/admin-deadline";
import styles from "./admin-sermon-input.module.css";

const localKst = (value: string) => new Date(Date.parse(value) + 9 * 3600000).toISOString().slice(0, 19);
const time = (value: string) => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "medium" }).format(new Date(value));
const duration = (seconds: number) => `${Math.floor(seconds / 86400)}일 ${Math.floor(seconds % 86400 / 3600)}시간 ${Math.floor(seconds % 3600 / 60)}분`;
export function QuizDeadline({ quizSetId, onSaved }: { quizSetId: string; onSaved: () => void }) {
  const [view, setView] = useState<DeadlineView | null>(null), [preview, setPreview] = useState<DeadlinePreview | null>(null);
  const [date, setDate] = useState(""), [reason, setReason] = useState(""), [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState(""), [attempt, setAttempt] = useState(0);
  const lock = useRef(false), controller = useRef<AbortController | null>(null), pending = useRef<z.infer<typeof deadlineCommitSchema> | null>(null);
  const url = `/api/admin/quiz-sets/${quizSetId}/closes-at`;
  async function request<T>(method: string, schema: z.ZodType<T>, signal: AbortSignal, body?: unknown) {
    const r = await fetch(url, { method, credentials: "same-origin", cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
      ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
    if (!r.ok) throw new Error();
    return schema.parse((await r.json() as { data: unknown }).data);
  }
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    const c = new AbortController();
    void fetch(url, { credentials: "same-origin", cache: "no-store", signal: AbortSignal.any([c.signal, AbortSignal.timeout(15000)]) })
      .then(async r => { if (!r.ok) throw new Error(); return deadlineViewSchema.parse((await r.json() as { data: unknown }).data); })
      .then(v => { if (!c.signal.aborted) { setView(v); setDate(localKst(v.closesAt)); setReason(""); setPreview(null); setConfirmed(false); pending.current = null; setError(""); } })
      .catch(() => { if (!c.signal.aborted) setError("마감 정보를 불러오지 못했습니다. 다시 확인해 주세요."); });
    return () => c.abort();
  }, [url, attempt]);
  function invalidate() { setPreview(null); setConfirmed(false); pending.current = null; setMessage(""); }
  async function submit(commit: boolean) {
    if (lock.current || !view?.changeable) return;
    const milliseconds = Date.parse(`${date}+09:00`);
    const proposal = deadlineProposalSchema.safeParse({ closesAt: Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : "", reason });
    if (!proposal.success) { setError("한국 시간의 마감 일시와 2~500자의 사유를 확인해 주세요."); return; }
    if (commit && (!preview || !confirmed)) return;
    lock.current = true; setBusy(true); setError(""); setMessage("");
    const c = new AbortController(); controller.current = c;
    try {
      if (!commit) {
        const next = await request("POST", deadlinePreviewSchema, c.signal, proposal.data);
        if (!c.signal.aborted) { setPreview(next); setConfirmed(false); pending.current = null; }
      } else {
        pending.current ??= deadlineCommitSchema.parse({ ...proposal.data, requestKey: crypto.randomUUID(), confirmationToken: preview!.confirmationToken,
          confirmation: preview!.immediate ? "close_now" : "change_deadline" });
        const result = await request("PATCH", deadlineResultSchema, c.signal, pending.current);
        if (!c.signal.aborted) { setMessage(result.archived ? "지금 마감했습니다. 기존 제출과 확정 순위는 보존됩니다." : "마감 일시를 변경했습니다. 기존 정답·제출·성적은 보존됩니다.");
          setView(null); setPreview(null); setConfirmed(false); setAttempt(v => v + 1); onSaved(); }
      }
    } catch {
      if (!c.signal.aborted) setError("변경을 확인하지 못했습니다. 입력은 유지됩니다. 같은 요청을 다시 저장하거나 변경 영향 다시 확인으로 최신 상태를 검토해 주세요. 이미 마감된 퀴즈는 재개할 수 없습니다.");
    } finally { lock.current = false; if (!c.signal.aborted) setBusy(false); }
  }
  return <section className={styles.displayEditor} aria-label="일반 마감 변경">
    <h3>일반 마감 변경</h3>
    <p>한국 시간으로 입력합니다. 기존 정답·제출·성적을 보존하며 이미 마감된 퀴즈는 다시 열지 않습니다.</p>
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
    <button type="button" disabled={busy} onClick={() => { invalidate(); setView(null); setError(""); setAttempt(v => v + 1); }}>최신 마감 불러오기</button>
    {!view ? !error && <p role="status">마감 정보를 불러오고 있습니다.</p> : <>
      <p>현재 마감: {view.closesAtKst} (한국 시간)</p>
      <p>성공 제출 {view.impact.total}건 · 공개 {view.impact.visible}건 · 숨김 {view.impact.hidden}건 · 삭제 표식 {view.impact.deleted}건</p>
      {!view.changeable && <p role="status">이미 마감되었거나 변경할 수 없는 상태입니다. 접수를 재개하지 않습니다.</p>}
      {view.paused && <p>접수 중지 상태는 마감 변경 후에도 유지됩니다. 문제 오류 처리에서 수정과 검토를 이어가세요.</p>}
      <form onSubmit={e => { e.preventDefault(); void submit(false); }}>
        <fieldset disabled={busy || !view.changeable} className={styles.displayFields}>
          <legend>마감 일시와 사유</legend>
          <div className={styles.formGrid}>
            <label>변경할 마감 (한국 시간)<input type="datetime-local" step="1" required value={date} onChange={e => { setDate(e.target.value); invalidate(); }} /></label>
            <label>마감 변경 사유<input required minLength={2} maxLength={500} value={reason} onChange={e => { setReason(e.target.value); invalidate(); }} /></label>
          </div>
          <button type="submit">변경 영향 다시 확인</button>
          {preview && <div>
            <p>기존 마감: {preview.previousKst} (한국 시간)</p><p>변경 요청: {preview.requestedKst} (한국 시간)</p>
            <p>확인 시점의 남은 시간: {duration(preview.remainingSeconds)} → {duration(preview.newRemainingSeconds)}</p>
            <p>영향을 받는 기존 제출 {preview.impact.total}건. 연장·단축으로 남은 참여 시간이 달라집니다. 기존 성적을 다시 채점하지 않습니다.</p>
            {preview.immediate && <p role="status">현재 이전의 시각입니다. 저장하면 지금 마감하고 순위를 확정합니다. 과거로 소급해 제출을 삭제하지 않습니다.</p>}
            <label className={styles.checkbox}><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />기존·변경 마감과 제출 영향을 확인했습니다.{preview.immediate && " 지금 마감에 동의합니다."}</label>
            <button type="button" className="primary-button" disabled={!confirmed} onClick={() => void submit(true)}>{preview.immediate ? "지금 마감 확정" : "마감 변경 저장"}</button>
          </div>}
        </fieldset>
      </form>
      <details><summary>마감 변경 이력 ({view.history.length})</summary>
        {view.history.length === 0 ? <p>아직 마감 변경 이력이 없습니다.</p> : <ol className={styles.cleanupList}>{view.history.map((h, i) => <li key={i}>
          <strong>{time(h.createdAt)} (한국 시간)</strong><p>{time(h.before)} → {time(h.after)} (한국 시간)</p>
          {h.immediate && <p>요청 {time(h.requested)} · 실제 처리 시각에 즉시 마감</p>}<p>사유: {h.reason}</p>
        </li>)}</ol>}
      </details>
    </>}
  </section>;
}
