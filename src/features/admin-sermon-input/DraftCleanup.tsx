import { useEffect, useState } from "react";
import { draftCleanupListSchema, type DraftCleanupList } from "../../../shared/api/admin-draft-cleanup";
import styles from "./admin-sermon-input.module.css";
const date = (value: string) => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
const reasons = { active_call: "생성 작업이 끝난 뒤 다시 확인합니다.", publication_missing: "발행 자료의 보존 상태를 확인해야 합니다.",
  activity_unknown: "마지막 저장 시각을 확인할 수 없어 정리를 보류했습니다.",
  unreadable: "자료를 확인하지 못해 정리를 보류했습니다.", expired: "정리 완료. 새 초안에서 시작해 주세요." };
export function DraftCleanup() {
  const [items, setItems] = useState<DraftCleanupList["items"] | null>(null);
  const [error, setError] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/admin/draft-cleanup", { credentials: "same-origin", cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
        if (!response.ok) throw new Error("Unavailable");
        const body = await response.json() as { data?: unknown };
        const data = draftCleanupListSchema.parse(body.data);
        if (!controller.signal.aborted) { setItems(data.items); setError(false); }
      } catch { if (!controller.signal.aborted) setError(true); }
    })();
    return () => controller.abort();
  }, [attempt]);
  return <section className={styles.panel} aria-labelledby="draft-cleanup-title">
    <h2 id="draft-cleanup-title">초안 정리 예정</h2>
    <p>정리 하루 전부터 표시합니다. 발행된 퀴즈·정답·참여 기록과 AI 비용은 보존됩니다.</p>
    {error ? <p role="status">예정 목록을 불러오지 못했습니다. <button type="button" onClick={() => { setError(false); setItems(null); setAttempt(a => a + 1); }}>다시 확인</button></p>
      : items === null ? <p role="status">정리 일정을 확인하고 있습니다.</p>
      : items.length === 0 ? <p>하루 안에 정리할 초안이 없습니다.</p>
      : <ul className={styles.cleanupList}>{items.map(item => <li key={item.sermonId}>
        <strong>{item.title}</strong>{" · "}{item.state === "purged" ? "정리 완료" : item.state === "blocked" ? "정리 보류" : item.state === "due" ? "정리 시각 지남" : "정리 예정"}
        {item.dueAt && <span> · {date(item.dueAt)} (한국 시간)</span>}
        {item.reason && <p>{reasons[item.reason]}</p>}
      </li>)}</ul>}
  </section>;
}
