import { useEffect, useRef, useState } from "react";
import type { AdminAiCosts } from "../../../shared/api/admin-ai-costs";
import { loadAdminAiCosts } from "./client";
import styles from "./admin-sermon-input.module.css";

const money = (microUsd: number) => `USD ${(microUsd / 1_000_000).toFixed(6)}`;
const count = (value: number | null) => value === null ? "미보고" : value.toLocaleString("ko-KR");
const timestamp = (value: string) => new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", year: "numeric", month: "short", day: "numeric",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
}).format(new Date(value));
const purposes: Record<AdminAiCosts["calls"][number]["purpose"], string> = {
  correction: "자막 교정", intent_analysis: "의도 분석", intent_critique: "비판 검토", summary: "요약",
  child_candidates: "어린이 문제", adult_candidates: "장년 문제", final_audit: "과거 최종 감사",
};
const scopes: Record<AdminAiCosts["calls"][number]["scope"], string> = {
  full: "전체 생성", transcript_correction: "자막 교정", intent: "의도 재생성", summary: "요약 재생성",
  child: "어린이 재생성", adult: "장년 재생성", single_entry: "개별 문제", final_audit: "과거 최종 감사",
};

export function AiCostDetails({ quizSetId, refreshKey = 0 }: { quizSetId: string; refreshKey?: number }) {
  const [data, setData] = useState<AdminAiCosts | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const abort = new AbortController();
    void loadAdminAiCosts(quizSetId, abort.signal).then(result => {
      if (abort.signal.aborted) return;
      if (result.ok) { setData(result.data); setError(""); }
      else { setData(null); setError(result.error.message); }
      setLoading(false);
    });
    return () => abort.abort();
  }, [quizSetId, refreshKey, revision]);
  function refresh() {
    setData(null); setError(""); setLoading(true);
    setRevision(value => value + 1);
  }
  function open() {
    dialog.current?.showModal();
    refresh();
  }
  return <div className={styles.costStrip}>
    <button type="button" className={styles.costButton} onClick={open} aria-haspopup="dialog">
      <span>이번 주 AI 예상 비용</span>
      <strong>{loading && !data ? "확인 중" : data ? money(data.knownCostMicroUsd) : "확인 실패"}</strong>
      {data && <small>이 퀴즈 전체 · 호출 {data.totalCalls}회{data.unknownCalls > 0 ? ` · 사용량 미확인 ${data.unknownCalls}회` : ""}</small>}
    </button>
    {error && <button type="button" onClick={refresh}>비용 다시 확인</button>}
    <dialog ref={dialog} className={styles.costDialog} aria-labelledby="ai-costs-title">
      <div className={styles.costDialogHeader}>
        <div><h2 id="ai-costs-title">이 퀴즈의 AI 호출 비용</h2><p>호출 날짜와 관계없이 선택한 퀴즈에 속한 전체 기록입니다.</p></div>
        <button type="button" onClick={() => dialog.current?.close()}>닫기</button>
      </div>
      {loading && <p role="status">관측 비용 기록을 불러오고 있습니다.</p>}
      {error && <p role="alert">{error} <button type="button" onClick={refresh}>다시 확인</button></p>}
      {data && <>
        <div className={styles.costTotal}>
          <p>관측된 호출 합계 <strong>{money(data.knownCostMicroUsd)}</strong></p>
          <p>전체 {data.totalCalls}회 · 사용량 미확인 {data.unknownCalls}회</p>
          {data.unknownCalls > 0 && <p>미확인 호출의 비용은 합계에 포함되지 않았습니다. 0원이라는 뜻이 아닙니다.</p>}
        </div>
        <p className={styles.helper}>AI API 사용료는 월 USD 0 인프라 운영 목표와 별도입니다. 금액은 공급자 사용량과 호출 당시 저장한 가격표 버전으로 계산한 추정치이며 실제 청구서와 소수점 차이가 날 수 있습니다.</p>
        <h3>모델별 소계</h3>
        {data.models.length === 0 ? <p>아직 AI 호출 기록이 없습니다.</p> : <dl className={styles.costModels}>{data.models.map(group => <div key={`${group.provider}:${group.model}`}>
          <dt>{group.provider} · {group.model}</dt><dd>{money(group.knownCostMicroUsd)} · {group.totalCalls}회{group.unknownCalls > 0 && ` · 사용량 미확인 ${group.unknownCalls}회`}</dd>
        </div>)}</dl>}
        <h3>호출별 기록</h3>
        {data.calls.length === 0 ? <p>표시할 호출이 없습니다.</p> : <ol className={styles.costCalls}>{data.calls.map(call => <li key={call.callId}>
          <div className={styles.costCallHeading}><strong>{call.singleEntry || call.scope === "single_entry" ? "개별 문제" : purposes[call.purpose]}</strong>
            <span>{call.estimatedCostMicroUsd === null ? "사용량 미확인" : money(call.estimatedCostMicroUsd)}</span></div>
          <p>{timestamp(call.startedAt)} (한국 시간) · {call.singleEntry ? `${call.scope === "child" ? "어린이" : "장년"} 한 문제 재생성` : scopes[call.scope]} · {call.provider} · {call.model}</p>
          <dl className={styles.costMetrics}>
            <div><dt>입력 토큰</dt><dd>{count(call.inputTokens)}</dd></div>
            <div><dt>캐시 입력</dt><dd>{count(call.cachedInputTokens)}</dd></div>
            <div><dt>추론 토큰</dt><dd>{count(call.reasoningTokens)}</dd></div>
            <div><dt>출력 토큰</dt><dd>{count(call.outputTokens)}</dd></div>
            {(call.audioInputTokens !== null || call.audioSeconds !== null) && <>
              <div><dt>음성 입력 토큰</dt><dd>{count(call.audioInputTokens)}</dd></div>
              <div><dt>음성 길이</dt><dd>{call.audioSeconds === null ? "미보고" : `${count(call.audioSeconds)}초`}</dd></div>
            </>}
          </dl>
          <p className={styles.costProvenance}>입력 v{call.inputVersion ?? "미기록"} · 설교 정보 v{call.metadataRevision} · 시도 {call.attemptNumber} · 가격표 {call.pricingVersion ?? "사용량 미확인"}
            {call.usageSource === "provider_partial" && " · 공급자 사용량 일부만 보고"}</p>
        </li>)}</ol>}
      </>}
    </dialog>
  </div>;
}
