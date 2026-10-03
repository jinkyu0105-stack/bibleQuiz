import { useState } from "react";
import type { AdminContentView } from "../../../shared/api/admin-content-generation";
import type { ContentQualityRequest } from "../../../shared/api/admin-content-quality";
import styles from "./admin-sermon-input.module.css";

type Snapshot = AdminContentView["snapshots"][number];
type Criteria = Extract<ContentQualityRequest["criteria"], { centralTheme: string }>;
const criteriaLabels: Record<keyof Criteria, string> = {
  centralTheme: "중심 주제", illustrationDistinction: "예화와 중심 주장 구분", audienceApplication: "청중에게 요청한 적용",
  unsupportedConclusion: "자막에 없는 결론", repeatedEmphasis: "반복 강조 표현",
};
const blank: Criteria = { centralTheme: "not_checked", illustrationDistinction: "not_checked", audienceApplication: "not_checked",
  unsupportedConclusion: "not_checked", repeatedEmphasis: "not_checked" };
const statusLabels = { good: "좋음", edited_then_use: "수정 후 사용", regenerate: "재생성 필요" };

export function ContentQuality({ snapshot, view, busy, save }: { snapshot: Snapshot; view: AdminContentView; busy: boolean;
  save: (request: ContentQualityRequest) => Promise<boolean> }) {
  const prior = view.quality[snapshot.value.id];
  const [status, setStatus] = useState<ContentQualityRequest["status"]>(prior?.status ?? "good");
  const [note, setNote] = useState(prior?.adminNote ?? "");
  const [criteria, setCriteria] = useState<Criteria>(snapshot.kind === "intent" && prior?.criteria && "centralTheme" in prior.criteria
    ? prior.criteria as Criteria : blank);
  const scope = snapshot.kind === "candidate" ? snapshot.value.difficulty : snapshot.kind;
  const editable = snapshot.value.kind === "edit";
  const normalizedNote = note.trim() || null;
  const changed = !prior || prior.status !== status || prior.adminNote !== normalizedNote ||
    JSON.stringify(prior.criteria) !== JSON.stringify(scope === "intent" ? criteria : {});
  return <section className={styles.qualityPanel} aria-label="관리자 품질 평가">
    <h5>품질 평가와 검토 메모</h5>
    <p className={styles.helper}>관리자의 판단 기록입니다. AI가 점수를 매기거나 자동으로 다시 생성하지 않습니다.</p>
    {scope === "intent" && <div className={styles.qualityCriteria}>{(Object.keys(criteriaLabels) as Array<keyof Criteria>).map(key =>
      <label key={key} className={styles.field}>{criteriaLabels[key]}
        <select disabled={busy} value={criteria[key]} onChange={event => setCriteria({ ...criteria, [key]: event.currentTarget.value as Criteria[typeof key] })}>
          <option value="not_checked">아직 확인하지 않음</option><option value="confirmed">근거 확인</option><option value="needs_review">다시 확인 필요</option>
        </select></label>)}</div>}
    <label className={styles.field}>평가
      <select disabled={busy} value={status} onChange={event => setStatus(event.currentTarget.value as ContentQualityRequest["status"])}>
        <option value="good">좋음</option>{editable && <option value="edited_then_use">수정 후 사용</option>}
        <option value="regenerate">재생성 필요</option>
      </select></label>
    <label className={styles.field}>검토 메모 (관리자 전용)
      <textarea rows={3} maxLength={2000} disabled={busy} value={note} onChange={event => setNote(event.currentTarget.value)}
        placeholder="근거가 약한 부분이나 수정 이유를 남길 수 있습니다." /></label>
    <div className={styles.evidenceActions}><button type="button" disabled={busy || !changed || status === "edited_then_use" && !editable}
      onClick={() => void save({ requestKey: crypto.randomUUID(), expectedVersion: view.version, targetSnapshotId: snapshot.value.id,
        scope, status, criteria: scope === "intent" ? criteria : {}, adminNote: normalizedNote })}>평가 저장</button>
      {prior && <span>최근 평가: {statusLabels[prior.status]} · {new Date(prior.createdAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</span>}</div>
    {prior?.status === "regenerate" && <p className={styles.warning}>이 자료는 재생성이 필요하다고 기록했습니다. 같은 자료의 확정·최종 검사·발행은 멈춥니다. {view.status === "awaiting_intent_review" && scope === "intent" ? <>위의 <a href="#content-generation-title">기존 자료를 보존하고 새 초안 생성</a>에서 새 요청을 명시적으로 시작하세요.</> : <><a href="#individual-generation-title">필요한 내용만 다시 생성</a>에서 범위를 선택해 새 요청을 명시적으로 시작하세요.</>}</p>}
  </section>;
}
