import { useEffect, useRef, useState } from "react";
import type { AdminGenerationStatus } from "../../../shared/api/admin-generation";
import { loadCorrectionGeneration, startCorrectionGeneration } from "./client";
import styles from "./admin-sermon-input.module.css";

const labels: Record<string, string> = { dispatch_pending: "요청 접수 중", running: "교정 중", review_ready: "교정 문서 준비됨",
  failed: "교정 문서를 만들지 못했습니다", stale: "입력이 변경되어 종료됨", uncertain: "결과 확인 필요", needs_revision: "수정 필요" };

export function CorrectionGeneration({ sermonId, version, onReview, onCostChanged }: {
  sermonId: string; version: number; onReview: (proposalId: string) => Promise<void>; onCostChanged?: () => void;
}) {
  const [availability, setAvailability] = useState<{ enabled: boolean; quizSetId: string | null } | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<AdminGenerationStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [retryAccepted, setRetryAccepted] = useState(false);
  const lock = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const result = await loadCorrectionGeneration(sermonId, undefined, controller.signal);
      if (controller.signal.aborted) return;
      if (!result.ok) { setMessage(result.error.message); return; }
      const data = result.data.data;
      if (!("enabled" in data)) return;
      setAvailability(data);
      setJobId(data.latestJobId);
      if (data.latestJobId) {
        const saved = await loadCorrectionGeneration(sermonId, data.latestJobId, controller.signal);
        if (!controller.signal.aborted && saved.ok && "status" in saved.data.data) setStatus(saved.data.data);
      }
    })();
    return () => controller.abort();
  }, [sermonId]);

  async function refresh(id = jobId) {
    if (!id || lock.current) return;
    lock.current = true; setBusy(true);
    try {
      const result = await loadCorrectionGeneration(sermonId, id);
      if (!result.ok) { setMessage(result.error.message); return; }
      if ("status" in result.data.data) { setStatus(result.data.data); setMessage(""); onCostChanged?.(); }
    } finally { lock.current = false; setBusy(false); }
  }
  const uncertain = status?.status === "uncertain";
  const mayStart = !jobId || status && ["review_ready", "failed", "stale", "needs_revision"].includes(status.status) || uncertain && retryAccepted;
  async function start() {
    if (lock.current || !availability?.enabled || !availability.quizSetId || !mayStart) return;
    lock.current = true; setBusy(true);
    const requestKey = crypto.randomUUID(), supersedesJobId = uncertain ? jobId : null;
    // Keep this identity even if POST times out. Status reads cannot start a call.
    setJobId(requestKey); setStatus(null); setRetryAccepted(false);
    try {
      const result = await startCorrectionGeneration(sermonId, { requestKey, quizSetId: availability.quizSetId,
        expectedInputVersion: version, ...(supersedesJobId ? { supersedesJobId } : {}) });
      setMessage(result.ok ? "교정을 요청했습니다. 상태를 확인한 뒤 문서를 검토해 주세요." : result.error.message);
      if (result.ok) onCostChanged?.();
    } finally { lock.current = false; setBusy(false); }
  }

  return <section className={styles.panel} aria-labelledby="ai-correction-title">
    <div className={styles.sectionHeading}><h3 id="ai-correction-title">AI 자막 교정</h3>
      <span className={styles.needsReview}>{status ? labels[status.status] ?? "상태 확인 필요" : "사람 검토 후 채택"}</span></div>
    <p>현재 자막으로 교정 문서를 만듭니다. API 사용료가 별도로 발생하며, 결과를 검토한 뒤 직접 채택합니다.</p>
    {availability && !availability.enabled && <p className={styles.helper}>AI 실행 연결을 아직 활성화하지 않았습니다.</p>}
    {availability?.enabled && !availability.quizSetId && <p className={styles.helper}>연결된 미발행 퀴즈가 필요합니다.</p>}
    {uncertain && <>
      <p>응답을 확인하지 못했습니다. 기존 호출에 비용이 발생했을 수 있으며 자동으로 다시 실행하지 않습니다.</p>
      <label className={styles.checkbox}><input type="checkbox" checked={retryAccepted} onChange={e => setRetryAccepted(e.currentTarget.checked)} />추가 비용 가능성을 확인하고 새 교정을 요청합니다.</label>
    </>}
    <div className={styles.formGrid}>
      <button className="primary-button" type="button" disabled={busy || !availability?.enabled || !availability.quizSetId || !mayStart} onClick={() => void start()}>
        {uncertain ? "새 요청으로 교정" : "AI 교정 요청"}</button>
      {jobId && <button type="button" disabled={busy} onClick={() => void refresh()}>교정 상태 확인</button>}
      {status?.proposalId && <button type="button" disabled={busy} onClick={() => void onReview(status.proposalId!)}>생성된 교정 문서 검토</button>}
    </div>
    {busy && <p role="status">요청을 확인하고 있습니다.</p>}
    {message && <p role="status">{message}</p>}
    {status && <p className={styles.helper}>
      {status.costStatus === "unknown" ? "사용량 미확인 — 비용이 0이라는 뜻이 아닙니다." : status.costStatus === "not_started" ? "아직 AI 호출을 시작하지 않았습니다." :
        `관측 사용량 기준 예상 비용: USD ${(status.usage.reduce((sum, row) => sum + row.estimatedCostMicroUsd, 0) / 1_000_000).toFixed(6)}`}
    </p>}
  </section>;
}
