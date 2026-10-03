import { useAutosave } from "../admin-weekly/useAutosave";
import { ContentRegeneration } from "./ContentRegeneration";
import { ContentPlacement } from "./ContentPlacement";
import { ContentEvidence } from "./ContentEvidence";
import { ContentQuality } from "./ContentQuality";
import type { AdminSermonInputCurrent } from "../../../shared/api/admin-sermon-input";
import type { IntentAnalysis } from "../../../workers/_shared/services/sermon-intent-contract";
import type { ContentQualityRequest } from "../../../shared/api/admin-content-quality";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AdminContentView, AdminContentCommand } from "../../../shared/api/admin-content-generation";
import { loadContentFinalCheck, loadContentGeneration, mutateContentGeneration } from "./client";
import styles from "./admin-sermon-input.module.css";

type Snapshot = AdminContentView["snapshots"][number];
const fields: Record<string, string> = { centralMessage: "중심 메시지", purpose: "설교 목적", bibleRelationship: "본문과의 관계", argumentFlow: "논지 흐름",
  repeatedEmphasis: "반복 강조", illustrations: "예화", audienceResponse: "청중의 응답", warnings: "주의점", uncertainties: "불확실한 부분" };
const stages: Record<string, string> = { input_resolve: "생성 준비", transcript_review: "본문 확인", intent_analysis: "의도 분석 중", intent_critique: "비판 검토 중",
  intent_review: "의도 검수 대기", summary: "요약 생성 중", child_candidates: "어린이 문제 생성 중", adult_candidates: "장년 문제 생성 중", content_review: "내용 검수 대기",
  place_child: "어린이 배치 검사", place_adult: "장년 배치 검사", final_validate: "최종 검사", finish: "최종 검사 완료" };
const usd = (micro: number) => (micro / 1_000_000).toFixed(4);

function SnapshotEditor({ snapshot, view, source, busy, command, quality, confirmIntent, autosave = false, onDirty }: { snapshot: Snapshot; view: AdminContentView; source: AdminSermonInputCurrent; busy: boolean;
  command: (operation: AdminContentCommand["operation"]) => Promise<boolean>; quality: (request: ContentQualityRequest) => Promise<boolean>;
  confirmIntent: (analysisId: string) => void; autosave?: boolean; onDirty?: ((id: string, dirty: boolean) => void) | undefined }) {
  const [draft, setDraft] = useState(() => structuredClone(snapshot));
  const [baseline, setBaseline] = useState(snapshot);
  if (JSON.stringify(baseline) !== JSON.stringify(snapshot)) {
    if (JSON.stringify(draft) === JSON.stringify(baseline)) setDraft(structuredClone(snapshot));
    setBaseline(snapshot);
  }
  const [reviewed, setReviewed] = useState(false);
  const saving = useRef(false);
  const c = view.content.state === "present" ? view.content : null;
  const selected = snapshot.kind === "intent" ? c?.intent?.selectedId === snapshot.value.id : snapshot.kind === "summary"
    ? c?.summary?.id === snapshot.value.id : c?.[snapshot.value.difficulty]?.id === snapshot.value.id;
  const confirmed = snapshot.kind === "intent" ? !!c?.intent?.confirmation : snapshot.kind === "summary" ? !!c?.summary?.review : !!c?.[snapshot.value.difficulty]?.review;
  const replacement = snapshot.kind === "candidate" ? snapshot.value.replacement : undefined;
  const base = replacement ? view.snapshots.find(s => s.kind === "candidate" && s.value.id === replacement.basePoolId) : null;
  const oldCandidate = base?.kind === "candidate" ? base.value.draft.candidates.find(v => v.id === replacement?.candidateId) : null;
  const newCandidate = snapshot.kind === "candidate" ? snapshot.value.draft.candidates.find(v => v.id === replacement?.candidateId) : null;
  const replacementStale = !!replacement && !selected && snapshot.kind === "candidate" && c?.[snapshot.value.difficulty]?.id !== replacement.basePoolId;
  const changed = JSON.stringify(draft) !== JSON.stringify(snapshot);
  useEffect(() => { onDirty?.(snapshot.value.id, changed); return () => onDirty?.(snapshot.value.id, false); }, [snapshot.value.id, changed, onDirty]);
  const binding = snapshot.kind === "intent" ? snapshot.value.binding : snapshot.value.binding.transcript;
  const sourceMatches = binding.sourceId === source.sourceId && binding.revisionId === source.documentId &&
    binding.transcriptSha256 === source.documentSha256 && binding.confirmationId === source.confirmationId;
  const editable = selected && sourceMatches && !busy;
  const title = snapshot.kind === "intent" ? snapshot.value.kind === "analysis" ? "최초 분석" : snapshot.value.kind === "critique" ? "비판 수정본" : "직접 수정한 분석"
    : snapshot.kind === "summary" ? "설교 요약" : snapshot.value.difficulty === "child" ? "어린이 문제" : "장년 문제";
  function editText(group: string, index: number, field: string, text: string) {
    const next = structuredClone(draft);
    if (next.kind === "intent") { const claim = next.value.analysis[group as keyof IntentAnalysis][index]; if (claim) { claim.text = text; if (claim.origin === "transcript") next.value.analysis[group as keyof IntentAnalysis][index] = { id: claim.id, text, origin: "unresolved", evidence: [] }; } }
    else if (next.kind === "summary") next.value.draft.paragraphs[index]!.text = text;
    else { const item = next.value.draft.candidates[index]!; if (field === "clue") item.clue = text;
      else { item.displayAnswer = text; item.gridAnswer = text.normalize("NFC").replace(/\s/gu, ""); } }
    setDraft(next); setReviewed(false);
  }
  function updateIntentClaim(field: string, index: number, claim: IntentAnalysis["centralMessage"][number]) {
    const next = structuredClone(draft);
    if (next.kind !== "intent") return;
    next.value.analysis[field as keyof IntentAnalysis][index] = claim;
    setDraft(next); setReviewed(false);
  }
  function addClaim(field: string) {
    const next = structuredClone(draft);
    if (next.kind !== "intent") return;
    next.value.analysis[field as keyof IntentAnalysis].push({ id: crypto.randomUUID(), text: "", origin: "admin_context", evidence: [] });
    setDraft(next); setReviewed(false);
  }
  function removeClaim(field: string, index: number) {
    const next = structuredClone(draft);
    if (next.kind !== "intent") return;
    next.value.analysis[field as keyof IntentAnalysis].splice(index, 1);
    setDraft(next); setReviewed(false);
  }
  function setEvidence(group: string, index: number, value: Parameters<typeof ContentEvidence>[0]["evidence"]) {
    const next = structuredClone(draft);
    if (next.kind === "intent") {
      const claim = next.value.analysis[group as keyof IntentAnalysis][index];
      if (!claim) return;
      next.value.analysis[group as keyof IntentAnalysis][index] = value.length
        ? { id: claim.id, text: claim.text, origin: "transcript", evidence: value }
        : { id: claim.id, text: claim.text, origin: "unresolved", evidence: [] };
    } else if (next.kind === "summary") next.value.draft.paragraphs[index]!.evidence = value;
    else { const candidate = next.value.draft.candidates[index]!;
      if (candidate.grounding.origin !== "transcript") return;
      candidate.grounding.evidence = value;
    }
    setDraft(next); setReviewed(false);
  }
  function setCandidateNote(index: number, note: string) {
    const next = structuredClone(draft);
    if (next.kind !== "candidate") return;
    next.value.draft.candidates[index]!.grounding = { origin: "admin_context", note };
    setDraft(next); setReviewed(false);
  }
  async function save() {
    if (!changed || !editable || saving.current) return;
    saving.current = true;
    try {
      let saved = false;
      if (draft.kind === "intent") saved = await command({ family: "intent", operation: { kind: "edit", baseAnalysisId: snapshot.value.id, analysis: draft.value.analysis } });
      else {
        const currentBinding = { ...draft.value.binding, transcript: { ...draft.value.binding.transcript, version: view.version } };
        if (draft.kind === "summary") saved = await command({ family: "summary", operation: { kind: "edit", binding: currentBinding, baseSummaryId: snapshot.value.id, draft: draft.value.draft } });
        else saved = await command({ family: "candidate", operation: { kind: "edit", difficulty: draft.value.difficulty, binding: currentBinding, basePoolId: snapshot.value.id, draft: draft.value.draft } });
      }
      if (saved) setDraft(structuredClone(snapshot));
    } finally { saving.current = false; }
  }
  useAutosave(autosave && changed ? JSON.stringify(draft) : null, editable, save);
  const evidence = (items: Parameters<typeof ContentEvidence>[0]["evidence"], group: string, index: number, onEmpty?: () => void) =>
    sourceMatches ? <ContentEvidence label={fields[group] ?? (draft.kind === "summary" ? `요약 문단 ${index + 1}` : `문제 ${index + 1}`)}
      evidence={items} source={source} editable={editable} onChange={next => setEvidence(group, index, next)} {...(onEmpty ? { onEmpty } : {})} />
      : <details><summary>저장 당시 근거 보기</summary>{items.map((item, at) => <blockquote key={at}>{item.quote}</blockquote>)}<p>현재 원문과 연결이 다릅니다. 최신 자료에서 다시 검토해 주세요.</p></details>;
  return <article className={styles.panel} onBlur={event => {
    if (!autosave && changed && editable && !event.currentTarget.contains(event.relatedTarget)) void save();
  }}>
    <div className={styles.sectionHeading}><h4>{title}</h4><span>{selected ? confirmed ? "검수 완료" : "현재 선택됨" : "비교 자료"}</span></div>
    {replacement && oldCandidate && newCandidate && <section aria-label="답·단서 변경 비교">
      <h5>선택한 답·단서 변경 비교</h5>
      <div className={styles.formGrid}><div><strong>기존 값</strong><p>답: {oldCandidate.displayAnswer}</p><p>단서: {oldCandidate.clue}</p></div>
        <div><strong>새 제안</strong><p>답: {newCandidate.displayAnswer}</p><p>단서: {newCandidate.clue}</p></div></div>
      <p className={styles.helper}>나머지 문제와 포함·제외 상태를 보존한 비교본입니다. 채택하지 않으면 기존 선택이 유지됩니다.</p>
      {replacementStale && <p>비교 이후 선택본이 바뀌었습니다. 현재 선택본에서 해당 답·단서를 다시 생성해 주세요.</p>}
    </section>}
    {draft.kind === "intent" && Object.entries(draft.value.analysis).map(([field, claims]) => <section key={field} className={styles.claimGroup}>
      <h5>{fields[field]}</h5>
      {claims.length === 0 && <p className={styles.helper}>아직 작성한 항목이 없습니다.</p>}
      {claims.map((claim, index) => <div key={claim.id} className={styles.claimItem}>
        <label className={styles.field}>내용<textarea value={claim.text} disabled={!editable} onChange={event => editText(field, index, "text", event.currentTarget.value)} /></label>
        <label className={styles.field}>내용 출처<select disabled={!editable} value={claim.origin} onChange={event => {
          const origin = event.currentTarget.value;
          updateIntentClaim(field, index, origin === "admin_context" ? { id: claim.id, text: claim.text, origin: "admin_context", evidence: [] }
            : origin === "unresolved" ? { id: claim.id, text: claim.text, origin: "unresolved", evidence: [] }
              : claim.evidence.length ? { id: claim.id, text: claim.text, origin: "transcript", evidence: claim.evidence }
                : { id: claim.id, text: claim.text, origin: "unresolved", evidence: [] });
        }}><option value="transcript">원문 근거</option><option value="unresolved">근거 확인 필요</option><option value="admin_context">관리자 확인 내용</option></select></label>
        {claim.origin !== "admin_context" && evidence(claim.evidence, field, index, () => setEvidence(field, index, []))}
        {editable && <button type="button" onClick={() => removeClaim(field, index)}>이 항목 삭제</button>}
      </div>)}
      {editable && <button type="button" onClick={() => addClaim(field)}>이 항목 추가</button>}
    </section>)}
    {draft.kind === "intent" && draft.critique && <details><summary>비판 검토의 지적 사항</summary>{Object.values(draft.critique).flatMap(check => check.concerns).map((concern, index) => <p key={index}>{concern.note}</p>)}{Object.values(draft.critique).every(check => check.assessment === "clear") && <p>추가 지적 사항이 없습니다. 내용의 최종 판단은 사람이 합니다.</p>}</details>}
    {draft.kind === "summary" && draft.value.draft.paragraphs.map((paragraph, index) => <div key={paragraph.id} className={styles.claimItem}>
      <label className={styles.field}>요약 문단 {index + 1}<textarea value={paragraph.text} disabled={!editable} onChange={event => editText("", index, "text", event.currentTarget.value)} /></label>
      {evidence(paragraph.evidence, "", index)}
    </div>)}
    {draft.kind === "candidate" && draft.value.draft.candidates.map((item, index) => <div key={item.id} className={styles.claimItem}>
      <label className={styles.field}>답 {index + 1}<input value={item.displayAnswer} disabled={!editable} onChange={event => editText("", index, "answer", event.currentTarget.value)} /></label>
      <label className={styles.field}>단서 {index + 1}<textarea value={item.clue} disabled={!editable} onChange={event => editText("", index, "clue", event.currentTarget.value)} /></label>
      {item.grounding.origin === "transcript" ? evidence(item.grounding.evidence, "", index, () => setCandidateNote(index, ""))
        : <label className={styles.field}>관리자 확인 내용<textarea value={item.grounding.note} disabled={!editable}
          onChange={event => setCandidateNote(index, event.currentTarget.value)} /></label>}
      <label className={styles.field}>배치에 사용할지 선택<select disabled={busy || changed || !selected} value={draft.value.statuses[item.id]} onChange={event => void command({ family: "candidate", operation: { kind: "set_status", difficulty: draft.value.difficulty, poolId: draft.value.id, candidateId: item.id, status: event.currentTarget.value as "use" | "locked" | "excluded" } })}>
        <option value="use">사용</option><option value="locked">반드시 포함</option><option value="excluded">제외</option></select></label>
    </div>)}
    <div className={styles.formGrid}>
      <button type="button" disabled={!editable || !changed} onClick={() => void save()}>{autosave ? "초안 저장 · 새 수정본 만들기" : "수정본 저장"}</button>
      {!selected && <button type="button" disabled={busy || changed || replacementStale} onClick={() => void command(snapshot.kind === "intent" ? { family: "intent", operation: { kind: "select", analysisId: snapshot.value.id } } : snapshot.kind === "summary" ? { family: "summary", operation: { kind: "select", summaryId: snapshot.value.id } } : { family: "candidate", operation: { kind: "select", difficulty: snapshot.value.difficulty, poolId: snapshot.value.id } })}>이 자료 선택</button>}
    </div>
    {selected && <ContentQuality key={view.quality[snapshot.value.id]?.revision ?? 0} snapshot={snapshot} view={view} busy={busy || changed} save={quality} />}
    {selected && !confirmed && (snapshot.kind === "intent"
      ? <><button type="button" disabled={busy || changed || !sourceMatches || !snapshot.value.critiqueId || view.quality[snapshot.value.id]?.status === "regenerate"}
          onClick={() => confirmIntent(snapshot.value.id)}>설교 의도 확정</button>
        {!snapshot.value.critiqueId && <p className={styles.helper}>비판 수정본을 선택하거나 그 수정본을 직접 편집한 뒤 확정해 주세요.</p>}</>
      : <><label className={styles.checkbox}><input type="checkbox" checked={reviewed} disabled={busy || changed} onChange={event => setReviewed(event.currentTarget.checked)} />내용과 원문 근거를 검토했습니다.</label>
        <button type="button" disabled={busy || changed || !reviewed || view.quality[snapshot.value.id]?.status === "regenerate"}
          onClick={() => void command(snapshot.kind === "summary" ? { family: "summary", operation: { kind: "review", summaryId: snapshot.value.id } } : { family: "candidate", operation: { kind: "review", difficulty: snapshot.value.difficulty, poolId: snapshot.value.id } })}>이 내용 검수 완료</button></>)}
  </article>;
}

export function ContentGeneration({ sermonId, inputConfirmed, inputVersion, source, onCostChanged, weeklyStep, onView, onDirtyChange }: { weeklyStep?: number | undefined; onView?: (view: AdminContentView | null) => void; onDirtyChange?: (dirty: boolean) => void; sermonId: string; inputConfirmed: boolean; inputVersion: number; source: AdminSermonInputCurrent; onCostChanged?: () => void }) {
  const [view, setView] = useState<AdminContentView | null>(null), [acting, setBusy] = useState(false), [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true), [loadFailed, setLoadFailed] = useState(false), [costsLoaded, setCostsLoaded] = useState(false);
  useEffect(() => { onView?.(view); }, [view, onView]);
  const [dirtySnapshots, setDirtySnapshots] = useState<Set<string>>(() => new Set());
  const onDirty = useCallback((id: string, dirty: boolean) => setDirtySnapshots(previous => {
    if (previous.has(id) === dirty) return previous;
    const next = new Set(previous); if (dirty) next.add(id); else next.delete(id); return next;
  }), []);
  useEffect(() => { onDirtyChange?.(dirtySnapshots.size > 0); return () => onDirtyChange?.(false); }, [dirtySnapshots, onDirtyChange]);
  const busy = acting || loading || loadFailed;
  const controlBusy = busy || dirtySnapshots.size > 0;
  const viewRequest = useRef<AbortController | null>(null);
  const [newDraft, setNewDraft] = useState(false);
  const [intentDialog, setIntentDialog] = useState<string | null>(null);
  const [paid, setPaid] = useState(false), [sizes, setSizes] = useState({ child: 5, adult: 5 }), [counts, setCounts] = useState({ child: 5, adult: 6 });
  const lock = useRef(false), pending = useRef<{ key: string; body: unknown } | null>(null);
  const finalRequest = useRef<{ jobId: string; requestKey: string } | null>(null);
  const finalCheckAbort = useRef<AbortController | null>(null);
  useEffect(() => () => { finalCheckAbort.current?.abort(); viewRequest.current?.abort(); }, [sermonId]);
  useEffect(() => {
    viewRequest.current?.abort();
    const abort = new AbortController(); viewRequest.current = abort;
    // The parent keys this component by sermon/input/metadata revision.
    void loadContentGeneration(sermonId, abort.signal, undefined, (next, loaded) => {
      if (!abort.signal.aborted) { setView(next); setCostsLoaded(loaded.includes("costs")); }
    }).then(result => {
      if (abort.signal.aborted) return;
      setLoading(false);
      if (result.ok) setView(result.data.data);
      else { setLoadFailed(true); setMessage(result.error.message); }
    });
    return () => abort.abort();
  }, [sermonId, inputVersion]);
  async function refresh(before?: number) {
    viewRequest.current?.abort();
    const abort = new AbortController(); viewRequest.current = abort;
    setLoading(true); setLoadFailed(false); setCostsLoaded(false);
    const result = await loadContentGeneration(sermonId, abort.signal, before, (next, loaded) => {
      if (!abort.signal.aborted) { setView(next); setCostsLoaded(loaded.includes("costs")); }
    });
    if (abort.signal.aborted) return false;
    setLoading(false);
    if (result.ok) { setView(result.data.data); onCostChanged?.(); return true; }
    setLoadFailed(true); setMessage(result.error.message); return false;
  }
  async function act(action: "content" | "regenerate" | "review" | "quality" | "resume" | "discard" | "finish" | "placement-select", body: unknown = {}, jobId = view?.jobId ?? undefined) {
    if (lock.current) return false;
    const operation = body && typeof body === "object" && "operation" in body ? body.operation : null;
    const nested = operation && typeof operation === "object" && "operation" in operation ? operation.operation : null;
    const edit = action === "review" && !!nested && typeof nested === "object" && "kind" in nested && nested.kind === "edit";
    if (weeklyStep !== undefined && dirtySnapshots.size && !edit) { setMessage("편집한 초안의 저장을 먼저 확인해 주세요."); return false; }
    lock.current = true; setBusy(true);
    try {
      if (action === "finish" && jobId) {
        if (finalRequest.current?.jobId !== jobId) finalRequest.current = { jobId, requestKey: crypto.randomUUID() };
        body = { requestKey: finalRequest.current.requestKey };
      }
      const result = await mutateContentGeneration(sermonId, action, body, jobId);
      if (!result.ok) { setMessage(result.error.message); if (action !== "review") await refresh(); return false; }
      let outcome = result.data.data.outcome ?? result.data.data.dispatch;
      if (action === "finish" && outcome === "queued" && jobId && result.data.data.requestKey) {
        finalCheckAbort.current?.abort();
        const abort = new AbortController(); finalCheckAbort.current = abort;
        setMessage("저장된 내용의 배치와 최종 상태를 검사하고 있습니다. AI 비용은 발생하지 않습니다.");
        for (let poll = 0; poll < 30; poll++) {
          const checked = await loadContentFinalCheck(sermonId, jobId, result.data.data.requestKey, abort.signal);
          if (abort.signal.aborted) return false;
          if (!checked.ok) { setMessage(checked.error.message); return false; }
          outcome = checked.data.data.outcome;
          if (outcome !== "queued" && outcome !== "running") break;
          await new Promise(resolve => window.setTimeout(resolve, 2000));
          if (abort.signal.aborted) return false;
        }
        if (outcome === "queued" || outcome === "running") {
          setMessage("검사가 계속 진행 중입니다. 잠시 후 최종 검사 버튼을 누르면 같은 작업의 상태를 다시 확인합니다.");
          return false;
        }
      }
      if (action === "finish") finalRequest.current = null;
      setMessage(action === "discard" && outcome === "saved" ? "기존 의도를 유지하고 비교를 종료했습니다." : outcome === "review_ready" ? "배치와 최종 검사를 완료했습니다. 아래 미리보기를 확인해 주세요." : outcome === "needs_revision" || outcome === "not_ready" ? "배치를 완성하지 못했거나 검수가 남아 있습니다. 문제와 선택 상태를 확인해 주세요." : outcome === "failed" ? "최종 검사를 완료하지 못했습니다. 저장된 자료는 유지됩니다. 상태를 확인해 주세요." : outcome === "uncertain" ? "응답이 확인되지 않았습니다. 추가 요청 전에 상태를 확인해 주세요." : "요청을 반영했습니다. 현재 상태를 확인해 주세요.");
      const refreshed = await refresh();
      return refreshed && (action !== "regenerate" || outcome === "sent" || outcome === "replayed");
    } finally { setBusy(false); lock.current = false; }
  }
  async function start() {
    if (!view?.quizSetId || !paid || !inputConfirmed) return;
    if (!pending.current) {
      const key = crypto.randomUUID(), options = (difficulty: "child" | "adult") => ({ options: { gridSizes: [sizes[difficulty]], targetWordCounts: [counts[difficulty]], seed: key, maxTrials: 64, searchBudgetPerTrial: 10000 }, index: 0 });
      pending.current = { key, body: { requestKey: key, quizSetId: view.quizSetId, expectedVersion: view.version,
        ...(view.recoveredAnalysisId ? { recoveredAnalysisId: view.recoveredAnalysisId, ...(view.recoveredCritiqueId ? { recoveredCritiqueId: view.recoveredCritiqueId } : {}) } :
          view.status === "uncertain" || view.status === "awaiting_intent_review" && c?.intent && view.quality[c.intent.selectedId]?.status === "regenerate" ? { supersedesJobId: view.jobId } : {}),
        selection: { child: options("child"), adult: options("adult") } } };
    }
    await act("content", pending.current.body);
    setNewDraft(false);
  }
  const c = view?.content.state === "present" ? view.content : null;
  const reviewComplete = !!c?.summary?.review && !!c.child?.review && !!c.adult?.review;
  const partialIntentWait = view?.regenerations.find(job => job.scope === "intent" && job.status === "awaiting_intent_review");
  const intentWaitJobId = partialIntentWait?.jobId ?? (view?.status === "awaiting_intent_review" ? view.jobId : null);
  async function confirmAndResume() {
    if (!view || !intentDialog || !intentWaitJobId || !c?.intent || c.intent.selectedId !== intentDialog || lock.current) return;
    if (view.quality[intentDialog]?.status === "regenerate") { setMessage("재생성이 필요하다고 평가한 의도는 확정하거나 재개할 수 없습니다. 새 초안을 명시적으로 요청해 주세요."); setIntentDialog(null); return; }
    if (partialIntentWait && c.intent.rootAnalysisId !== partialIntentWait.analysisId) {
      setMessage("새 의도 비교본을 먼저 선택해 주세요."); setIntentDialog(null); return;
    }
    lock.current = true; setBusy(true);
    try {
      if (!c.intent.confirmation) {
        const confirmed = await mutateContentGeneration(sermonId, "review", { requestKey: crypto.randomUUID(), expectedVersion: view.version,
          operation: { family: "intent", operation: { kind: "confirm", analysisId: intentDialog } } }, view.jobId ?? undefined);
        if (!confirmed.ok) { setMessage(confirmed.error.message); await refresh(); return; }
      }
      if (view.enabled) {
        const resumed = await mutateContentGeneration(sermonId, "resume", {}, intentWaitJobId);
        if (!resumed.ok) { setMessage("의도 확정은 저장됐지만 생성 재개는 확인되지 않았습니다. 상태를 확인한 뒤 명시적으로 다시 진행해 주세요."); await refresh(); return; }
        setMessage(partialIntentWait ? "재확정한 의도를 비교 작업에 반영했습니다. 새 AI 호출은 없습니다."
          : "의도를 확정하고 후속 생성 요청을 보냈습니다. 작업 상태를 확인해 주세요.");
      } else setMessage("의도를 확정했습니다. AI 실행 연결이 활성화된 뒤 생성 재개를 명시적으로 시작할 수 있습니다.");
      await refresh();
    } finally { setBusy(false); lock.current = false; setIntentDialog(null); }
  }
  if (view?.status === "withdrawn") return <section className={styles.panel} aria-label="발행 철회 완료">
    <h3>발행 철회 완료</h3><p>공개를 중단하고 검수 대기로 돌렸습니다. 발행 당시 문제·정답과 최신 제목·설교일은 보존됩니다.</p>
    <a href="/admin/tools#withdraw-title">철회한 퀴즈 검수 자료 확인</a>
  </section>;
  if (view?.publication) return <section className={styles.panel} aria-label="발행 완료">
    <h3>발행 완료</h3><p>발행 시각 {new Date(view.publication.publishedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} (한국 시간)</p>
    <p>마감 시각 {new Date(view.publication.closesAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} (한국 시간)</p>
    <a href={`/quiz/${view.publication.slug}`}>공개된 퀴즈 보기</a>
  </section>;
  return <section hidden={weeklyStep === 1} className={styles.panel} aria-labelledby="content-generation-title" aria-busy={loading}>
    <div className={styles.sectionHeading}><h3 id="content-generation-title">설교 요약·문제 생성</h3><span>{view ? ({ failed: "생성 실패", stale: "입력 변경으로 중단", uncertain: "응답 확인 필요" } as Record<string, string>)[view.status] ?? stages[view.stage] ?? "상태 확인" : "연결 확인 중"}</span></div>
    <div hidden={weeklyStep !== undefined && weeklyStep > 3}>
    <p>{view?.recoveredCritiqueId ? "보관한 분석과 비판 결과를 재사용합니다. 의도를 확정하면 요약·어린이·장년 문제를 이어서 만듭니다." : view?.recoveredAnalysisId ? "보관한 분석을 재사용해 비판 검토부터 이어갑니다. 교정과 의도 분석을 다시 호출하지 않습니다."
      : "의도 분석과 비판 검토 뒤 사람이 확정합니다. 이어서 요약·어린이·장년 문제를 만들고 각각 검수합니다."}</p>
    <p className={styles.helper}>API 사용료는 별도입니다. 입력 10,000·출력 5,000 토큰 가정 시 약 USD 0.08/호출,
      {view?.recoveredCritiqueId ? " 남은 3회 약 USD 0.24입니다." : view?.recoveredAnalysisId ? " 남은 4회 약 USD 0.32입니다." : !view?.jobId || newDraft ? " 전체 5회 약 USD 0.40입니다." : ""} 실제 비용은 분량과 추론량에 따라 달라집니다. 무료 대안으로 직접 수정·검수할 수 있습니다.</p>
    {view && costsLoaded && <p>달력 주간 관측 비용 USD {usd(view.weekCostMicroUsd)} · 현재 생성 작업 USD {usd(view.jobCostMicroUsd)}{view.weekUnknownCalls > 0 && ` · 사용량 미확인 ${view.weekUnknownCalls}회(비용 0이 아님)`}</p>}
    {view && !view.enabled && <p>AI 실행 연결을 아직 활성화하지 않았습니다.</p>}
    {!inputConfirmed && <p>현재 본문을 먼저 확정해 주세요.</p>}
    {view?.jobId && (["review_ready", "failed", "stale", "needs_revision", "uncertain"].includes(view.status) || view.status === "awaiting_intent_review" && !!c?.intent && view.quality[c.intent.selectedId]?.status === "regenerate") && !newDraft && <button type="button" disabled={controlBusy} onClick={() => { pending.current = null; setPaid(false); setNewDraft(true); }}>{view.recoveredAnalysisId ? "보관 분석으로 생성 이어가기" : "기존 자료를 보존하고 새 초안 생성"}</button>}
    {(!view?.jobId || newDraft) && <>
      <div className={styles.formGrid}>{(["child", "adult"] as const).map(d => <div key={d}><label className={styles.field}>{d === "child" ? "어린이" : "장년"} 격자 크기<select value={sizes[d]} onChange={e => setSizes({ ...sizes, [d]: Number(e.currentTarget.value) })}>{[5, 6, 7, 8, 9, 10].map(n => <option key={n} value={n}>{n} × {n}</option>)}</select></label><label className={styles.field}>목표 단어 수<input type="number" min={1} max={100} value={counts[d]} onChange={e => setCounts({ ...counts, [d]: Number(e.currentTarget.value) })} /></label></div>)}</div>
      <label className={styles.checkbox}><input type="checkbox" checked={paid} onChange={e => setPaid(e.currentTarget.checked)} />예상 비용과 무료 대안을 확인하고 생성을 요청합니다.</label>
      <button className="primary-button" type="button" disabled={controlBusy || !view?.enabled || !view.quizSetId || !paid || !inputConfirmed} onClick={() => void start()}>{view?.recoveredCritiqueId ? "보관 결과로 검수 이어가기" : view?.recoveredAnalysisId ? "보관 분석으로 비판 검토 시작" : "분석·비판 검토 시작"}</button>
    </>}
    <button type="button" disabled={acting || loading} onClick={() => void refresh()}>생성 상태 확인</button>
    {view?.jobId && <ContentRegeneration key={view.jobId} view={view} inputConfirmed={inputConfirmed} busy={controlBusy} act={act} />}
    {view?.status === "uncertain" && <p>사용량이나 결과가 확인되지 않아 자동 재호출을 중단했습니다. 이전 비용을 확인해 주세요.</p>}
    {intentWaitJobId && c?.intent?.confirmation && <button type="button" disabled={controlBusy || !view?.enabled || view.quality[c.intent.selectedId]?.status === "regenerate" || !!partialIntentWait && c.intent.rootAnalysisId !== partialIntentWait.analysisId} onClick={() => setIntentDialog(c.intent!.selectedId)}>{partialIntentWait ? "재확정한 의도 반영 완료" : "확정한 의도로 생성 시작"}</button>}
    {view?.stage === "content_review" && <button className="primary-button" type="button" disabled={controlBusy || !reviewComplete} onClick={() => void act("finish")}>배치·최종 검사 (AI 비용 없음)</button>}
    {message && <p role="status">{message}</p>}{acting && <p role="status">요청을 확인하고 있습니다.</p>}
    {loading && <p role="status">상태·비용·내용·배치를 나누어 불러오고 있습니다. 준비된 자료부터 표시합니다.</p>}
    {loadFailed && <p role="alert">일부 자료를 불러오지 못했습니다. 표시된 내용은 유지됩니다. 생성 상태를 다시 확인한 뒤 편집해 주세요.</p>}
    {view?.snapshots.map(snapshot => <div key={weeklyStep === undefined ? `${snapshot.value.id}-${view.version}` : snapshot.value.id} hidden={weeklyStep !== undefined && (weeklyStep === 2 ? snapshot.kind !== "intent" : snapshot.kind === "intent")}><SnapshotEditor snapshot={snapshot} view={view} source={source} busy={busy}
      autosave={weeklyStep !== undefined} onDirty={weeklyStep !== undefined ? onDirty : undefined}
      command={operation => act("review", { requestKey: crypto.randomUUID(), expectedVersion: view.version, operation })}
      quality={request => act("quality", request)} confirmIntent={setIntentDialog} /></div>)}
    {view?.historyCursor && <button type="button" disabled={busy} onClick={() => void refresh(view.historyCursor!)}>이전 생성·수정 자료 보기</button>}
    {intentDialog && <div className={styles.confirmBackdrop}><div className={styles.confirmDialog} role="dialog" aria-modal="true" aria-labelledby="intent-confirm-title">
      <h4 id="intent-confirm-title">설교 의도 확정</h4>
      <p>{partialIntentWait ? "확정하면 새 의도를 비교 작업에 반영합니다. 추가 AI 호출은 없습니다."
        : "확정하면 요약·어린이 문제·장년 문제 생성을 시작합니다."}</p>
      {!partialIntentWait && <p className={styles.helper}>다음 AI 호출 3회, 위 예시 기준 약 USD 0.24입니다. 실제 비용은 사용량에 따라 달라집니다.</p>}
      {!view?.enabled && <p className={styles.helper}>AI 실행 연결이 꺼져 있어 의도 확정만 저장합니다.</p>}
      <div className={styles.evidenceActions}><button type="button" disabled={busy} onClick={() => setIntentDialog(null)}>취소</button>
        <button type="button" className="primary-button" disabled={busy} onClick={() => void confirmAndResume()}>{view?.enabled
          ? partialIntentWait ? "확정하고 비교 반영" : "확정하고 다음 생성 시작" : "의도 확정만 저장"}</button></div>
    </div></div>}
    </div>
    <div hidden={weeklyStep !== undefined && weeklyStep < 4}>
    {view?.jobId && view.placement && <ContentPlacement step={weeklyStep} key={`${view.jobId}-${view.version}-${view.placement.metadataRevision}-${view.placement.revision}`} sermonId={sermonId} view={view} busy={controlBusy} act={act} published={() => void refresh()} />}
    </div>
  </section>;
}
