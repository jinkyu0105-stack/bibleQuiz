import { useEffect, useRef, useState } from "react";
import type { AdminSermonInputCurrent } from "../../../shared/api/admin-sermon-input";
import type { IntentAnalysis } from "../../../workers/_shared/services/sermon-intent-contract";
import styles from "./admin-sermon-input.module.css";

type Evidence = Extract<IntentAnalysis["centralMessage"][number], { origin: "transcript" }>["evidence"][number];
type Segment = { segmentId: string | null; text: string; start: number | null; duration: number | null };

export function ContentEvidence({ evidence, source, editable, onChange, onEmpty, label }: {
  evidence: Evidence[]; source: AdminSermonInputCurrent; editable: boolean;
  onChange: (next: Evidence[]) => void; onEmpty?: () => void; label: string;
}) {
  const segments: Segment[] = source.content.format === "plain_text"
    ? [{ segmentId: null, text: source.content.text, start: null, duration: null }]
    : source.content.segments;
  const [segmentIndex, setSegmentIndex] = useState(0);
  const [selected, setSelected] = useState<{ from: number; to: number } | null>(null);
  const [replacing, setReplacing] = useState<number | null>(null);
  const [locating, setLocating] = useState<Evidence | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const sourceRef = useRef<HTMLDetailsElement>(null);
  const segment = segments[segmentIndex] ?? segments[0]!;
  const videoId = source.source.sourceMode === "public_unofficial" ? source.source.videoId : null;
  useEffect(() => {
    if (!locating || locating.locationStatus === "unverified" || !textRef.current || segment.segmentId !== locating.segmentId) return;
    textRef.current.scrollIntoView({ block: "nearest" });
    textRef.current.focus();
    textRef.current.setSelectionRange(locating.from, locating.to);
    setLocating(null);
  }, [locating, segment.segmentId]);
  function locate(item: Evidence) {
    if (item.locationStatus === "unverified") {
      if (sourceRef.current) sourceRef.current.open = true;
      setSelected(null); setLocating(null);
      return;
    }
    const index = segments.findIndex(value => value.segmentId === item.segmentId);
    if (index < 0) return;
    if (sourceRef.current) sourceRef.current.open = true;
    setSegmentIndex(index); setSelected({ from: item.from, to: item.to }); setLocating(item);
  }
  function captureSelection(control: HTMLTextAreaElement) {
    setSelected(control.selectionStart < control.selectionEnd
      ? { from: control.selectionStart, to: control.selectionEnd } : null);
  }
  function saveSelection() {
    if (!editable || !selected || selected.from >= selected.to) return;
    const quote = segment.text.slice(selected.from, selected.to);
    if (!quote.trim()) return;
    const next: Evidence = { segmentId: segment.segmentId, start: segment.start, duration: segment.duration,
      from: selected.from, to: selected.to, quote };
    const updated = [...evidence];
    if (replacing === null) updated.push(next); else updated.splice(replacing, 1, next);
    onChange(updated); setReplacing(null); setSelected(null);
  }
  function remove(index: number) {
    if (!editable) return;
    if (evidence.length === 1 && onEmpty) { onEmpty(); return; }
    if (evidence.length <= 1) return;
    onChange(evidence.filter((_, at) => at !== index)); setReplacing(null);
  }
  return <section className={styles.evidencePanel} aria-label={`${label} 근거 검수`}>
    <h5>{label} 근거</h5>
    {evidence.length === 0 && <p className={styles.helper}>연결된 원문 근거가 없습니다.</p>}
    {evidence.map((item, index) => <div className={styles.evidenceItem} key={`${item.segmentId ?? "plain"}-${item.from}-${item.to}-${index}`}>
      <blockquote>{item.quote}</blockquote>
      {item.locationStatus === "unverified" && <p className={styles.helper}>
        <strong>위치 미확인</strong> · {item.reason === "ambiguous" ? "같은 문구가 여러 곳에 있습니다." : "원문에서 같은 문구를 찾지 못했습니다."}
        {" "}결과는 저장되며 다음 단계로 진행할 수 있습니다.
      </p>}
      <div className={styles.evidenceActions}>
        {item.start !== null && <span>{item.start.toFixed(1)}초</span>}
        {item.locationStatus !== "unverified" && <button type="button" onClick={() => locate(item)}>원문 위치 보기</button>}
        {videoId && item.start !== null && <a href={`https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(item.start)}s`}
          target="_blank" rel="noopener noreferrer">영상 시각 열기</a>}
        {editable && <><button type="button" onClick={() => { setReplacing(index); locate(item); }}>근거 교체</button>
          <button type="button" onClick={() => remove(index)}>근거 삭제</button></>}
      </div>
    </div>)}
    <details ref={sourceRef} className={styles.evidenceSource}><summary>원문에서 근거 구절 선택</summary>
      <div className={styles.sectionHeading}><strong>원문 위치 선택</strong><span>{source.content.format === "timed_segments" ? `구간 ${segmentIndex + 1} / ${segments.length}` : "전체 문서"}</span></div>
      {source.content.format === "timed_segments" && <div className={styles.evidenceActions}>
        <button type="button" disabled={segmentIndex === 0} onClick={() => { setSegmentIndex(segmentIndex - 1); setSelected(null); }}>이전 구간</button>
        <label>구간 번호 <input type="number" min={1} max={segments.length} value={segmentIndex + 1}
          onChange={event => { const n = Number(event.currentTarget.value); if (Number.isInteger(n) && n >= 1 && n <= segments.length) { setSegmentIndex(n - 1); setSelected(null); } }} /></label>
        <button type="button" disabled={segmentIndex === segments.length - 1} onClick={() => { setSegmentIndex(segmentIndex + 1); setSelected(null); }}>다음 구간</button>
        {segment.start !== null && <span>{segment.start.toFixed(1)}초</span>}
      </div>}
      <textarea ref={textRef} readOnly value={segment.text} rows={6} aria-label="선택할 원문"
        onSelect={event => captureSelection(event.currentTarget)}
        onMouseUp={event => captureSelection(event.currentTarget)}
        onKeyUp={event => captureSelection(event.currentTarget)} />
      {editable ? <><p className={styles.helper}>원문에서 정확한 구절을 드래그한 뒤 저장하세요. 시간은 원래 구간을 그대로 사용합니다.</p>
        <button type="button" disabled={!selected || selected.from >= selected.to} onClick={saveSelection}>
          {replacing === null ? "선택한 구절을 근거에 추가" : "선택한 구절로 근거 교체"}</button>
        {replacing !== null && <button type="button" onClick={() => setReplacing(null)}>교체 취소</button>}
        {evidence.length === 1 && !onEmpty && <p className={styles.helper}>이 문단의 마지막 근거는 유지하거나 다른 구절로 교체해야 합니다.</p>}</>
        : <p className={styles.helper}>현재 선택본의 원문과 다르면 이력 보기만 가능합니다. 최신 자료를 선택해 검토하세요.</p>}
    </details>
  </section>;
}
