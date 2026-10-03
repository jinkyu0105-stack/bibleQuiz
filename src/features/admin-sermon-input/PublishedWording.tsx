import { useEffect, useRef, useState, type FormEvent } from "react";
import { wordingRequestSchema, wordingViewSchema, type WordingView } from "../../../shared/api/admin-wording";
import { displayTextResultSchema } from "../../../shared/api/admin-display-text";
import styles from "./admin-sermon-input.module.css";

const label = (t: WordingView["targets"][number]) => t.kind === "summary" ? "AI 요약" :
  `${t.difficulty === "child" ? "어린이" : "장년"} ${t.direction === "across" ? "가로" : "세로"} ${t.number}번 단서`;
export function PublishedWording({ quizSetId }: { quizSetId: string }) {
  const [view, setView] = useState<WordingView | null>(null), [attempt, setAttempt] = useState(0);
  const [target, setTarget] = useState(""), [after, setAfter] = useState(""), [reason, setReason] = useState("");
  const [assessment, setAssessment] = useState(""), [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const pending = useRef<{ signature: string; key: string } | null>(null), lock = useRef(false);
  const mutation = useRef<AbortController | null>(null);
  useEffect(() => () => mutation.current?.abort(), []);
  const url = `/api/admin/quiz-sets/${quizSetId}/display-text/wording`;
  useEffect(() => {
    const controller = new AbortController();
    void fetch(url, { credentials: "same-origin", cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })
      .then(async r => { if (!r.ok) throw new Error(); return r.json() as Promise<{ data: unknown }>; })
      .then(r => {
        if (controller.signal.aborted) return;
        setView(wordingViewSchema.parse(r.data)); setTarget(""); setAfter(""); setReason(""); setAssessment(""); setConfirmed(false); setError(""); pending.current = null;
      }).catch(() => { if (!controller.signal.aborted) setError("문구를 불러오지 못했습니다. 최신 문구를 다시 확인해 주세요."); });
    return () => controller.abort();
  }, [url, attempt]);
  const selected = view?.targets.find(t => t.target === target);
  const semantic = assessment === "semantic" || assessment === "uncertain";
  async function save(event: FormEvent) {
    event.preventDefault(); if (!view || !selected || lock.current) return;
    const fields = { expectedRevision: view.revision, contentRevision: view.contentRevision, target, before: selected.text, after, reason,
      assessment, confirmation: confirmed ? "meaning_and_answer_unchanged" : "" };
    const signature = JSON.stringify(fields);
    if (pending.current?.signature !== signature) pending.current = { signature, key: crypto.randomUUID() };
    const parsed = wordingRequestSchema.safeParse({ ...fields, requestKey: pending.current.key });
    if (!parsed.success) { setError("수정 전후 문구·사유와 의미가 같다는 확인을 검토해 주세요."); return; }
    lock.current = true; setBusy(true); setError(""); setMessage("");
    const controller = new AbortController(); mutation.current = controller;
    try {
      const r = await fetch(url, { method: "PATCH", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]), body: JSON.stringify(parsed.data) });
      if (!r.ok) {
        const body = await r.json() as { error?: { code?: string } };
        if (body.error?.code === "SEMANTIC_CORRECTION_REQUIRED") throw new Error("semantic");
        throw new Error();
      }
      displayTextResultSchema.parse((await r.json() as { data: unknown }).data);
      if (!controller.signal.aborted) { setMessage("오탈자 정정을 저장했습니다. 원래 정답과 성적은 보존됩니다."); setView(null); setAttempt(v => v + 1); }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error && failure.message === "semantic"
        ? "의미·정답 유도 변경은 문제 오류 처리에서 진행해 주세요."
        : "저장을 확인하지 못했습니다. 입력은 유지됩니다. 같은 내용으로 다시 저장하거나 최신 문구를 불러와 주세요.");
    } finally { lock.current = false; if (!controller.signal.aborted) setBusy(false); }
  }
  return <section aria-label="일반 문구 오탈자" className={styles.displayEditor}>
    <h3>일반 문구 오탈자</h3>
    <p>철자·띄어쓰기·문장부호만 바로잡습니다. 의미·난이도·정답 유도가 같다는 판단은 관리자가 직접 확인합니다.</p>
    <p><a href="#problem-correction-title">의미 변경·불확실한 수정은 문제 오류 처리로 이동</a></p>
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
    <button type="button" disabled={busy} onClick={() => { setView(null); setError(""); setAttempt(v => v + 1); }}>최신 문구 불러오기</button>
    {!view ? !error && <p role="status">문구를 불러오고 있습니다.</p> : <>
      {view.blocked && <p role="status">문제 오류 처리가 진행 중입니다. 해당 수정본에서 검토를 이어가 주세요.</p>}
      {!view.targets.length && <p>수정할 요약·단서가 없습니다.</p>}
      <form onSubmit={event => void save(event)}><fieldset disabled={busy || view.blocked} className={`${styles.displayFields} ${styles.wordingFields}`}>
        <legend>문구 비교와 정정</legend>
        <label className={styles.textareaLabel}>수정할 문구<select value={target} onChange={e => { setTarget(e.target.value); setAfter(view.targets.find(t => t.target === e.target.value)?.text ?? ""); setConfirmed(false); setAssessment(""); setMessage(""); }}>
          <option value="">문구 선택</option>{view.targets.map(t => <option key={t.target} value={t.target}>{label(t)}</option>)}
        </select></label>
        {selected && <>
          <div className={styles.formGrid}><label className={styles.textareaLabel}>수정 전<textarea readOnly value={selected.text} rows={4} /></label>
          <label className={styles.textareaLabel}>수정 후<textarea required value={after} maxLength={selected.kind === "clue" ? 2000 : 20000} rows={4} onChange={e => { setAfter(e.target.value); setConfirmed(false); }} /></label></div>
          <label className={styles.textareaLabel}>수정 종류<select value={assessment} onChange={e => { setAssessment(e.target.value); setConfirmed(false); }}>
            <option value="">직접 확인 후 선택</option><option value="non_semantic_typo">의미가 같은 철자·띄어쓰기·문장부호</option>
            <option value="semantic">의미·난이도·정답 유도 변경</option><option value="uncertain">판단이 불확실함</option>
          </select></label>
          {semantic ? <p role="status">이 수정은 여기서 저장할 수 없습니다. <a href="#problem-correction-title">문제 오류 처리에서 검토하기</a></p> : <>
            <label className={styles.textareaLabel}>오탈자 정정 사유<input required minLength={2} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label>
            <label className={styles.checkbox}><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />수정 전후의 의미·난이도·정답 유도가 같음을 확인했습니다.</label>
            <button type="submit" className="primary-button" disabled={!confirmed || assessment !== "non_semantic_typo" || selected.text === after.trim()}>{busy ? "저장 중" : "오탈자 저장"}</button>
          </>}
        </>}
      </fieldset></form>
      <details><summary>문구 정정 이력 ({view.history.length})</summary>
        {view.history.length === 0 ? <p>아직 문구 정정 이력이 없습니다.</p> : <ol className={styles.cleanupList}>{view.history.map(h => <li key={h.revision}>
          <strong>{new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }).format(new Date(h.createdAt))} (한국 시간)</strong>
          <p>수정 전: {h.before}</p><p>수정 후: {h.after}</p><p>사유: {h.reason}</p>
        </li>)}</ol>}
      </details>
    </>}
  </section>;
}
