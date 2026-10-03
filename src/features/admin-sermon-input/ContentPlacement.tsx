import { WinnerSettings } from "../admin-weekly/WinnerSettings";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { AdminContentView } from "../../../shared/api/admin-content-generation";
import type { AdminPlacementLayout, AdminPlacementTrial } from "../../../shared/api/admin-placement";
import type { PublicPuzzleGrid } from "../../../shared/puzzle/types";
import { publishAdminQuiz, trialAdminPlacement } from "./client";
import styles from "./admin-sermon-input.module.css";
import gridStyles from "../quiz/quiz.module.css";

const levels = ["child", "adult"] as const;
type Level = typeof levels[number];
const names = { child: "어린이", adult: "장년" };

export function ReviewGrid({ grid, solution, title }: { grid: PublicPuzzleGrid; solution?: AdminPlacementLayout["solution"]; title: string }) {
  const cells = new Map(grid.cells.map(cell => [`${cell.row}:${cell.column}`, cell]));
  return <figure className={gridStyles.comparisonFigure}><figcaption>{title}</figcaption>
    <div className={gridStyles.comparisonGrid} role="grid" aria-label={title} aria-rowcount={grid.gridSize} aria-colcount={grid.gridSize}
      style={{ "--comparison-grid-size": grid.gridSize } as CSSProperties}>
      {Array.from({ length: grid.gridSize }, (_, row) => <div role="row" className={gridStyles.comparisonRow} key={row}>
        {Array.from({ length: grid.gridSize }, (_, col) => { const cell = cells.get(`${row}:${col}`), answer = cell && solution?.cells[cell.id];
          return <div role="gridcell" key={col} aria-disabled={!cell} className={cell ? gridStyles.comparisonCell : gridStyles.comparisonBlockedCell}
            aria-label={`${row + 1}행 ${col + 1}열, ${cell ? answer ?? "빈칸" : "막힌 칸"}`}>
            {cell?.number !== undefined && <small aria-hidden="true">{cell.number}</small>}<span aria-hidden="true">{answer}</span>
          </div>;
        })}
      </div>)}
    </div>
  </figure>;
}

function LayoutReview({ layout, title, answers, large }: { layout: AdminPlacementLayout; title: string; answers: boolean; large: boolean }) {
  return <div className={styles.layoutReview} data-large={large}>
    <ReviewGrid grid={layout.grid} {...(answers ? { solution: layout.solution } : {})} title={`${title} ${answers ? "정답" : "문제"} 격자`} />
    <div><p>{layout.grid.gridSize} × {layout.grid.gridSize} · 단어 {layout.wordCount}개 · 활성 칸 {layout.activeCellCount}개</p>
      <p>교차 {layout.crossingCellCount}칸 · 두 번 이상 교차하는 답 {layout.multiCrossingWordCount}개</p>
      <p className={styles.helper}>연결·교차·정답 형식 검사 통과</p>
      {layout.warnings?.map(message => <p role="status" className={styles.helper} key={message}>주의: {message}</p>)}
      {(["across", "down"] as const).map(direction => <section key={direction} aria-label={`${title} ${direction === "across" ? "가로" : "세로"} 단서`}>
        <h6>{direction === "across" ? "가로" : "세로"} 단서</h6>
        <dl className={styles.placementClues}>{layout.grid.entries.filter(entry => entry.direction === direction).map(entry => <div key={entry.id}>
          <dt>{entry.number}. {entry.clue} ({entry.length}칸)</dt>
          {answers && <dd>{layout.words.find(w => w.id === entry.id)?.answer} · 교차 {layout.words.find(w => w.id === entry.id)?.crossings}회</dd>}
        </div>)}</dl>
      </section>)}
      <p>배치에서 빠진 후보: {layout.omitted.join(", ") || "없음"}</p><p>관리자가 제외한 후보: {layout.excluded.join(", ") || "없음"}</p>
      {answers && <details><summary>정답 표현 검토</summary>{layout.words.map(w => <p key={w.id}>{w.answer} — {w.phrase}</p>)}</details>}
    </div>
  </div>;
}

export function ContentPlacement({ sermonId, view, busy, act, published, step }: { step?: number | undefined; sermonId: string; view: AdminContentView; busy: boolean;
  act: (action: "placement-select" | "finish", body?: unknown) => Promise<boolean>; published: () => void }) {
  const placement = view.placement!;
  const [options, setOptions] = useState(() => ({ child: structuredClone(placement.selection.child.options), adult: structuredClone(placement.selection.adult.options) }));
  const [trials, setTrials] = useState<Partial<Record<Level, AdminPlacementTrial>>>({});
  const [indices, setIndices] = useState({ child: placement.selection.child.index, adult: placement.selection.adult.index });
  const [trialBusy, setTrialBusy] = useState(false), [message, setMessage] = useState("");
  const [previewTheme,setPreviewTheme] = useState("light");
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [publishedSlug, setPublishedSlug] = useState<string | null>(null);
  const publicationKey = useRef<string | null>(null);
  const [answers, setAnswers] = useState(false), [large, setLarge] = useState(false), [mobile, setMobile] = useState(false);
  const mounted = useRef(true), lock = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const c = view.content.state === "present" ? view.content : null;
  const ready = (view.stage === "content_review" && view.status === "running" || view.stage === "finish" && view.status === "review_ready") && !!c?.summary?.review && !!c.child?.review && !!c.adult?.review && !!c.intent?.confirmation;
  const disabled = busy || trialBusy;
  const basis = { expectedVersion: view.version, expectedMetadataRevision: placement.metadataRevision, expectedSelectionRevision: placement.revision };
  function change(level: Level, next: typeof options.child) {
    setOptions(previous => ({ ...previous, [level]: next }));
    setTrials(previous => ({ ...previous, [level]: undefined })); setMessage("");
  }
  async function trial(level: Level) {
    if (lock.current || !view.jobId) return;
    lock.current = true; setTrialBusy(true); setMessage("");
    setTrials(previous => ({ ...previous, [level]: undefined }));
    try {
      const result = await trialAdminPlacement(sermonId, view.jobId, { ...basis, difficulty: level, options: options[level] });
      if (!mounted.current) return;
      if (result.ok) { setTrials(previous => ({ ...previous, [level]: result.data.data })); setIndices(previous => ({ ...previous, [level]: 0 })); }
      else setMessage(result.error.message);
    } finally { if (mounted.current) setTrialBusy(false); lock.current = false; }
  }
  async function save() {
    if (!trials.child?.layouts[indices.child] || !trials.adult?.layouts[indices.adult]) return;
    const saved = await act("placement-select", { ...basis, requestKey: crypto.randomUUID(), selection: {
      child: { options: trials.child.options, index: indices.child }, adult: { options: trials.adult.options, index: indices.adult } } });
    if (saved && view.stage === "content_review") await act("finish");
  }
  async function copyClues() {
    if (!view.preview) return;
    const text = levels.map(level => `${names[level]}\n${view.preview!.variants[level].entries.map(e => `${e.direction === "across" ? "가로" : "세로"} ${e.number}. ${e.clue} (${e.length}칸)`).join("\n")}`).join("\n\n");
    try { await navigator.clipboard.writeText(text); setMessage("정답을 제외한 두 난이도 단서를 복사했습니다."); }
    catch { setMessage("단서를 복사하지 못했습니다. 화면의 단서 문장을 직접 선택해 복사해 주세요."); }
  }
  async function publish() {
    if (!view.jobId || !view.quizSetId || !view.preview || !placement.current || view.status !== "review_ready" || lock.current) return;
    lock.current = true; setTrialBusy(true); setMessage("");
    publicationKey.current ??= crypto.randomUUID();
    try {
      const result = await publishAdminQuiz(view.quizSetId, { requestKey: publicationKey.current, jobId: view.jobId,
        expectedVersion: view.version, expectedMetadataRevision: placement.metadataRevision,
        expectedSelectionRevision: placement.revision, confirmation: "publish" });
      if (!mounted.current) return;
      if (result.ok) { setPublishedSlug(result.data.data.slug); setConfirmPublish(false); setMessage("발행을 저장했습니다."); published(); }
      else setMessage(`${result.error.message} 같은 요청으로 상태를 확인할 수 있습니다.`);
    } finally { if (mounted.current) setTrialBusy(false); lock.current = false; }
  }
  if (publishedSlug) return <section className={styles.placementSection} aria-label="발행 완료"><h4>발행 완료</h4><a href={`/quiz/${publishedSlug}`}>공개된 퀴즈 보기</a></section>;
  return <section className={styles.placementSection} aria-label="배치 선택·발행 전 검토">
    <div className={styles.previewTools}>
      <label><input type="checkbox" checked={answers} onChange={e => setAnswers(e.currentTarget.checked)} />관리자 정답 보기</label>
      <label><input type="checkbox" checked={large} onChange={e => setLarge(e.currentTarget.checked)} />크게 보기</label>
      <label><input type="checkbox" checked={mobile} onChange={e => setMobile(e.currentTarget.checked)} />모바일 폭으로 보기</label>
      {step !== undefined && <label>색상 미리보기<select value={previewTheme} onChange={e=>setPreviewTheme(e.target.value)}><option value="light">라이트</option><option value="dark">다크</option></select></label>}
    </div>
    <div hidden={step !== undefined && step > 4}>
    <h4>배치 선택·발행 전 검토</h4><p>검수한 후보로 여러 배치를 시험합니다. AI 추가 비용은 없습니다.</p>
    {!ready && <p>요약·어린이·장년 문제의 검수를 모두 완료하면 배치를 시험할 수 있습니다.</p>}
    {levels.map(level => <section key={level} className={styles.placementLevel} aria-label={`${names[level]} 배치 시험`}>
      <h5>{names[level]} 배치</h5>
      <fieldset disabled={disabled || !ready}><legend>시험할 격자 크기 (복수 선택 가능)</legend><div className={styles.previewTools}>
        {[5, 6, 7, 8, 9, 10].map(size => <label key={size}><input type="checkbox" checked={options[level].gridSizes.includes(size)} onChange={e => change(level, { ...options[level], gridSizes: e.currentTarget.checked ? [...options[level].gridSizes, size].sort((a, b) => a - b) : options[level].gridSizes.filter(n => n !== size) })} />{size} × {size}</label>)}
      </div></fieldset>
      <label className={styles.field}>목표 단어 수<input disabled={disabled || !ready} type="number" min={1} max={100} value={options[level].targetWordCounts[0] ?? ""} onChange={e => change(level, { ...options[level], targetWordCounts: [Number(e.currentTarget.value)] })} /></label>
      <p className={styles.helper}>시작 권장: 5×5는 5~7개, 6×6는 6~8개, 7×7는 7~10개, 8×8~10×10은 8~15개. 실제 후보에 따라 달라집니다.</p>
      <button type="button" disabled={disabled || !ready || !options[level].gridSizes.length || !Number.isInteger(options[level].targetWordCounts[0]) || options[level].targetWordCounts[0]! < 1 || options[level].targetWordCounts[0]! > 100} onClick={() => void trial(level)}>{names[level]} 배치 시험</button>
      {trials[level] && <>
        {trials[level].layouts.length === 0 && <p role="status">이 설정에서는 배치를 찾지 못했습니다. 격자 크기·목표 단어 수 또는 후보 상태를 바꿔 다시 시험해 주세요.</p>}
        {trials[level].searchIncomplete && <p>탐색 범위 안의 결과입니다. 가능한 모든 조합을 검사한 것은 아닙니다.</p>}
        {!!trials[level].reasons.length && <details><summary>배치가 어려웠던 이유</summary>{trials[level].reasons.map(reason => <p key={reason}>{reason}</p>)}</details>}
        {!!trials[level].layouts.length && <><label className={styles.field}>비교할 배치<select disabled={disabled} value={indices[level]} onChange={e => { const index = Number(e.currentTarget.value); setIndices(previous => ({ ...previous, [level]: index })); }}>
          {trials[level].layouts.map(layout => <option key={layout.index} value={layout.index}>{layout.index === 0 ? "추천 배치" : `대안 ${layout.index}`} · {layout.grid.gridSize} × {layout.grid.gridSize} · {layout.wordCount}개</option>)}</select></label>
          <div className={styles.previewViewport} data-mobile={mobile} data-preview-theme={step === undefined ? undefined : previewTheme}><LayoutReview layout={trials[level].layouts[indices[level]]!} title={`${names[level]} 시험`} answers={answers} large={large} /></div>
        </>}
      </>}
    </section>)}
    <button type="button" className="primary-button" disabled={disabled || !trials.child?.layouts[indices.child] || !trials.adult?.layouts[indices.adult]} onClick={() => void save()}>선택한 두 배치 저장·검사</button>
    <p className={styles.helper}>저장 전 시험 결과는 현재 선택본을 바꾸지 않습니다. 자료나 후보가 바뀌면 다시 검수하고 시험해 주세요.</p>
    {trialBusy && <p role="status">요청을 처리하고 있습니다.</p>}{message && <p role="status">{message}</p>}
    </div>
    {view.preview && view.reviewLayouts && <section hidden={step === 4} aria-label="최종 검사 미리보기" className={styles.placementLevel}>
      <h4>{placement.selected ? "선택한 배치의 최종 검사 통과" : "기본 배치의 최종 검사 통과"}</h4>
      <h5>{view.preview.metadata.title}</h5><p>설교일 {view.preview.metadata.date} · {view.preview.metadata.bibleReferenceLabel} ({view.preview.metadata.translation})</p>
      <a href={view.preview.metadata.bibleReadingUrl} target="_blank" rel="noreferrer">대한성서공회에서 읽기</a>
      <p className={styles.reviewSummary}>{view.preview.summary.text}</p><p className={styles.helper}>{view.preview.summary.disclosure}</p>
      {levels.map(level => <div className={styles.previewViewport} data-mobile={mobile} data-preview-theme={step === undefined ? undefined : previewTheme} key={level}><LayoutReview layout={view.reviewLayouts![level]} title={names[level]} answers={answers} large={large} /></div>)}
      <button type="button" onClick={() => void copyClues()}>정답 없이 단서 복사</button>
      <p>두 난이도의 현재 입력·내용 검수·연결·교차·정답 일치 검사를 통과했습니다. 아직 발행하지 않았습니다.</p>
      {step === 5 && <ul aria-label="발행 검수표"><li>입력자료·설교 의도 사람 확정</li><li>요약·어린이·장년 문제 검수</li><li>두 난도 격자·연결·교차·정답 검사 통과</li><li>아래 Top N 설정과 공개할 내용을 확인해 주세요.</li></ul>}
      {step === 5 && view.quizSetId && <WinnerSettings quizSetId={view.quizSetId}/>}
      {step !== 5 && view.status === "review_ready" && placement.current && !publishedSlug && <button type="button" className="primary-button" disabled={disabled} onClick={() => setConfirmPublish(true)}>지금 발행</button>}
      {confirmPublish && !publishedSlug && <PublicationConfirmation view={view} disabled={disabled} message={message}
        cancel={() => setConfirmPublish(false)} publish={() => void publish()} />}
      {publishedSlug && <a href={`/quiz/${publishedSlug}`}>공개된 퀴즈 보기</a>}
    </section>}
    {!view.preview && placement.selected && <p role="status">저장한 배치의 바탕 자료가 변경되었습니다. 내용 검수와 배치 선택을 다시 완료해 주세요.</p>}
  </section>;
}

function PublicationConfirmation({ view, disabled, message, cancel, publish }: {
  view: AdminContentView; disabled: boolean; message: string; cancel: () => void; publish: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    dialog.current?.showModal();
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  function dismiss() { dialog.current?.close(); cancel(); }
  const time = (ms: number) => new Date(ms).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  return <dialog ref={dialog} className={styles.publicationDialog} aria-labelledby="publish-title"
    onCancel={e => { e.preventDefault(); if (!disabled) dismiss(); }}>
    <h4 id="publish-title">지금 발행 확인</h4>
    <p>새 퀴즈가 메인에 공개되고 지금 참여가 시작됩니다.</p>
    <p>발행·참여 시작 예상: {time(now)} (한국 시간)<br />기본 마감 예상: {time(now + 7 * 24 * 3600_000)} (한국 시간)</p>
    <p>실제 저장 시각부터 정확히 7일 뒤 마감됩니다. 발행 후 저장된 시각을 확인할 수 있습니다.</p>
    <p>기존 퀴즈의 마감·제출·순위는 유지됩니다. 새 퀴즈는 첫 제출 뒤 정답·격자·채점 버전이 잠깁니다.</p>
    <p>Top N은 이 퀴즈의 저장된 난도별 설정을 사용합니다. 이 퀴즈의 관측 AI 비용 USD {((view.quizCostMicroUsd ?? view.jobCostMicroUsd) / 1_000_000).toFixed(4)}
      {!!(view.quizUnknownCalls ?? view.jobUnknownCalls) && ` · 사용량 미확인 ${view.quizUnknownCalls ?? view.jobUnknownCalls}회(비용 0이 아님)`}</p>
    {message && <p role="status">{message}</p>}
    <div className={styles.previewTools}><button type="button" disabled={disabled} onClick={dismiss}>취소</button>
      <button type="button" className="primary-button" disabled={disabled} onClick={publish}>지금 발행</button></div>
  </dialog>;
}
