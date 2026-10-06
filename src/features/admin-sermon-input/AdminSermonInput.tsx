import { useBlocker, useNavigate, useSearchParams } from "react-router-dom";
import type { AdminContentView } from "../../../shared/api/admin-content-generation";
import { useAutosave } from "../admin-weekly/useAutosave";
import weeklyStyles from "../admin-weekly/weekly.module.css";
import { SermonDrafts } from "./SermonDrafts";
import { AiCostDetails } from "./AiCostDetails";
import type { AdminPublicCaptionImportData } from "../../../shared/api/admin-public-video";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, type FormEvent } from "react";

import type {
  AdminSermonInputCommandRequest,
  AdminSermonInputCorrectionDetail,
  AdminSermonInputCurrent,
  AdminSermonInputHistory,
  AdminSermonInputHistoryEvent,
} from "../../../shared/api/admin-sermon-input";
import {
  commandAdminSermonInput,
  importAdminSermonInput,
  importPublicCaptions,
  loadAdminSermonInput,
  loadAdminSermonInputComparison,
  loadAdminSermonInputCorrection,
  loadAdminSermonInputHistory,
  type AdminSermonInputClientError,
} from "./client";
import { documentSha256, locateUniqueCorrectionTarget, sourceSha256 } from "./correction";
import { createTextDiff, inputContentText, type TextDiffPart } from "./diff";
import styles from "./admin-sermon-input.module.css";
import { ContentGeneration } from "./ContentGeneration";
import { CorrectionGeneration } from "./CorrectionGeneration";

type PublicCaptionState =
  | { state: "idle" | "loading" }
  | { state: "failed"; result: Extract<AdminPublicCaptionImportData, { outcome: "failed" }> }
  | { state: "error"; message: string };

type WorkspaceState =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready"; current: AdminSermonInputCurrent | null; history: AdminSermonInputHistory | null }
  | { state: "error"; error: AdminSermonInputClientError };

type FeedbackState =
  | { state: "idle" }
  | { state: "loading"; message: string }
  | { state: "success"; message: string }
  | { state: "error"; error: AdminSermonInputClientError };

type ComparisonState =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready"; leftId: string; rightId: string; diff: TextDiffPart[] }
  | { state: "error"; error: AdminSermonInputClientError };

type CorrectionState =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready"; detail: AdminSermonInputCorrectionDetail }
  | { state: "error"; error: AdminSermonInputClientError };

const eventLabels: Record<AdminSermonInputHistoryEvent["kind"], string> = {
  source: "원본 등록",
  edit: "직접 수정",
  restore: "복원",
  confirm: "사람 확정",
  proposal: "교정 제안",
  decision: "교정 결정",
  merge: "교정 반영",
};

const sourceLabels: Record<AdminSermonInputCurrent["sourceType"], string> = {
  caption_plain: "붙여넣은 자막",
  caption_timed: "시간 정보가 있는 자막",
  sermon_manuscript: "목사님 제공 설교 원고",
  sermon_summary: "제공받은 설교 요약본",
};

function expectation(current: AdminSermonInputCurrent) {
  return {
    expectedVersion: current.version,
    sourceId: current.sourceId,
    documentId: current.documentId,
    documentSha256: current.documentSha256,
  };
}

function currentMatchesHistory(current: AdminSermonInputCurrent | null, history: AdminSermonInputHistory | null): boolean {
  if (current === null || history === null) return current === null && history === null;
  return current.version === history.head.version &&
    current.sourceType === history.head.sourceType &&
    current.sourceId === history.head.sourceId &&
    current.documentId === history.head.documentId &&
    current.confirmationId === history.head.confirmationId;
}

function displayDate(value: string): string {
  try {
    return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch {
    return value;
  }
}

function Feedback({ feedback }: { feedback: FeedbackState }) {
  if (feedback.state === "idle") return null;
  if (feedback.state === "loading") return <p className={styles.loading} role="status">{feedback.message}</p>;
  if (feedback.state === "success") return <p className={styles.success} role="status">{feedback.message}</p>;
  return <div className={styles.error} role="alert">
    <p>{feedback.error.message}</p>
    {feedback.error.requestId && <p className={styles.requestId}>문의용 번호: {feedback.error.requestId}</p>}
  </div>;
}

function eventOption(event: AdminSermonInputHistoryEvent, currentId: string) {
  return `v${event.version} ${eventLabels[event.kind]}${event.documentId === currentId ? " (현재)" : ""}`;
}

function DiffView({ parts }: { parts: TextDiffPart[] }) {
  return <div className={styles.diff} aria-label="선택한 두 입력자료의 변경 비교">
    {parts.map((part, index) => part.kind === "added"
      ? <ins key={index}>{part.text}</ins>
      : part.kind === "removed"
        ? <del key={index}>{part.text}</del>
        : <span key={index}>{part.text}</span>)}
  </div>;
}

function CurrentPreview({ current }: { current: AdminSermonInputCurrent }) {
  const text = inputContentText(current.content);
  return <section className={styles.currentPreview} aria-labelledby="current-input-title">
    <div className={styles.sectionHeading}>
      <div>
        <p className={styles.kicker}>현재 선택본</p>
        <h3 id="current-input-title">{sourceLabels[current.sourceType]}</h3>
      </div>
      <span className={current.confirmationId ? styles.confirmed : styles.needsReview}>
        {current.confirmationId ? "확정됨" : "확정 필요"}
      </span>
    </div>
    <dl className={styles.metadata}>
      <div><dt>현재 버전</dt><dd>v{current.version}</dd></div>
      <div><dt>자료 범위</dt><dd>{current.source.sourceMode === "public_unofficial" ? "공개 자막" : current.source.sourceCoverage === "full_transcript" ? "전체 자막" : "부분 자료"}</dd></div>
      <div><dt>본문 형식</dt><dd>{current.content.format === "plain_text" ? "일반 텍스트" : `시간 구간 ${current.content.segments.length}개`}</dd></div>
    </dl>
    <details className={styles.contentDisclosure}>
      <summary>현재 본문 확인</summary>
      <pre>{text}</pre>
    </details>
  </section>;
}

export function AdminSermonInput({ initialSermonId = "", quizSetId, weekly = false, onSaved }: { initialSermonId?: string; quizSetId?: string; weekly?: boolean; onSaved?: () => void } = {}) {
  const navigate = useNavigate();
  const [query, setQuery] = useSearchParams();
  const [contentDirty, setContentDirty] = useState(false);
  const onCostQuiz = useCallback((id: string | null) => {
    setCostQuizSetId(id);
    if (weekly && !quizSetId && id) navigate(`/admin/quiz/${id}`, { replace: true });
  }, [weekly, quizSetId, navigate]);
  const [generation, setGeneration] = useState<AdminContentView | null>(null);
  const [metadataVersion, setMetadataVersion] = useState(0);
  const [sermonId, setSermonId] = useState("");
  const [loadedSermonId, setLoadedSermonId] = useState("");
  const [costQuizSetId, setCostQuizSetId] = useState<string | null>(null);
  const [costRefresh, setCostRefresh] = useState(0);
  const [workspace, setWorkspace] = useState<WorkspaceState>({ state: "idle" });
  const [feedback, setFeedback] = useState<FeedbackState>({ state: "idle" });
  const [captionFetch, setCaptionFetch] = useState<PublicCaptionState>({ state: "idle" });
  const [captionCopyMessage, setCaptionCopyMessage] = useState("");

  const [importKind, setImportKind] = useState<"youtube_visible_transcript" | "sermon_manuscript" | "sermon_summary">("youtube_visible_transcript");
  const [importCoverage, setImportCoverage] = useState<"full_transcript" | "partial_notes">("full_transcript");
  const [importText, setImportText] = useState("");

  const current = workspace.state === "ready" ? workspace.current : null;
  const history = workspace.state === "ready" ? workspace.history : null;
  const isCaption = current?.sourceType === "caption_plain" || current?.sourceType === "caption_timed";
  const documentEvents = useMemo(() => history?.events.filter((event) => ["source", "edit", "restore", "merge"].includes(event.kind)) ?? [], [history]);
  const proposalEvents = useMemo(() => history?.events.filter((event) => event.kind === "proposal") ?? [], [history]);

  const [plainEdit, setPlainEdit] = useState("");
  const [timedSegmentIndex, setTimedSegmentIndex] = useState(0);
  const [timedEdits, setTimedEdits] = useState<Record<string, string>>({});
  const [reviewed, setReviewed] = useState(false);
  const [restoreDocumentId, setRestoreDocumentId] = useState("");
  const [leftDocumentId, setLeftDocumentId] = useState("");
  const [rightDocumentId, setRightDocumentId] = useState("");
  const [comparison, setComparison] = useState<ComparisonState>({ state: "idle" });

  const [proposalId, setProposalId] = useState("");
  const [correction, setCorrection] = useState<CorrectionState>({ state: "idle" });
  const correctionHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (correction.state === "ready") correctionHeading.current?.focus();
  }, [correction.state]);
  const [documentText, setDocumentText] = useState("");
  const [documentSegments, setDocumentSegments] = useState<Record<string, string>>({});
  const [decisionDrafts, setDecisionDrafts] = useState<Record<string, "accepted" | "rejected" | "">>({});
  const [originalText, setOriginalText] = useState("");
  const [proposedText, setProposedText] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [changeType, setChangeType] = useState<"recognition" | "spacing" | "spelling" | "punctuation" | "terminology" | "repetition">("recognition");
  const [riskFlags, setRiskFlags] = useState<Array<"biblical_term" | "number" | "negation" | "needs_review">>([]);

  function resetOperationState(nextCurrent: AdminSermonInputCurrent | null, nextHistory: AdminSermonInputHistory | null) {
    setFeedback({ state: "idle" });
    setCaptionFetch({ state: "idle" });
    setCaptionCopyMessage("");
    setComparison({ state: "idle" });
    setCorrection({ state: "idle" });
    setDocumentText("");
    setDocumentSegments({});
    setDecisionDrafts({});
    setReviewed(false);
    setTimedSegmentIndex(0);
    setTimedEdits({});
    setPlainEdit(nextCurrent?.content.format === "plain_text" ? nextCurrent.content.text : "");
    const documents = nextHistory?.events.filter((event) => ["source", "edit", "restore", "merge"].includes(event.kind)) ?? [];
    const sourceDocument = documents.find((event) => event.kind === "source")?.documentId ?? "";
    const selectedDocument = nextCurrent?.documentId ?? "";
    setRestoreDocumentId(documents.find((event) => event.documentId !== selectedDocument)?.documentId ?? "");
    setLeftDocumentId(sourceDocument || selectedDocument);
    setRightDocumentId(selectedDocument);
    setProposalId("");
  }

  async function refreshWorkspace(id = loadedSermonId || sermonId.trim()): Promise<boolean> {
    if (!id) {
      setWorkspace({ state: "error", error: { code: "CLIENT_UNAVAILABLE", message: "설교 작업을 선택해 주세요." } });
      return false;
    }
    setWorkspace({ state: "loading" });
    const [inputResult, historyResult] = await Promise.all([
      loadAdminSermonInput(id),
      loadAdminSermonInputHistory(id),
    ]);
    if (!inputResult.ok) {
      setWorkspace({ state: "error", error: inputResult.error });
      return false;
    }
    if (!historyResult.ok) {
      setWorkspace({ state: "error", error: historyResult.error });
      return false;
    }
    if (!currentMatchesHistory(inputResult.data, historyResult.data)) {
      setWorkspace({ state: "error", error: {
        code: "INPUT_SNAPSHOT_CHANGED",
        message: "입력자료를 불러오는 동안 새 저장이 처리됐습니다. 다시 불러와 주세요.",
      } });
      return false;
    }
    setImportText("");
    setLoadedSermonId(id);
    setSermonId(id);
    setWorkspace({ state: "ready", current: inputResult.data, history: historyResult.data });
    resetOperationState(inputResult.data, historyResult.data);
    return true;
  }

  function submitLoad(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void refreshWorkspace(sermonId.trim());
  }

  async function submitPublicCaptions() {
    if (!loadedSermonId || workspace.state !== "ready" || workspace.current !== null || captionFetch.state === "loading") return;
    setCaptionFetch({ state: "loading" });
    setCaptionCopyMessage("");
    const result = await importPublicCaptions(loadedSermonId);
    if (!result.ok) {
      if (result.error.code === "VIDEO_CONFLICT") await refreshWorkspace();
      setCaptionFetch({ state: "error", message: result.error.message });
      return;
    }
    if (result.data.outcome === "failed") {
      setCaptionFetch({ state: "failed", result: result.data });
      return;
    }
    await refreshWorkspace();
    setFeedback({ state: "success", message: "공개 자막 원본을 저장했습니다. 본문을 읽고 사람이 확정해 주세요." });
  }

  async function copyCaptionDiagnostic(result: Extract<AdminPublicCaptionImportData, { outcome: "failed" }>) {
    try {
      await navigator.clipboard.writeText(JSON.stringify({ code: result.code, diagnostic: result.diagnostic }, null, 2));
      setCaptionCopyMessage("진단 정보를 복사했습니다.");
    } catch { setCaptionCopyMessage("복사하지 못했습니다. 기술 정보를 선택해 복사해 주세요."); }
  }

  async function submitImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (importKind === "youtube_visible_transcript" && [...importText].length > 30_000) {
      setFeedback({ state: "error", error: { code: "INPUT_TOO_LARGE", message: "설교 자막은 공백과 줄바꿈을 포함해 3만 자 이하로 입력해 주세요." } });
      return;
    }
    setFeedback({ state: "loading", message: "최초 입력자료를 저장하고 있습니다." });
    const result = await importAdminSermonInput(loadedSermonId, {
      expectedVersion: 0,
      sourceMode: importKind === "youtube_visible_transcript" ? "manual_paste" : "sermon_notes",
      manualSourceKind: importKind,
      sourceCoverage: importKind === "youtube_visible_transcript" ? importCoverage : "partial_notes",
      rawTranscriptText: importText,
    });
    if (!result.ok) {
      if (result.error.code === "INPUT_CONFLICT") await refreshWorkspace();
      setFeedback({ state: "error", error: result.error });
      return;
    }
    setImportText("");
    await refreshWorkspace();
    setFeedback({ state: "success", message: "최초 입력자료를 저장했습니다." });
  }

  async function runCommand(command: AdminSermonInputCommandRequest, message: string): Promise<boolean> {
    setFeedback({ state: "loading", message: "변경 내용을 저장하고 있습니다." });
    const result = await commandAdminSermonInput(loadedSermonId, command);
    if (!result.ok) {
      if (result.error.code === "INPUT_CONFLICT" && command.action !== "edit") await refreshWorkspace();
      setFeedback({ state: "error", error: result.error });
      return false;
    }
    await refreshWorkspace();
    setFeedback({ state: "success", message });
    onSaved?.();
    return true;
  }

  function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void saveEditedInput();
  }
  async function saveEditedInput() {
    if (!current || !isCaption) return;
    const content = current.content.format === "plain_text"
      ? { format: "plain_text" as const, text: plainEdit }
      : {
          format: "timed_segments" as const,
          segments: current.content.segments.map((segment) => ({
            ...segment,
            text: timedEdits[segment.segmentId] ?? segment.text,
          })),
        };
    return runCommand({ action: "edit", ...expectation(current), content }, "수정본을 새 버전으로 저장했습니다. 이전 본문은 그대로 보존됩니다.");
  }

  function submitConfirm() {
    if (!current || !reviewed) return;
    void runCommand({ action: "confirm", ...expectation(current), reviewed: true }, "현재 입력자료를 사람이 검토하고 확정했습니다.");
  }

  function submitRestore() {
    if (!current || !isCaption || !restoreDocumentId || restoreDocumentId === current.documentId) return;
    void runCommand({ action: "restore", ...expectation(current), restoreDocumentId }, "선택한 과거 본문을 새 버전으로 복원했습니다.");
  }

  async function submitComparison() {
    if (!current || !leftDocumentId || !rightDocumentId) return;
    setComparison({ state: "loading" });
    const result = await loadAdminSermonInputComparison(loadedSermonId, {
      sourceId: current.sourceId,
      leftDocumentId,
      rightDocumentId,
    });
    if (!result.ok) {
      setComparison({ state: "error", error: result.error });
      return;
    }
    // D-031: diff is created only here, after the response contains both selected bodies.
    setComparison({
      state: "ready",
      leftId: result.data.comparison.left.documentId,
      rightId: result.data.comparison.right.documentId,
      diff: createTextDiff(
        inputContentText(result.data.comparison.left.content),
        inputContentText(result.data.comparison.right.content),
      ),
    });
  }

  async function submitManualProposal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current || !isCaption) return;
    const target = locateUniqueCorrectionTarget(current.content, originalText);
    if (!target) {
      setFeedback({ state: "error", error: { code: "CORRECTION_TARGET_AMBIGUOUS", message: "기존 표현이 현재 본문에 정확히 한 번 있는지 확인해 주세요." } });
      return;
    }
    if (originalText === proposedText || correctionReason.trim().length === 0) {
      setFeedback({ state: "error", error: { code: "CORRECTION_INVALID", message: "바꿀 표현과 이유를 확인해 주세요." } });
      return;
    }
    setFeedback({ state: "loading", message: "원본과 현재 본문을 확인한 뒤 교정 제안을 저장하고 있습니다." });
    const selected = await loadAdminSermonInputComparison(loadedSermonId, {
      sourceId: current.sourceId,
      leftDocumentId: current.sourceId,
      rightDocumentId: current.documentId,
    });
    if (!selected.ok) {
      setFeedback({ state: "error", error: selected.error });
      return;
    }
    const [sourceHash, baseHash] = await Promise.all([
      sourceSha256(selected.data.comparison.left.content),
      documentSha256(selected.data.comparison.right.content),
    ]);
    if (baseHash !== current.documentSha256) {
      await refreshWorkspace();
      setFeedback({ state: "error", error: { code: "INPUT_CONFLICT", message: "현재 본문이 바뀌었습니다. 최신 내용을 다시 확인해 주세요." } });
      return;
    }
    const flags = new Set<"biblical_term" | "number" | "negation" | "deletion" | "needs_review">(riskFlags);
    if (proposedText.length < originalText.length) flags.add("deletion");
    const result = await commandAdminSermonInput(loadedSermonId, {
      action: "propose_corrections",
      ...expectation(current),
      proposal: {
        sourceId: current.sourceId,
        sourceSha256: sourceHash,
        baseDocumentId: current.documentId,
        baseDocumentSha256: baseHash,
        items: [{
          id: crypto.randomUUID(),
          ...target,
          originalText,
          proposedText,
          changeType,
          reason: correctionReason.trim(),
          confidence: 1,
          riskFlags: [...flags],
        }],
      },
    });
    if (!result.ok) {
      if (result.error.code === "INPUT_CONFLICT") await refreshWorkspace();
      setFeedback({ state: "error", error: result.error });
      return;
    }
    const newProposalId = result.data.head.eventId;
    setOriginalText("");
    setProposedText("");
    setCorrectionReason("");
    await refreshWorkspace();
    setProposalId(newProposalId);
    setFeedback({ state: "success", message: "수동 교정 제안을 저장했습니다. 내용을 검토한 뒤 적용해 주세요." });
  }

  async function loadCorrectionDetail(selectedProposalId = proposalId) {
    if (!selectedProposalId) return;
    setCorrection({ state: "loading" });
    const result = await loadAdminSermonInputCorrection(loadedSermonId, selectedProposalId);
    if (!result.ok) {
      setCorrection({ state: "error", error: result.error });
      return;
    }
    setDecisionDrafts({});
    if ("kind" in result.data.proposal) {
      const content = result.data.proposal.content;
      setDocumentText(content.format === "plain_text" ? content.text : "");
      setDocumentSegments(content.format === "timed_segments"
        ? Object.fromEntries(content.segments.map((segment) => [segment.segmentId, segment.text])) : {});
    }
    setCorrection({ state: "ready", detail: result.data });
  }

  function decidedItems(detail: AdminSermonInputCorrectionDetail) {
    if (!("decisions" in detail)) return new Map<string, "accepted" | "rejected">();
    return new Map(detail.decisions.flatMap((batch) => batch.decisions.map((decision) => [decision.itemId, decision.decision] as const)));
  }

  function submitDecisions() {
    if (!current || correction.state !== "ready" || "kind" in correction.detail.proposal) return;
    const existing = decidedItems(correction.detail);
    const decisions = correction.detail.proposal.items.flatMap((item) => {
      const decision = decisionDrafts[item.id];
      return existing.has(item.id) || !decision ? [] : [{ itemId: item.id, decision }];
    });
    if (decisions.length === 0) {
      setFeedback({ state: "error", error: { code: "CORRECTION_DECISION_REQUIRED", message: "결정하지 않은 항목에서 사용할지 제외할지 선택해 주세요." } });
      return;
    }
    void runCommand({ action: "decide_corrections", ...expectation(current), proposalId: correction.detail.proposal.proposalId, decisions, reviewed: true }, "선택한 교정 결정을 저장했습니다.");
  }

  function submitMerge() {
    if (!current || correction.state !== "ready" || "kind" in correction.detail.proposal) return;
    void runCommand({ action: "merge_corrections", ...expectation(current), proposalId: correction.detail.proposal.proposalId }, "수락한 교정을 새 본문 버전으로 반영했습니다.");
  }

  function submitDocumentApply() {
    if (!current || correction.state !== "ready" || !("kind" in correction.detail.proposal)) return;
    const proposal = correction.detail.proposal;
    const content = proposal.content.format === "plain_text"
      ? { format: "plain_text" as const, text: documentText }
      : { format: "timed_segments" as const, segments: proposal.content.segments.map((segment) => ({
        ...segment, text: documentSegments[segment.segmentId] ?? segment.text,
      })) };
    void runCommand({ action: "apply_correction_document", ...expectation(current), proposalId: proposal.proposalId,
      reviewed: true, content }, "검토한 교정 문서를 새 자막 작업본으로 저장했습니다. 자막 확정은 별도로 진행해 주세요.");
  }

  const initialLoad = useEffectEvent(() => { void refreshWorkspace(initialSermonId); });
  useEffect(() => { let active = true; if (initialSermonId) queueMicrotask(() => { if (active) initialLoad(); }); return () => { active = false; }; }, [initialSermonId]);
  const editedContent = current?.content.format === "plain_text" ? plainEdit : JSON.stringify(timedEdits);
  const changedInput = !!current && !!isCaption && (current.content.format === "plain_text" ? plainEdit !== current.content.text
    : current.content.segments.some(segment => timedEdits[segment.segmentId] !== undefined && timedEdits[segment.segmentId] !== segment.text));
  useAutosave(weekly && changedInput ? `${current?.version}/${editedContent}` : null,
    workspace.state === "ready" && feedback.state !== "loading", saveEditedInput);
  const blocker = useBlocker(weekly && (changedInput || contentDirty || feedback.state === "loading"));
  const c = generation?.content.state === "present" ? generation.content : null;
  const contentReady = !!c?.summary?.review && !!c?.child?.review && !!c?.adult?.review;
  const available = [true, !!current?.confirmationId, !!c?.intent?.confirmation, contentReady, !!generation?.preview, !!generation?.preview];
  const recommended = generation?.preview ? 5 : contentReady ? 4 : c?.intent?.confirmation ? 3 : current?.confirmationId ? 2 : 1;
  const requestedStep = Number(query.get("step"));
  const step = requestedStep >= 1 && requestedStep <= 6 && available[requestedStep - 1] ? requestedStep : recommended;
  const stepNames = ["설교 영상", "설교 의도", "요약과 문제", "격자 배치", "최종 확인", "발행"];
  const reasons = ["", "입력자료 사람 확정 필요", "설교 의도 확정 필요", "요약·두 난도 검수 필요", "두 격자 최종 검사 필요", "최종 검사 통과 필요"];
  function selectStep(next: number) {
    if (changedInput || contentDirty || feedback.state === "loading") { setFeedback({state:"error",error:{code:"SAVE_REQUIRED",message:"편집한 초안의 저장을 먼저 확인해 주세요."}}); return; }
    setQuery({step:String(next)});
  }
  const reviewStatus = generation ? ({ awaiting_intent_review: "의도 검수 대기", awaiting_content_review: "내용 검수 대기", review_ready: "최종 검사 완료", failed: "생성 실패: 결과 확인 필요", stale: "입력 변경: 다시 확인 필요", uncertain: "응답 확인 필요", running: "생성 진행 중" } as Record<string, string>)[generation.status] : null;
  const selectedIntent = generation?.snapshots.find(snapshot => snapshot.kind === "intent" && snapshot.value.id === c?.intent?.selectedId);
  const selectionLabel = selectedIntent?.kind === "intent" ? selectedIntent.value.kind === "analysis" ? "최초 분석" : selectedIntent.value.kind === "critique" ? "비판 수정본" : "직접 수정한 분석" : null;
  const currentTimedSegment = current?.content.format === "timed_segments" ? current.content.segments[timedSegmentIndex] : undefined;

  return <section className={`${styles.page} ${weekly ? styles.weeklyPage : ""}`} aria-labelledby="sermon-input-title">
    <header className={styles.hero}>
      <div>
        {!weekly && <p className={styles.kicker}>현재 관리자 작업</p>}
        {weekly && reviewStatus && <p className={styles.workStatus} role="status">{reviewStatus}{step === 2 && selectionLabel ? ` · 현재 선택: ${selectionLabel}` : ""}</p>}
        <h2 id="sermon-input-title">{weekly ? stepNames[step - 1] : "설교 입력자료 검토"}</h2>
        <p>{weekly ? ["영상과 본문을 확인하고 자막을 확정해 주세요.", "현재 선택한 분석과 원문 근거를 확인해 주세요.", "요약과 두 난도의 문제를 각각 검토해 주세요.", "격자 크기와 문제 수를 골라 무료로 배치를 비교하세요.", "공개할 내용과 두 난도 격자를 확인해 주세요.", "공개 범위를 확인한 뒤 발행해 주세요."][step - 1] : "현재 본문을 확인하고 수정, 비교, 복원, 교정, 사람 확정을 한 화면에서 이어갑니다."}</p>
      </div>
      {!weekly && <ol className={styles.steps} aria-label="주간 발행 6단계">
        <li aria-current="step"><span>1</span>입력자료 <small>현재</small></li>
        <li><span>2</span>설교 의도 <small>분석·검수</small></li>
        <li><span>3</span>문제 후보 <small>내용 검수</small></li>
        <li><span>4</span>격자 배치 <small>시험·선택</small></li>
        <li><span>5</span>최종 확인 <small>미리보기</small></li>
        <li><span>6</span>발행 <small>검수 후 발행</small></li>
      </ol>}
      {weekly && (step === 2 && selectedIntent || step === 3) && <a className={styles.reviewJump} href={step === 2 ? `#snapshot-${c?.intent?.selectedId}` : "#review-targets"}>{step === 2 ? "현재 선택본 확인" : "검수할 내용 선택"}</a>}
      {weekly && step < 6 && <button type="button" className="primary-button" disabled={!available[step] || changedInput || contentDirty || feedback.state === "loading"} onClick={() => selectStep(step + 1)}>다음: {stepNames[step]}</button>}
    </header>
    {weekly && <ol className={weeklyStyles.stepper} aria-label="주간 발행 6단계">{stepNames.map((label,index)=><li key={label}><button type="button" disabled={!available[index]} aria-current={step===index+1?"step":undefined} onClick={()=>selectStep(index+1)}><span className={weeklyStyles.stepNumber} aria-hidden="true">{index+1<recommended ? "✓" : index+1}</span><span>{label}</span><small>{!available[index]?reasons[index]:index+1<recommended?"완료 · 수정 가능":step===index+1?"현재 단계":"이동 가능"}</small></button></li>)}</ol>}
    {blocker.state === "blocked" && <div role="alert"><p>저장되지 않은 편집이 있습니다. 이 화면에서 저장을 확인해 주세요.</p><button type="button" onClick={() => blocker.reset()}>작업 계속하기</button><button type="button" onClick={() => blocker.proceed()}>저장하지 않고 이동</button></div>}
    {weekly && <p className={styles.saveGuidance} role="status">{changedInput || contentDirty ? "저장 확인 필요. " : ""}편집은 잠시 멈추면 자동 저장됩니다. 확정·AI 재생성·발행은 직접 실행합니다.</p>}

    {costQuizSetId && <AiCostDetails key={`${costQuizSetId}-${costRefresh}`} quizSetId={costQuizSetId} refreshKey={costRefresh} />}
    <div hidden={weekly && step !== 1}>
    <SermonDrafts selectedId={loadedSermonId} onSelect={refreshWorkspace} onMetadataSaved={() => { setMetadataVersion(v => v + 1); onSaved?.(); }} onCostQuizSetId={onCostQuiz} initialCreating={weekly && !initialSermonId} disabled={workspace.state === "loading" || feedback.state === "loading"} />
    {!weekly && <form className={styles.lookup} onSubmit={submitLoad}>
      <label htmlFor="admin-sermon-id">설교 ID
        <input id="admin-sermon-id" value={sermonId} onChange={(event) => setSermonId(event.currentTarget.value)} autoComplete="off" placeholder="저장된 설교 ID" />
      </label>
      <button className="primary-button" type="submit" disabled={workspace.state === "loading"}>{workspace.state === "loading" ? "불러오는 중" : "입력자료 불러오기"}</button>
      {loadedSermonId && <button type="button" onClick={() => void refreshWorkspace()}>새로고침</button>}
    </form>}

    {workspace.state === "idle" && <p className={styles.empty}>새 설교를 등록하거나 미발행 목록에서 작업을 선택해 주세요. 기존 설교 ID로도 불러올 수 있습니다.</p>}
    {workspace.state === "loading" && <div className={styles.loadingPanel} role="status"><span />입력자료와 이력을 불러오고 있습니다.</div>}
    {workspace.state === "error" && <Feedback feedback={{ state: "error", error: workspace.error }} />}

    {workspace.state === "ready" && workspace.current === null && <>
      <section className={styles.panel} aria-labelledby="public-caption-title">
        <div className={styles.sectionHeading}><h3 id="public-caption-title">공개 자막 가져오기</h3><span className={styles.needsReview}>원본으로 보존</span></div>
        <p>선택한 영상의 공개 한국어 자막을 다시 조회합니다. 가져온 시간 구간과 글자는 원본으로 저장하고, 사람 확인 전에는 생성에 사용하지 않습니다.</p>
        <button type="button" disabled={captionFetch.state === "loading"} onClick={() => void submitPublicCaptions()}>
          {captionFetch.state === "loading" ? "공개 자막 확인 중" : "공개 자막 가져와 원본 저장"}
        </button>
        {captionFetch.state === "failed" && <div className={styles.error} role="alert">
          <p>{captionFetch.result.message} 다시 시도하거나 아래에 텍스트를 직접 붙여넣어 주세요.</p>
          <details><summary>기술 정보</summary><pre>{JSON.stringify({ code: captionFetch.result.code, diagnostic: captionFetch.result.diagnostic }, null, 2)}</pre></details>
          <button type="button" onClick={() => void copyCaptionDiagnostic(captionFetch.result)}>진단 정보 복사</button>
          {captionCopyMessage && <p role="status">{captionCopyMessage}</p>}
        </div>}
        {captionFetch.state === "error" && <p role="alert">{captionFetch.message} 아래에 텍스트를 직접 붙여넣을 수 있습니다.</p>}
      </section>
      <form className={styles.panel} onSubmit={submitImport}>
      <div className={styles.sectionHeading}>
        <div><p className={styles.kicker}>첫 작업</p><h3>최초 입력자료 저장</h3></div>
        <span className={styles.needsReview}>원본으로 보존</span>
      </div>
      <p>처음 저장한 자료는 덮어쓰지 않습니다. 자막 수정은 저장 뒤 새 버전으로 추가됩니다.</p>
      <div className={styles.formGrid}>
        <label>자료 종류
          <select value={importKind} onChange={(event) => {
            const value = event.currentTarget.value as typeof importKind;
            setImportKind(value);
            if (value !== "youtube_visible_transcript") setImportCoverage("partial_notes");
          }}>
            <option value="youtube_visible_transcript">화면에서 복사한 YouTube 자막</option>
            <option value="sermon_manuscript">목사님 제공 설교 원고</option>
            <option value="sermon_summary">제공받은 설교 요약본</option>
          </select>
        </label>
        {importKind === "youtube_visible_transcript" && <label>자료 범위
          <select value={importCoverage} onChange={(event) => setImportCoverage(event.currentTarget.value as typeof importCoverage)}>
            <option value="full_transcript">전체 자막</option>
            <option value="partial_notes">부분 자막</option>
          </select>
        </label>}
      </div>
      <label className={styles.textareaLabel} htmlFor="initial-sermon-input">입력자료 본문
        <textarea id="initial-sermon-input" value={importText} onChange={(event) => setImportText(event.currentTarget.value)} rows={12} aria-describedby="initial-input-help" />
      </label>
      <p id="initial-input-help" className={styles.helper}>{importKind === "youtube_visible_transcript" ? `자막 ${[...importText].length.toLocaleString("ko-KR")} / 30,000자` : "제공받은 원고와 요약본은 받은 내용 그대로 저장하며 이후 수정하지 않습니다."}</p>
      <button className="primary-button" type="submit" disabled={captionFetch.state === "loading"}>최초 원본 저장</button>
      <Feedback feedback={feedback} />
    </form></>}

    {workspace.state === "ready" && current && <>
      <CurrentPreview current={current} />
      <Feedback feedback={feedback} />

      
      {isCaption && <CorrectionGeneration key={loadedSermonId} sermonId={loadedSermonId} version={current.version} onCostChanged={() => { setCostRefresh(v => v + 1); onSaved?.(); }} onReview={async id => {
        if (!await refreshWorkspace()) return;
        setProposalId(id);
        await loadCorrectionDetail(id);
      }} />}

      <div className={styles.actionGrid}>
        <section className={styles.panel} aria-labelledby="confirm-input-title">
          <div className={styles.sectionHeading}><h3 id="confirm-input-title">사람 검토 확정</h3><span className={current.confirmationId ? styles.confirmed : styles.needsReview}>{current.confirmationId ? "완료" : "필요"}</span></div>
          <p>현재 본문을 직접 확인한 기록을 남깁니다. 본문이 바뀌면 다시 확정해야 합니다.</p>
          <label className={styles.checkbox}><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.currentTarget.checked)} />현재 본문을 검토했습니다.</label>
          <button className="primary-button" type="button" disabled={!reviewed || current.confirmationId !== null} onClick={submitConfirm}>{current.confirmationId ? "이미 확정됨" : "현재 본문 확정"}</button>
        </section>

        {isCaption ? <form className={styles.panel} onSubmit={submitEdit}>
          <div className={styles.sectionHeading}><h3>자막 직접 수정</h3><span className={styles.needsReview}>새 버전</span></div>
          {current.content.format === "plain_text" ? <>
            <label className={styles.textareaLabel} htmlFor="caption-edit">수정할 자막
              <textarea id="caption-edit" value={plainEdit} onChange={(event) => setPlainEdit(event.currentTarget.value)} rows={12} />
            </label>
            <p className={styles.helper}>{[...plainEdit].length.toLocaleString("ko-KR")} / 30,000자</p>
          </> : <>
            <label>수정할 시간 구간
              <select value={timedSegmentIndex} onChange={(event) => setTimedSegmentIndex(Number(event.currentTarget.value))}>
                {current.content.segments.map((segment, index) => <option value={index} key={segment.segmentId}>구간 {index + 1} ({segment.start.toFixed(1)}초)</option>)}
              </select>
            </label>
            {currentTimedSegment && <label className={styles.textareaLabel} htmlFor="timed-caption-edit">선택한 구간 자막
              <textarea id="timed-caption-edit" rows={6} value={timedEdits[currentTimedSegment.segmentId] ?? currentTimedSegment.text} onChange={(event) => {
                const value = event.currentTarget.value;
                setTimedEdits((saved) => ({ ...saved, [currentTimedSegment.segmentId]: value }));
              }} />
            </label>}
            <p className={styles.helper}>구간 ID와 시간은 유지하고 글자만 바꿉니다. 수정한 구간 {Object.keys(timedEdits).length}개</p>
          </>}
          <button className="primary-button" type="submit">수정본 저장</button>
        </form> : <section className={styles.readOnlyPanel} aria-labelledby="read-only-title">
          <h3 id="read-only-title">받은 자료 그대로 사용</h3>
          <p>목사님 제공 원고와 요약본은 읽고 확정할 수 있지만 수정, 복원, 교정하지 않습니다.</p>
        </section>}
      </div>

      <section className={styles.panel} aria-labelledby="history-title">
        <div className={styles.sectionHeading}>
          <div><p className={styles.kicker}>본문을 읽지 않는 목록</p><h3 id="history-title">입력자료 이력</h3></div>
          <span>{history?.events.length ?? 0}건</span>
        </div>
        <ol className={styles.timeline}>
          {history?.events.map((event) => <li key={event.eventId} className={event.eventId === history.head.confirmationId ? styles.confirmEvent : undefined}>
            <strong>v{event.version} {eventLabels[event.kind]}</strong>
            <time dateTime={event.createdAt}>{displayDate(event.createdAt)}</time>
            {event.documentId === current.documentId && <span>현재 본문</span>}
          </li>)}
        </ol>

        <div className={styles.historyTools}>
          <section aria-labelledby="compare-title">
            <h4 id="compare-title">두 본문 비교</h4>
            <div className={styles.formGrid}>
              <label>이전 본문
                <select value={leftDocumentId} onChange={(event) => { setLeftDocumentId(event.currentTarget.value); setComparison({ state: "idle" }); }}>
                  {documentEvents.map((event) => <option key={event.eventId} value={event.documentId}>{eventOption(event, current.documentId)}</option>)}
                </select>
              </label>
              <label>다음 본문
                <select value={rightDocumentId} onChange={(event) => { setRightDocumentId(event.currentTarget.value); setComparison({ state: "idle" }); }}>
                  {documentEvents.map((event) => <option key={event.eventId} value={event.documentId}>{eventOption(event, current.documentId)}</option>)}
                </select>
              </label>
            </div>
            <button type="button" onClick={() => void submitComparison()} disabled={!leftDocumentId || !rightDocumentId || comparison.state === "loading"}>{comparison.state === "loading" ? "두 본문 불러오는 중" : "선택한 본문 비교"}</button>
            {comparison.state === "error" && <Feedback feedback={{ state: "error", error: comparison.error }} />}
            {comparison.state === "ready" && <>
              <p className={styles.legend}><span>삭제된 내용</span><span>추가된 내용</span></p>
              <DiffView parts={comparison.diff} />
            </>}
          </section>

          {isCaption && <section aria-labelledby="restore-title">
            <h4 id="restore-title">과거 본문 복원</h4>
            <p>과거 기록을 덮어쓰지 않고 선택한 본문을 새 버전으로 만듭니다.</p>
            <label>복원할 본문
              <select value={restoreDocumentId} onChange={(event) => setRestoreDocumentId(event.currentTarget.value)}>
                <option value="">본문 선택</option>
                {documentEvents.filter((event) => event.documentId !== current.documentId).map((event) => <option key={event.eventId} value={event.documentId}>{eventOption(event, current.documentId)}</option>)}
              </select>
            </label>
            <button type="button" onClick={submitRestore} disabled={!restoreDocumentId}>선택 본문 복원</button>
          </section>}
        </div>
      </section>

      {isCaption && <section className={styles.panel} aria-labelledby="correction-title">
        <div className={styles.sectionHeading}>
          <div><p className={styles.kicker}>선택한 제안만 상세 조회</p><h3 id="correction-title" tabIndex={-1} ref={correctionHeading}>자막 교정 검토</h3></div>
          <span>{proposalEvents.length}개 제안</span>
        </div>

        <details className={styles.proposalCreator}>
          <summary>수동 교정 제안 만들기</summary>
          <form onSubmit={submitManualProposal}>
            <p>현재 본문에서 정확히 한 번 나타나는 표현 하나를 직접 제안으로 등록합니다. 수동 제안에는 AI 사용료가 들지 않습니다.</p>
            <div className={styles.formGrid}>
              <label>기존 표현<input value={originalText} onChange={(event) => setOriginalText(event.currentTarget.value)} /></label>
              <label>바꿀 표현<input value={proposedText} onChange={(event) => setProposedText(event.currentTarget.value)} /></label>
              <label>변경 종류
                <select value={changeType} onChange={(event) => setChangeType(event.currentTarget.value as typeof changeType)}>
                  <option value="recognition">인식 오류</option><option value="spacing">띄어쓰기</option><option value="spelling">맞춤법</option>
                  <option value="punctuation">문장 부호</option><option value="terminology">용어</option><option value="repetition">반복</option>
                </select>
              </label>
              <label>제안 이유<input value={correctionReason} onChange={(event) => setCorrectionReason(event.currentTarget.value)} /></label>
            </div>
            <fieldset className={styles.flags}><legend>주의해서 볼 내용</legend>
              {(["biblical_term", "number", "negation", "needs_review"] as const).map((flag) => <label key={flag}><input type="checkbox" checked={riskFlags.includes(flag)} onChange={(event) => {
                const checked = event.currentTarget.checked;
                setRiskFlags((saved) => checked ? [...saved, flag] : saved.filter((item) => item !== flag));
              }} />{{ biblical_term: "성경 용어", number: "숫자", negation: "부정 표현", needs_review: "추가 확인 필요" }[flag]}</label>)}
            </fieldset>
            <button type="submit">교정 제안 저장</button>
          </form>
        </details>

        <div className={styles.correctionLookup}>
          <label>검토할 교정 제안
            <select value={proposalId} onChange={(event) => { setProposalId(event.currentTarget.value); setCorrection({ state: "idle" }); }}>
              <option value="">제안 선택</option>
              {proposalEvents.map((event) => <option key={event.eventId} value={event.eventId}>v{event.version} 교정 제안</option>)}
            </select>
          </label>
          <button type="button" disabled={!proposalId || correction.state === "loading"} onClick={() => void loadCorrectionDetail()}>{correction.state === "loading" ? "상세 불러오는 중" : "선택 제안 상세 보기"}</button>
        </div>
        {correction.state === "error" && <Feedback feedback={{ state: "error", error: correction.error }} />}
        {correction.state === "ready" && (() => {
          const appliesToCurrent = correction.detail.proposal.baseDocumentId === current.documentId;
          if ("kind" in correction.detail.proposal) {
            const proposal = correction.detail.proposal;
            return <div className={styles.correctionDetail}>
              {!appliesToCurrent && <p className={styles.warning}>이 교정 문서는 과거 본문을 기준으로 합니다. 읽을 수 있지만 현재 본문에는 채택할 수 없습니다.</p>}
              <p>교정된 문서 전체를 읽고 필요한 부분을 고친 뒤 사용하세요. 원본과 시간 정보는 보존되며 자막 확정은 다음 단계입니다.</p>
              {proposal.content.format === "plain_text"
                ? <label className={styles.textareaLabel}>교정 문서<textarea value={documentText} onChange={(event) => setDocumentText(event.currentTarget.value)} rows={14} /></label>
                : <div className={styles.documentSegments}>{proposal.content.segments.map((segment, index) =>
                  <label key={segment.segmentId} className={styles.textareaLabel}>구간 {index + 1} · {segment.start}초
                    <textarea value={documentSegments[segment.segmentId] ?? segment.text}
                      onChange={(event) => setDocumentSegments((values) => ({ ...values, [segment.segmentId]: event.currentTarget.value }))} rows={3} />
                  </label>)}</div>}
              <button className="primary-button" type="button" disabled={!appliesToCurrent || feedback.state === "loading"} onClick={submitDocumentApply}>이 교정본 사용</button>
            </div>;
          }
          const existing = decidedItems(correction.detail);
          const hasAccepted = [...existing.values()].includes("accepted");
          return <div className={styles.correctionDetail}>
            {!appliesToCurrent && <p className={styles.warning}>이 제안은 과거 본문을 기준으로 합니다. 상세 비교는 가능하지만 현재 본문에는 결정하거나 반영할 수 없습니다.</p>}
            <ol>
              {correction.detail.proposal.items.map((item) => {
                const saved = existing.get(item.id);
                return <li key={item.id}>
                  <div className={styles.correctionCopy}><del>{item.originalText}</del><ins>{item.proposedText}</ins></div>
                  <p>{item.reason}</p>
                  {saved ? <strong>{saved === "accepted" ? "사용하기로 결정" : "제외하기로 결정"}</strong> : <label>검토 결정
                    <select value={decisionDrafts[item.id] ?? ""} disabled={!appliesToCurrent} onChange={(event) => {
                      const value = event.currentTarget.value as "accepted" | "rejected" | "";
                      setDecisionDrafts((drafts) => ({ ...drafts, [item.id]: value }));
                    }}>
                      <option value="">결정 안 함</option><option value="accepted">사용</option><option value="rejected">제외</option>
                    </select>
                  </label>}
                </li>;
              })}
            </ol>
            <div className={styles.actions}>
              <button type="button" disabled={!appliesToCurrent} onClick={submitDecisions}>선택한 결정 저장</button>
              <button className="primary-button" type="button" disabled={!appliesToCurrent || !hasAccepted} onClick={submitMerge}>수락한 교정 반영</button>
            </div>
          </div>;
        })()}
      </section>}
    </>}
    </div>
    {workspace.state === "ready" && current && <ContentGeneration key={`content-${loadedSermonId}-${current.version}-${metadataVersion}`} sermonId={loadedSermonId} inputConfirmed={current.confirmationId !== null} inputVersion={current.version} source={current} onCostChanged={() => { setCostRefresh(v => v + 1); onSaved?.(); }} weeklyStep={weekly ? step : undefined} onView={setGeneration} onDirtyChange={setContentDirty} />}
  </section>;
}
