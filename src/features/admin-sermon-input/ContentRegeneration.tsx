import { useRef, useState } from "react";
import type { AdminContentView } from "../../../shared/api/admin-content-generation";
import styles from "./admin-sermon-input.module.css";

type Scope = "intent" | "summary" | "child" | "adult";
type Choice = Scope | "child_one" | "adult_one";
const labels = { intent: "설교 의도", summary: "요약", child: "어린이 문제", adult: "장년 문제", child_one: "어린이 답·단서 하나", adult_one: "장년 답·단서 하나" };
const statuses: Record<string, string> = { dispatch_pending: "실행 대기", running: "생성 중", review_ready: "비교 자료 저장 완료",
  awaiting_intent_review: "의도 비교·재확정 대기", failed: "생성 실패", stale: "작업 종료(자료 변경 또는 비교 종료)", uncertain: "응답 확인 필요" };
export function ContentRegeneration({ view, inputConfirmed, busy, act }: { view: AdminContentView; inputConfirmed: boolean; busy: boolean;
  act: (action: "regenerate" | "discard", body: unknown, jobId?: string) => Promise<boolean> }) {
  const [choice, setChoice] = useState<Choice>("summary"), [targetKey, setTargetKey] = useState(""), [paid, setPaid] = useState(false);
  const [pending, setPending] = useState<{ requestKey: string; quizSetId: string; expectedVersion: number; scope: Scope; target?: { basePoolId: string; candidateId: string }; supersedesJobId?: string; retryCritiqueOnly?: true } | null>(null);
  const lock = useRef(false);
  const scope: Scope = choice === "child_one" ? "child" : choice === "adult_one" ? "adult" : choice;
  const single = choice === "child_one" || choice === "adult_one";
  const poolId = (scope === "child" || scope === "adult") && view.content.state === "present" ? view.content[scope]?.id : null;
  const pool = view.snapshots.find(s => s.kind === "candidate" && s.value.id === poolId);
  const candidates = pool?.kind === "candidate" ? pool.value.draft.candidates : [];
  const target = single && poolId ? candidates.find(c => `${poolId}:${c.id}` === targetKey) : null;
  const latest = view.regenerations.find(j => j.scope === scope && (single
    ? j.target?.basePoolId === poolId && j.target?.candidateId === target?.id : !j.target));
  const uncertainJob = view.regenerations.find(j => j.scope === scope && j.status === "uncertain");
  const blocking = view.regenerations.find(j => ["dispatch_pending", "running", "uncertain", "awaiting_intent_review"].includes(j.status));
  const running = blocking && !(blocking.jobId === uncertainJob?.jobId && blocking.status === "uncertain");
  const critiqueRetry = scope === "intent" && latest?.analysisId && !latest.resultId && ["failed", "uncertain"].includes(latest.status);
  const parentReady = view.stage === "content_review" || view.status === "review_ready";
  const ready = parentReady && inputConfirmed && view.content.state === "present" && !!view.content.intent?.confirmation;
  async function generate(retryCritiqueOnly = false) {
    if (lock.current || !paid || !view.quizSetId || !ready || single && !target && !pending || retryCritiqueOnly && !critiqueRetry) return;
    lock.current = true;
    const request = pending ?? { requestKey: crypto.randomUUID(), quizSetId: view.quizSetId, expectedVersion: view.version, scope, ...(single && target && poolId ? { target: { basePoolId: poolId, candidateId: target.id } } : {}),
      ...(retryCritiqueOnly ? { supersedesJobId: latest!.jobId, retryCritiqueOnly: true as const } : uncertainJob ? { supersedesJobId: uncertainJob.jobId } : {}) };
    setPending(request);
    try { if (await act("regenerate", request)) { setPending(null); setPaid(false); } }
    finally { lock.current = false; }
  }
  return <section aria-labelledby="individual-generation-title">
    <h4 id="individual-generation-title">필요한 내용만 다시 생성</h4>
    <p className={styles.helper}>의도는 분석·비판 2회, 나머지는 선택한 범위 1회 생성합니다. 기존 선택본은 유지되며 새 결과는 아래 비교 자료에서 직접 선택합니다. 선택·수정한 내용은 다시 검수하고 배치를 검토해야 합니다.</p>
    {!parentReady && <p>전체 생성의 내용 검수 단계에서 개별 재생성을 사용할 수 있습니다.</p>}
    {running && <p>다른 개별 생성 작업이 진행 중입니다. 생성 상태를 확인해 주세요.</p>}
    <label className={styles.field}>재생성 범위<select value={choice} disabled={busy || !!pending} onChange={e => { setChoice(e.currentTarget.value as Choice); setTargetKey(""); setPaid(false); }}>
      {Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select></label>
    {single && <><label className={styles.field}>다시 만들 답·단서<select value={target ? targetKey : ""} disabled={busy || !!pending}
      onChange={e => { setTargetKey(e.currentTarget.value); setPaid(false); }}>
      <option value="">현재 선택본에서 문제를 선택하세요</option>
      {candidates.map((c, i) => <option key={c.id} value={`${poolId}:${c.id}`}>{i + 1}. {c.displayAnswer} · {c.clue}</option>)}
    </select></label>
      {target && <p>현재 답: {target.displayAnswer}<br />현재 단서: {target.clue}</p>}
      <p className={styles.helper}>선택한 답·단서와 그 근거만 1회 생성합니다. 나머지 문제와 반드시 포함·제외 상태는 보존합니다. 생성 뒤 기존 값과 비교해 채택하거나 기존 선택을 유지할 수 있습니다.</p></>}
    <p className={styles.helper}>위 토큰 예시 기준 의도 2회 약 USD 0.16, 다른 범위 1회 약 USD 0.08이며 실제 비용은 분량에 따라 달라집니다. 직접 수정은 무료이고, 전체 대신 필요한 범위만 생성하면 호출 수를 줄일 수 있습니다.</p>
    {uncertainJob && <p>이전 응답이 확인되지 않았습니다. 새로 요청하면 별도 비용이 발생할 수 있으며 이전 호출과 비용 기록은 보존합니다.</p>}
    {critiqueRetry && <p>첫 분석은 저장되었습니다. 비판 검토만 다시 시도하면 새 AI 호출 1회, 위 토큰 예시 기준 약 USD 0.08입니다. 직접 검토·수정은 무료입니다.</p>}
    <label className={styles.checkbox}><input type="checkbox" checked={paid} disabled={busy} onChange={e => setPaid(e.currentTarget.checked)} />개별 재생성 비용과 무료 대안을 확인했습니다.</label>
    <button type="button" disabled={busy || !view.enabled || !ready || !paid || single && !target && !pending || !!running && !pending || !!pending && !!pending.retryCritiqueOnly} onClick={() => void generate(false)}>
      {pending ? "같은 재생성 요청 확인" : single ? "이 답·단서만 다시 생성" : `${labels[scope]}만 다시 생성`}
    </button>
    {critiqueRetry && <button type="button" disabled={busy || !view.enabled || !ready || !paid || single && !target && !pending || !!running && !pending || !!pending && !pending.retryCritiqueOnly}
      onClick={() => void generate(true)}>{pending?.retryCritiqueOnly ? "같은 비판 검토 요청 확인" : "비판 검토만 다시 시도"}</button>}
    {latest?.scope === "intent" && latest.status === "awaiting_intent_review" && <><p>새 분석과 비판 수정본을 아래에서 비교하고 직접 선택·수정한 뒤 설교 의도를 재확정해 주세요. 기존 요약·문제의 검수는 다시 필요합니다.</p>
      <button type="button" disabled={busy || !view.enabled || view.content.state !== "present" || view.content.intent?.rootAnalysisId === latest.analysisId}
        onClick={() => void act("discard", {}, latest.jobId)}>기존 의도 유지하고 비교 종료</button></>}
    {pending && <p role="status">요청 확인 전에는 같은 요청 번호를 유지합니다. 생성 상태를 확인해 주세요.</p>}
    {pending && pending.expectedVersion !== view.version && !view.regenerations.some(j => j.jobId === pending.requestKey) && <>
      <p>요청의 바탕 자료가 변경되었습니다. 현재 자료로 준비하면 새 요청 번호를 사용하며 비용 확인이 다시 필요합니다.</p>
      <button type="button" disabled={busy} onClick={() => { setPending(null); setPaid(false); }}>현재 자료로 새 요청 준비</button>
    </>}
    {pending && view.regenerations.some(j => j.jobId === pending.requestKey) && <button type="button" disabled={busy} onClick={() => { setPending(null); setPaid(false); }}>저장된 요청 확인 완료</button>}
    {view.regenerations.length > 0 && <details><summary>개별 생성 이력·비용 ({view.regenerations.length}건)</summary>
      <ul>{view.regenerations.map(j => <li key={j.jobId}>{labels[j.scope]}{j.target ? " 중 답·단서 하나" : ""} · {statuses[j.status] ?? j.status} · {new Date(j.createdAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
        {` · USD ${(j.costMicroUsd / 1_000_000).toFixed(4)}`}{j.unknownCalls > 0 && ` · 사용량 미확인 ${j.unknownCalls}회(비용 0이 아님)`}</li>)}</ul>
    </details>}
  </section>;
}
