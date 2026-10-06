import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import { createInputGrid, createInputState } from "../hangul-input/grid";
import { connectNativeInput } from "../hangul-input/native-input";
import type { InputAction, InputNotice } from "../hangul-input/types";
import type { OwnSubmission, SubmissionResult } from "../../../shared/api/submission";
import type { PracticeCheckData } from "../../../shared/api/practice";
import type { RevealedSolution } from "../../../shared/api/solution";
import { browserStorage, discardDrafts, draftKey, inputProgress, loadDraft, saveDraft } from "./draft";
import type { QuizInputView } from "./quiz-view";
import { ParticipationBoard } from "./ParticipationBoard";
import type { ParticipationBoardTarget } from "./participation-board-client";
import { PracticeCheckPanel, PracticeResultSummary } from "./PracticeCheckPanel";
import { ResultComparisonGrids } from "./ResultComparisonGrids";
import type { PracticeCheckTarget } from "./practice-client";
import { SubmissionDeletionControl } from "./SubmissionDeletionControl";
import type { SubmissionDeletionTarget } from "./submission-client";
import { SolutionDisclosure } from "./SolutionDisclosure";
import type { SolutionTarget } from "./solution-client";
import {
  SubmissionPanel,
  SubmissionResultSummary,
  type SubmissionTarget,
} from "./SubmissionPanel";
import styles from "./quiz.module.css";

const latinInputMessage = "영문이 입력됐어요. 한/영 키로 한글로 바꿔 주세요.";

function noticeText(notices: readonly InputNotice[]): string {
  return notices.map((notice) => {
    switch (notice.code) {
      case "COMPOSITION_ACTIVE": return "글자 조합을 마친 뒤 이동하거나 난이도를 바꿔 주세요.";
      case "INVALID_HANGUL_SYLLABLE": return notice.containsLatin
        ? latinInputMessage
        : "완성된 한글만 입력해 주세요. 공백·기호가 있는 입력은 반영하지 않았습니다.";
      case "ENTRY_OVERFLOW": return `이 낱말의 칸을 넘어선 ${notice.omittedCount}글자는 격자에 넣지 않았습니다.`;
      case "ENTRY_END": return "이 낱말의 마지막 칸입니다. 단서를 선택하면 다른 낱말로 이동합니다.";
      case "ENTRY_BOUNDARY": return "이 방향의 낱말 끝입니다.";
      case "NO_CROSSING": return "이 칸은 교차 칸이 아닙니다.";
      case "INVALID_SELECTION": return "입력할 수 있는 칸을 선택해 주세요.";
    }
  }).join(" ");
}

/** iOS only opens its keyboard for a focus change that remains in the touch gesture. */
function preserveNativeTouchFocus(event: ReactPointerEvent<HTMLButtonElement>) {
  if (event.pointerType !== "touch") event.preventDefault();
}

export type SubmissionAccess =
  | { state: "disabled"; message: string }
  | { state: "enabled"; target: SubmissionTarget };

type DeletedOwnSubmission = Extract<OwnSubmission, { status: "deleted" }>;

function sameSolution(left: RevealedSolution, right: RevealedSolution): boolean {
  const leftCells = Object.entries(left.cells).sort(([a], [b]) => a.localeCompare(b));
  const rightCells = Object.entries(right.cells).sort(([a], [b]) => a.localeCompare(b));
  const leftEntries = Object.entries(left.entries).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(right.entries).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(leftCells) === JSON.stringify(rightCells) &&
    JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}

function ArchivedSolutionSummary({
  answers,
}: {
  answers: Readonly<Record<string, string>>;
}) {
  const writtenCount = Object.keys(answers).length;
  return <section className={styles.resultPanel} aria-labelledby="archived-solution-title" aria-live="polite">
    <div>
      <h3 id="archived-solution-title">지난 퀴즈 정답</h3>
      <p>{writtenCount === 0
        ? "작성한 답안이 없습니다. 빈칸과 공식 정답을 비교합니다."
        : `현재 브라우저에 작성한 ${writtenCount}칸과 공식 정답을 비교합니다.`}</p>
      <p className={styles.resultNote}>이 비교는 제출 기록이나 순위로 저장되지 않습니다.</p>
    </div>
  </section>;
}

export function QuizWorkspace({
  deadline,
  initialSubmission,
  participationBoard,
  practiceCheck,
  quiz,
  submission,
  submissionDeletion,
  solutionDisclosure,
}: {
  deadline?: ReactNode;
  initialSubmission?: OwnSubmission;
  participationBoard?: {
    target: ParticipationBoardTarget;
    visibility: "after-submission" | "public";
    printable?: boolean;
  };
  practiceCheck?: PracticeCheckTarget;
  quiz: QuizInputView;
  submission?: SubmissionAccess;
  submissionDeletion?: SubmissionDeletionTarget;
  solutionDisclosure?: {
    policy: "after_submission" | "public";
    target: SolutionTarget;
  };
}) {
  const grid = useMemo(() => createInputGrid(quiz.grid), [quiz.grid]);
  const [loaded] = useState(() => loadDraft(browserStorage(), quiz, grid));
  const [initialInputState] = useState(() => {
    const empty = createInputState(grid);
    if (initialSubmission?.status === "deleted") return empty;
    if (initialSubmission?.status === "submitted") {
      return { ...empty, cellValues: new Map(Object.entries(initialSubmission.answers)) };
    }
    return loaded.state;
  });
  const [state, setState] = useState(initialInputState);
  const [saved, setSaved] = useState<string>(initialSubmission?.status === "deleted" ? "삭제한 제출의 답안은 더 이상 표시하지 않습니다." : loaded.status === "restored" ? "저장한 입력을 불러왔습니다." : loaded.status === "unavailable" ? "이 브라우저에서는 임시 저장을 사용할 수 없습니다." : "입력하면 이 브라우저에 자동 저장합니다.");
  const [discardKeys, setDiscardKeys] = useState(initialSubmission === undefined ? loaded.discardKeys : []);
  const [saveBlocked, setSaveBlocked] = useState(initialSubmission === undefined && (loaded.status === "invalid" || loaded.status === "revision-mismatch"));
  const blockedSave = useRef(saveBlocked);
  const [notice, setNotice] = useState("");
  const [latinNoticeVisible, setLatinNoticeVisible] = useState(false);
  const [confirmation, setConfirmation] = useState(false);
  const [verifiedSubmissionResult, setVerifiedSubmissionResult] = useState<SubmissionResult | null>(initialSubmission?.status === "submitted" ? initialSubmission.result : null);
  const [submissionResult, setSubmissionResult] = useState<SubmissionResult | null>(null);
  const [submittedAnswers, setSubmittedAnswers] = useState<Readonly<Record<string, string>>>(initialSubmission?.status === "submitted" ? initialSubmission.answers : {});
  const [practiceAnswers, setPracticeAnswers] = useState<Readonly<Record<string, string>>>({});
  const [practiceResult, setPracticeResult] = useState<PracticeCheckData | null>(null);
  const [practiceSolution, setPracticeSolution] = useState<RevealedSolution | null>(null);
  const [deletedSubmission, setDeletedSubmission] = useState<DeletedOwnSubmission | null>(initialSubmission?.status === "deleted" ? initialSubmission : null);
  const [large, setLarge] = useState(() => {
    try { return browserStorage()?.getItem("bibleQuiz:largeView") === "true"; } catch { return false; }
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const bridge = useRef<ReturnType<typeof connectNativeInput> | null>(null);
  const nativeTouch = useRef<{ pointerId: number; focused: boolean; startedAt: number; x: number; y: number } | null>(null);

  useEffect(() => {
    if (initialSubmission?.status !== "deleted") return;
    discardDrafts(
      browserStorage(),
      quiz,
      [...new Set([draftKey(quiz), ...loaded.discardKeys])],
    );
  }, [initialSubmission, loaded.discardKeys, quiz]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    let noticeTimer: number | undefined;
    const connection = connectNativeInput(input, grid, initialInputState, (transition) => {
      setState(transition.state);
      setNotice(noticeText(transition.notices));
      window.clearTimeout(noticeTimer);
      const rejectedLatin = transition.notices.some((item) => item.code === "INVALID_HANGUL_SYLLABLE" && item.containsLatin);
      setLatinNoticeVisible(rejectedLatin);
      if (rejectedLatin) noticeTimer = window.setTimeout(() => setLatinNoticeVisible(false), 4000);
      if (!transition.state.isComposing) {
        setConfirmation(false);
        if (!blockedSave.current) setSaved(saveDraft(browserStorage(), quiz, transition.state) ? "이 브라우저에 저장했습니다." : "저장하지 못했습니다. 입력은 현재 화면에 유지됩니다.");
      }
    });
    bridge.current = connection;
    return () => { window.clearTimeout(noticeTimer); connection.destroy(); bridge.current = null; };
  }, [grid, initialInputState, quiz]);

  useEffect(() => {
    function reveal() {
      const input = inputRef.current;
      if (!input || document.activeElement !== input) return;
      const rect = input.getBoundingClientRect();
      const viewport = window.visualViewport;
      const top = (viewport?.offsetTop ?? 0) + 12;
      const bottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight) - 84;
      if (rect.bottom > bottom) window.scrollBy({ top: rect.bottom - bottom, behavior: "instant" });
      else if (rect.top < top) window.scrollBy({ top: rect.top - top, behavior: "instant" });
    }
    let frame = requestAnimationFrame(reveal);
    function scheduleReveal() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(reveal);
    }
    const viewport = window.visualViewport;
    const input = inputRef.current;
    input?.addEventListener("focus", scheduleReveal);
    viewport?.addEventListener("resize", scheduleReveal);
    viewport?.addEventListener("scroll", scheduleReveal);
    window.addEventListener("resize", scheduleReveal);
    return () => {
      cancelAnimationFrame(frame);
      input?.removeEventListener("focus", scheduleReveal);
      viewport?.removeEventListener("resize", scheduleReveal);
      viewport?.removeEventListener("scroll", scheduleReveal);
      window.removeEventListener("resize", scheduleReveal);
    };
  }, [state.activeCell, large]);

  function act(action: InputAction) {
    if (
      verifiedSubmissionResult !== null ||
      practiceResult !== null ||
      practiceSolution !== null ||
      (deletedSubmission !== null && practiceCheck === undefined)
    ) return;
    const transition = bridge.current?.dispatch(action);
    if (transition && !transition.state.isComposing) inputRef.current?.focus({ preventScroll: true });
  }
  function handleDeleted(submission: DeletedOwnSubmission) {
    inputRef.current?.blur();
    const cleared = discardDrafts(
      browserStorage(),
      quiz,
      [...new Set([draftKey(quiz), ...discardKeys])],
    );
    setState(createInputState(grid));
    setSubmittedAnswers({});
    setPracticeAnswers({});
    setPracticeResult(null);
    setPracticeSolution(null);
    setVerifiedSubmissionResult(null);
    setSubmissionResult(null);
    setDeletedSubmission(submission);
    setConfirmation(false);
    setNotice("");
    setDiscardKeys([]);
    blockedSave.current = false;
    setSaveBlocked(false);
    setSaved(cleared
      ? "삭제한 제출과 이 브라우저의 임시 입력을 지웠습니다."
      : "서버 제출은 삭제했지만 이 브라우저의 임시 저장은 지우지 못했습니다.");
  }
  function beginNativeTouch(event: ReactPointerEvent<HTMLInputElement>) {
    if (event.pointerType !== "touch") return;
    nativeTouch.current = {
      pointerId: event.pointerId,
      focused: document.activeElement === event.currentTarget,
      startedAt: event.timeStamp,
      x: event.clientX,
      y: event.clientY,
    };
  }
  function endNativeTouch(event: ReactPointerEvent<HTMLInputElement>) {
    const touch = nativeTouch.current;
    nativeTouch.current = null;
    if (!touch || touch.pointerId !== event.pointerId || !touch.focused) return;
    const distance = Math.hypot(event.clientX - touch.x, event.clientY - touch.y);
    // The first tap belongs to the native keyboard. A later short re-tap keeps
    // the grid's crossing-cell direction command; long press remains owned by
    // the OS even though v1 does not guarantee an iOS edit menu.
    if (event.timeStamp - touch.startedAt < 450 && distance < 10) act({ type: "toggle-direction" });
  }
  const activeEntry = quiz.grid.entries.find((entry) => entry.id === state.activeEntry)!;
  const activeCell = grid.cells.get(state.activeCell)!;
  const activeIds = new Set(grid.entries.get(state.activeEntry)!.cellIds);
  const progress = inputProgress(grid, state);
  const preview = new Map<string, string>();
  if (state.isComposing) {
    const entry = grid.entries.get(state.buffer.entryId)!;
    const graphemes = Array.from(new Intl.Segmenter("ko", { granularity: "grapheme" }).segment(state.compositionText), (part) => part.segment);
    graphemes.forEach((text, index) => {
      const id = entry.cellIds[state.buffer.startIndex + index];
      if (id) preview.set(id, text);
    });
  }
  const directionLabel = state.direction === "across" ? "가로" : "세로";
  const difficultyLabel = quiz.difficulty === "child" ? "어린이용" : "장년용";
  const hasVerifiedSubmission = verifiedSubmissionResult !== null;
  const displayedSolution = submissionResult?.solution ?? practiceResult?.solution ?? practiceSolution;
  const displayedAnswers = submissionResult === null ? practiceAnswers : submittedAnswers;
  const submissionLocked = hasVerifiedSubmission || practiceResult !== null || practiceSolution !== null ||
    (deletedSubmission !== null && practiceCheck === undefined);
  const cellLabel = `${activeCell.row + 1}행 ${activeCell.column + 1}열, ${directionLabel} ${activeEntry.number}번, ${state.cellValues.get(state.activeCell) ?? "빈칸"}`;
  const gridStyle = { "--grid-size": quiz.grid.gridSize } as CSSProperties;
  return (
    <section className={styles.workspace} data-large={large}>
      {latinNoticeVisible && <p className={styles.inputToast} aria-hidden="true" data-testid="latin-input-notice">{latinInputMessage}</p>}
      <div className={styles.tools}>
        <p>{quiz.grid.gridSize} × {quiz.grid.gridSize} 격자 <span>{quiz.grid.entries.length}개 낱말</span></p>
        <button type="button" aria-pressed={large} onClick={() => {
          setLarge(!large);
          try {
            const storage = browserStorage();
            if (!storage) throw new Error("Storage unavailable");
            storage.setItem("bibleQuiz:largeView", String(!large));
          } catch { setNotice("보기 설정은 현재 화면에서만 유지됩니다."); }
        }}>{large ? "기본 보기" : "크게 보기"}</button>
        <details className={styles.help}><summary>입력 안내</summary><p id="input-help">칸을 누르고 한글을 입력하세요. Tab은 다음 칸, Shift+Tab은 이전 칸, 방향키는 옆 칸으로 이동합니다. 교차 칸에서 Enter를 누르거나, 키보드가 열린 모바일에서 같은 칸을 짧게 다시 누르면 가로·세로가 바뀝니다. 화면 아래 방향 전환 버튼도 사용할 수 있습니다. 낱말 끝에서 Tab을 누르면 격자 밖으로 나갑니다. 작은 화면에서는 퍼즐 전체가 보이도록 칸이 줄어듭니다. 칸을 누르기 어렵다면 단서와 이전/다음 버튼을 사용하세요.</p></details>
      </div>
      {discardKeys.length > 0 && <aside className={styles.draftWarning} role="status">
        <p>{loaded.status === "invalid" ? "저장된 입력을 안전하게 읽을 수 없습니다." : "다른 문제 버전의 임시 저장이 있어 적용하지 않았습니다."} {saveBlocked ? "기존 저장을 지우기 전까지 새 입력을 덮어쓰지 않습니다." : "현재 버전의 저장은 복구했습니다. 이전 버전만 지울 수 있습니다."}</p>
        <button type="button" onClick={() => {
          if (discardDrafts(browserStorage(), quiz, discardKeys)) {
            setDiscardKeys([]); blockedSave.current = false; setSaveBlocked(false);
            setSaved(saveDraft(browserStorage(), quiz, bridge.current?.getState() ?? state) ? "기존 저장을 지우고 현재 입력을 저장했습니다." : "저장하지 못했습니다. 입력은 화면에 유지됩니다.");
          } else setNotice("기존 저장을 지우지 못했습니다.");
        }}>기존 임시 저장 지우기</button>
      </aside>}
      {displayedSolution === null ? <div className={styles.columns}>
        <div className={styles.gridPanel}>
          <div className={styles.currentClue} id="current-clue"><strong>{directionLabel} {activeEntry.number}번</strong><span>{activeEntry.clue}</span></div>
          <div className={styles.gridBoundary} data-testid="grid-boundary">
            <div className={styles.gridFrame} style={gridStyle}>
              <div role="grid" aria-label="낱말 퀴즈 격자" aria-rowcount={quiz.grid.gridSize} aria-colcount={quiz.grid.gridSize}>
                {Array.from({ length: quiz.grid.gridSize }, (_, row) => <div role="row" key={row} className={styles.row}>
                  {Array.from({ length: quiz.grid.gridSize }, (_, column) => {
                    const cell = quiz.grid.cells.find((candidate) => candidate.row === row && candidate.column === column);
                    if (!cell) return <div role="gridcell" aria-disabled="true" aria-label={`${row + 1}행 ${column + 1}열, 막힌 칸`} key={column} className={styles.blocked} />;
                    const value = state.cellValues.get(cell.id) ?? "";
                    const memberships = grid.cells.get(cell.id)!.entryIds.map((id) => {
                      const entry = quiz.grid.entries.find((candidate) => candidate.id === id)!;
                      return `${entry.direction === "across" ? "가로" : "세로"} ${entry.number}번`;
                    }).join(", ");
                    const selected = cell.id === state.activeCell;
                    return <button type="button" role="gridcell" tabIndex={-1} key={column} data-cell={cell.id}
                      data-composition-cancel
                      className={styles.cell} data-active={selected && !submissionLocked} data-entry={activeIds.has(cell.id)} data-composing={preview.has(cell.id)}
                      disabled={submissionLocked}
                      aria-selected={selected && !submissionLocked} aria-label={`${row + 1}행 ${column + 1}열, ${memberships}, ${cell.number ? `${cell.number}번 시작, ` : ""}${value || "빈칸"}`}
                      onPointerDown={preserveNativeTouchFocus} onClick={() => act({ type: "select-cell", cellId: cell.id })}>
                      {cell.number !== undefined && <span className={styles.number} aria-hidden="true">{cell.number}</span>}
                      <span aria-hidden="true">{preview.get(cell.id) ?? value}</span>
                      {selected && !submissionLocked && <span className={styles.direction} aria-hidden="true">{state.direction === "across" ? "→" : "↓"}</span>}
                    </button>;
                  })}
                </div>)}
              </div>
              <input ref={inputRef} className={styles.nativeInput} aria-label={`낱말 입력: ${cellLabel}`}
                aria-describedby="current-clue input-status" autoComplete="off" autoCapitalize="off" spellCheck={false} inputMode="text"
                disabled={submissionLocked}
                onPointerDown={beginNativeTouch} onPointerUp={endNativeTouch} onPointerCancel={() => { nativeTouch.current = null; }}
                style={{ left: `calc(${activeCell.column} * var(--cell-size))`, top: `calc(${activeCell.row} * var(--cell-size))` }} />
            </div>
          </div>
          <div className={styles.mobileTools} aria-label="격자 이동">
            <button type="button" disabled={submissionLocked} onPointerDown={preserveNativeTouchFocus} onClick={() => act({ type: "move", step: -1 })}>이전 칸</button>
            <button type="button" disabled={submissionLocked} onPointerDown={preserveNativeTouchFocus} onClick={() => act({ type: "toggle-direction" })}>방향 전환 <span>{directionLabel}</span></button>
            <button type="button" disabled={submissionLocked} onPointerDown={preserveNativeTouchFocus} onClick={() => act({ type: "move", step: 1 })}>다음 칸</button>
          </div>
          <p id="input-status" className={styles.inputStatus} role="status">{notice || (state.isComposing ? "한글을 조합하고 있습니다." : cellLabel)}</p>
        </div>
        <aside className={styles.cluePanel} aria-label="낱말 단서">
          {(["across", "down"] as const).map((direction) => <section key={direction}>
            <h3>{direction === "across" ? "가로" : "세로"} 단서</h3>
            <ol>{quiz.grid.entries.filter((entry) => entry.direction === direction).map((entry) => <li key={entry.id}>
              <button type="button" className={styles.clue} aria-pressed={entry.id === state.activeEntry}
                disabled={submissionLocked}
                onPointerDown={preserveNativeTouchFocus} onClick={() => act({ type: "select-entry", entryId: entry.id })}>
                <strong>{entry.number}</strong><span>{entry.clue}<small>{entry.length}글자</small></span>
              </button>
            </li>)}</ol>
          </section>)}
        </aside>
      </div> : <div className={styles.resultOverview}><div className={styles.resultSummary}>
        {submissionResult !== null ? <>
        <SubmissionResultSummary result={submissionResult} />
        {submissionDeletion && <SubmissionDeletionControl
          difficultyLabel={difficultyLabel}
          onDeleted={handleDeleted}
          target={submissionDeletion}
        />}
      </> : practiceResult !== null ? <PracticeResultSummary
        result={practiceResult}
      /> : practiceSolution !== null ? <ArchivedSolutionSummary
        answers={practiceAnswers}
      /> : null}
      </div><ResultComparisonGrids answers={displayedAnswers} grid={quiz.grid} solution={displayedSolution} /></div>}
      <div className={styles.progressPanel}>
        <div><strong data-testid="progress">{progress.filled} / {progress.total}칸 작성</strong><progress aria-label="작성 진행률" value={progress.filled} max={progress.total} /></div>
        <p role="status" className={styles.saved}>{submissionResult !== null ? "제출한 답안의 채점 결과를 표시하고 있습니다." : hasVerifiedSubmission ? "제출한 답안이 확인되었습니다. 정답보기를 눌러 결과를 복원할 수 있습니다." : practiceResult !== null ? "지난 퀴즈 답안의 채점 결과를 표시하고 있습니다." : practiceSolution !== null ? "현재 답안과 공식 정답을 비교하고 있습니다." : deletedSubmission !== null && practiceCheck === undefined ? saved : saveBlocked ? "기존 저장 확인이 필요합니다. 새 입력은 아직 저장하지 않습니다." : saved}</p>
        {deadline && <p>{deadline}</p>}
      </div>
      {solutionDisclosure !== undefined &&
        (deletedSubmission === null || solutionDisclosure.policy === "public") && <SolutionDisclosure
        available={solutionDisclosure.policy === "public" || hasVerifiedSubmission}
        blockedMessage="답안을 제출한 후 정답을 볼 수 있어요."
        isRevealed={displayedSolution !== null}
        target={solutionDisclosure.target}
        onHide={() => {
          setSubmissionResult(null);
          setPracticeAnswers({});
          setPracticeResult(null);
          setPracticeSolution(null);
        }}
        onReveal={(solution) => {
          if (verifiedSubmissionResult !== null) {
            if (!sameSolution(verifiedSubmissionResult.solution, solution)) return false;
            setSubmissionResult({ ...verifiedSubmissionResult, solution });
          } else {
            setPracticeAnswers(Object.fromEntries(state.cellValues));
            setPracticeResult(null);
            setPracticeSolution(solution);
          }
          return true;
        }}
      />}
      {deletedSubmission !== null && <section className={styles.deletedPanel} aria-labelledby="submission-deleted-title" aria-live="polite">
        <h3 id="submission-deleted-title">제출이 삭제되었습니다</h3>
        <p>이름, 답안과 한줄평을 공개 기록에서 제거했습니다. 이 퀴즈의 {difficultyLabel}에는 다시 제출할 수 없습니다.</p>
        <p className={styles.submittedAt}><time dateTime={deletedSubmission.deletedAt}>{new Intl.DateTimeFormat("ko-KR", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Seoul" }).format(new Date(deletedSubmission.deletedAt))}</time> 삭제</p>
      </section>}
      {displayedSolution !== null ? null : hasVerifiedSubmission ? <section className={styles.confirmPanel} aria-labelledby="confirmed-submission-title">
        <div><h3 id="confirmed-submission-title">제출한 답안이 확인되었습니다</h3><p>정답보기를 누르면 저장된 답안과 공식 정답을 다시 비교합니다.</p></div>
      </section> : practiceCheck !== undefined ? <PracticeCheckPanel
        cells={state.cellValues}
        target={practiceCheck}
        onSuccess={(result, answers) => {
          inputRef.current?.blur();
          setPracticeAnswers(answers);
          setPracticeSolution(null);
          setPracticeResult(result);
        }}
      /> : submission?.state === "enabled" ? <section className={styles.confirmPanel} aria-labelledby="confirm-title">
        <div><h3 id="confirm-title">입력한 내용을 확인해 보세요</h3><p>모르는 칸은 비워 두어도 됩니다. 제출하면 바로 채점 결과와 정답을 확인할 수 있습니다.</p></div>
        <button type="button" className="primary-button" disabled={!progress.canConfirm} onClick={() => setConfirmation(true)}>입력 확인</button>
        {confirmation && <SubmissionPanel cells={state.cellValues} target={submission.target} onSuccess={(result) => {
          const answers = Object.fromEntries(state.cellValues);
          inputRef.current?.blur();
          setSubmittedAnswers(answers);
          setVerifiedSubmissionResult(result);
          setSubmissionResult(result);
        }} />}
      </section> : submission?.state === "disabled" ? <section className={styles.confirmPanel} aria-labelledby="confirm-title">
        <div><h3 id="confirm-title">입력한 내용을 확인해 보세요</h3><p>{submission.message}</p></div>
        <button type="button" className="primary-button" disabled>지금은 제출할 수 없음</button>
      </section> : deletedSubmission !== null ? null : <section className={styles.confirmPanel} aria-labelledby="confirm-title">
        <div><h3 id="confirm-title">입력한 내용을 확인해 보세요</h3><p>모르는 칸은 비워 두어도 됩니다. 이 시험 화면에서는 제출·채점을 하지 않습니다.</p></div>
        <button type="button" className="primary-button" disabled={!progress.canConfirm} onClick={() => setConfirmation(true)}>입력 확인</button>
        {confirmation && <p role="status" className={styles.confirmMessage}>작성 {progress.filled}칸, 빈칸 {progress.remaining}칸입니다. 입력 형식을 확인했습니다. 정답 여부는 검사하지 않았으며 서버로 전송하지 않았습니다.</p>}
      </section>}
      {participationBoard !== undefined &&
        (participationBoard.visibility === "public" || (deletedSubmission === null && hasVerifiedSubmission)) &&
        <ParticipationBoard grid={quiz.grid} target={participationBoard.target} printable={participationBoard.printable ?? true} />}
    </section>
  );
}
