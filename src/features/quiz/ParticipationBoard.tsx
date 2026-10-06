import { topNView } from "../../../shared/api/quiz-export";
import { TopNPrintButton } from "../export/TopNPrintButton";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import type {
  ParticipationBoardData,
  ParticipationBoardParticipant,
} from "../../../shared/api/participation-board";
import type { PublicPuzzleGrid } from "../../../shared/puzzle/types";
import {
  readParticipationBoard,
  type ParticipationBoardClientError,
  type ParticipationBoardTarget,
} from "./participation-board-client";
import styles from "./quiz.module.css";

type BoardState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; error: ParticipationBoardClientError }
  | { status: "ready"; data: ParticipationBoardData };

type BoardView = "all" | "top";

// FLIP measures only a user-triggered change of the existing board.
// The DOM switches immediately; leaving copies are decorative and inaccessible.
function useBoardMotion(view: BoardView) {
  const list = useRef<HTMLOListElement>(null);
  const before = useRef<Map<string, DOMRect>>(new Map());
  const active = useRef<Animation[]>([]);
  const ghosts = useRef<HTMLElement[]>([]);

  function stop() {
    active.current.forEach((animation) => animation.cancel());
    active.current = [];
    ghosts.current.forEach((ghost) => ghost.remove());
    ghosts.current = [];
  }

  function capture(nextIds: ReadonlySet<string>) {
    stop();
    before.current.clear();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const container = list.current;
    if (!container) return;
    const bounds = container.getBoundingClientRect();
    for (const card of container.querySelectorAll<HTMLElement>(":scope > li[data-participant]")) {
      const id = card.dataset.participant!;
      const rect = card.getBoundingClientRect();
      before.current.set(id, rect);
      if (nextIds.has(id)) continue;
      const ghost = card.cloneNode(true) as HTMLElement;
      ghost.removeAttribute("data-participant");
      ghost.setAttribute("aria-hidden", "true");
      ghost.inert = true;
      for (const element of [ghost, ...ghost.querySelectorAll<HTMLElement>("*")]) {
        element.removeAttribute("id");
        element.removeAttribute("data-board-cell");
      }
      Object.assign(ghost.style, {
        position: "absolute", top: `${rect.top - bounds.top}px`, left: `${rect.left - bounds.left}px`,
        width: `${rect.width}px`, pointerEvents: "none", listStyle: "none", zIndex: "1",
      });
      container.append(ghost);
      ghosts.current.push(ghost);
      const animation = ghost.animate([{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(.96)" }], { duration: 140, fill: "forwards" });
      animation.onfinish = () => ghost.remove();
      active.current.push(animation);
    }
  }

  useLayoutEffect(() => {
    const container = list.current;
    if (!container || before.current.size === 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { stop(); before.current.clear(); return; }
    for (const card of container.querySelectorAll<HTMLElement>(":scope > li[data-participant]")) {
      const old = before.current.get(card.dataset.participant!);
      const rect = card.getBoundingClientRect();
      const frames = old
        ? [{ transform: `translate(${old.left - rect.left}px, ${old.top - rect.top}px)` }, { transform: "none" }]
        : [{ opacity: 0, transform: "scale(.98)" }, { opacity: 1, transform: "none" }];
      active.current.push(card.animate(frames, { duration: 220, easing: "ease-out" }));
    }
    before.current.clear();
  }, [view]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    function change() { if (media.matches) stop(); }
    media.addEventListener("change", change);
    return () => { media.removeEventListener("change", change); stop(); };
  }, []);
  return { list, capture };
}

const submittedAtFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Seoul",
});

function ParticipantAnswerGrid({
  grid,
  participant,
}: {
  grid: PublicPuzzleGrid;
  participant: ParticipationBoardParticipant;
}) {
  const cellByPosition = useMemo(() => new Map(
    grid.cells.map((cell) => [`${cell.row}:${cell.column}`, cell] as const),
  ), [grid.cells]);
  const correctCellIds = useMemo(
    () => new Set(participant.correctCellIds),
    [participant.correctCellIds],
  );
  const answeredCells = grid.cells.filter((cell) => participant.answers[cell.id] !== undefined);
  const incorrectCount = answeredCells.length - participant.correctCellIds.length;
  const blankCount = grid.cells.length - answeredCells.length;
  const answerDetails = answeredCells.map((cell) => (
    `${cell.row + 1}행 ${cell.column + 1}열 ${participant.answers[cell.id]}, ${correctCellIds.has(cell.id) ? "정답" : "다른 답"}`
  )).join(". ");
  const gridStyle = { "--board-grid-size": grid.gridSize } as CSSProperties;

  return <div className={styles.boardAnswer}>
    <p className="sr-only">
      답안 격자. 작성 {answeredCells.length}칸, 정답 {participant.correctCellIds.length}칸,
      다른 답 {incorrectCount}칸, 빈칸 {blankCount}칸.
      {answerDetails && ` 입력 내용: ${answerDetails}.`}
    </p>
    <div className={styles.boardGrid} style={gridStyle} aria-hidden="true">
      {Array.from({ length: grid.gridSize }, (_, row) => Array.from(
        { length: grid.gridSize },
        (_, column) => {
          const cell = cellByPosition.get(`${row}:${column}`);
          if (cell === undefined) {
            return <span className={styles.boardBlockedCell} key={`${row}:${column}`} />;
          }
          const answer = participant.answers[cell.id];
          const answerState = answer === undefined
            ? "blank"
            : correctCellIds.has(cell.id) ? "correct" : "incorrect";
          return <span
            className={styles.boardAnswerCell}
            data-answer-state={answerState}
            data-board-cell={cell.id}
            key={cell.id}
          >
            {cell.number !== undefined && <small>{cell.number}</small>}
            {answer ?? ""}
            <span className={styles.boardAnswerMarker}>{answerState === "correct" ? "✓" : answerState === "incorrect" ? "×" : "·"}</span>
          </span>;
        },
      ))}
    </div>
  </div>;
}

export function ParticipationBoard({
  grid,
  target,
  printable = true,
}: {
  grid: PublicPuzzleGrid;
  target: ParticipationBoardTarget;
  printable?: boolean;
}) {
  const headingId = useId();
  const request = useRef<AbortController | null>(null);
  const [state, setState] = useState<BoardState>({ status: "idle" });
  const [view, setView] = useState<BoardView>("all");
  const motion = useBoardMotion(view);

  useEffect(() => () => request.current?.abort(), []);

  function loadBoard() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState({ status: "loading" });
    setView("all");
    void readParticipationBoard(target, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setState(result.ok
        ? { status: "ready", data: result.data }
        : { status: "error", error: result.error });
    });
  }

  return <section className={styles.boardSection} aria-labelledby={headingId} data-testid="participation-board" data-view={view}>
    <div className={styles.boardHeader}>
      <div>
        <p className={styles.boardKicker}>함께 푼 답안</p>
        <h3 id={headingId}>참여 현황</h3>
        <p>공개된 답안을 제출 순서대로 살펴볼 수 있습니다.</p>
      </div>
      {state.status === "idle" && <button className="primary-button" type="button" onClick={loadBoard}>
        참여 현황 보기
      </button>}
    </div>

    {state.status === "loading" && <div className={styles.boardLoading} role="status" aria-label="참여 현황을 불러오고 있습니다.">
      <p>참여 현황을 불러오고 있습니다.</p>
      <div aria-hidden="true"><span /><span /><span /></div>
    </div>}

    {state.status === "error" && <div className={styles.boardError} role="alert">
      <p>{state.error.message}</p>
      <button type="button" onClick={loadBoard}>참여 현황 다시 시도</button>
      {state.error.requestId && <p className="request-id">문의용 번호: {state.error.requestId}</p>}
    </div>}

    {state.status === "ready" && state.data.participants.length === 0 && <div className={styles.boardEmpty} role="status">
      <p>아직 공개할 참여 답안이 없습니다.</p>
      {printable && <TopNPrintButton target={target} />}
    </div>}

    {state.status === "ready" && state.data.participants.length > 0 && (() => {
      const topModel = topNView(state.data);
      const fullyCorrectParticipants = state.data.participants.filter(
        (participant) => participant.isFullyCorrect,
      );
      const visibleParticipants = view === "top"
        ? fullyCorrectParticipants
        : state.data.participants;
      const rankBySubmissionOrder = new Map(fullyCorrectParticipants.map((person, index) => [person.submissionOrder, topModel.participants[index]?.rank ?? undefined]));

      function changeView(next: BoardView) {
        if (next === view) return;
        const nextParticipants = next === "top" ? fullyCorrectParticipants : state.status === "ready" ? state.data.participants : [];
        motion.capture(new Set(nextParticipants.map((person) => String(person.submissionOrder))));
        setView(next);
      }
      return <>
        <div className={styles.boardViewControls}>
          <div role="group" aria-label="참여 현황 보기 방식">
            <button type="button" aria-pressed={view === "all"} onClick={() => changeView("all")}>
              전체 참여
            </button>
            <button type="button" aria-pressed={view === "top"} onClick={() => changeView("top")}>
              Top N
            </button>
          </div>
          {view === "top" && printable && <TopNPrintButton target={target} />}
          <p aria-live="polite">
            {view === "all"
              ? `공개된 답안 ${state.data.participants.length}개`
              : `완전 정답자 ${fullyCorrectParticipants.length}명, ${state.data.winnerCount}위까지 순위를 표시합니다.`}
          </p>
        </div>

        {visibleParticipants.length === 0 ? <div className={styles.boardEmpty} role="status">
          <p>아직 모든 칸을 맞힌 참여자가 없습니다.</p>
        </div> : <>
          {view === "top" && <div className={styles.boardCelebration} aria-hidden="true">
            <img src="/images/shared/celebration-screen.webp" alt="" width="640" height="213" loading="lazy" />
          </div>}
          <div className={styles.boardSummary}>
            <p>
              {view === "all" ? "제출 순서대로 공개합니다." : "완전 정답자를 제출 순서대로 공개합니다."}
            </p>
            <ul className={styles.boardLegend} aria-label="답안 색상 안내">
              <li data-answer-state="correct"><span aria-hidden="true">✓</span>정답</li>
              {view === "all" && <>
                <li data-answer-state="incorrect"><span aria-hidden="true">×</span>다른 답</li>
                <li data-answer-state="blank"><span aria-hidden="true">·</span>빈칸</li>
              </>}
            </ul>
          </div>
          <ol className={styles.boardList} ref={motion.list}>
            {visibleParticipants.map((participant) => {
              const rank = rankBySubmissionOrder.get(participant.submissionOrder);
              const participantHeadingId = `${headingId}-${participant.submissionOrder}`;
              return <li key={participant.submissionOrder} data-participant={participant.submissionOrder}>
                <article className={styles.participantCard} data-mine={participant.isMine} data-rank={view === "top" ? rank : undefined} aria-labelledby={participantHeadingId}>
                  <div className={styles.participantCopy}>
                    {rank !== undefined && view === "top" && <p className={styles.participantRank}>{rank}위</p>}
                    <p className={styles.submissionOrder}>{participant.submissionOrder}번째 제출</p>
                    <div className={styles.participantTitle}>
                      <h4 id={participantHeadingId}>{participant.displayName}</h4>
                      {participant.isMine && <span className={styles.mineBadge}>내 답안</span>}
                    </div>
                    <p className={styles.participantTime}>
                      <time dateTime={participant.submittedAt}>{submittedAtFormatter.format(new Date(participant.submittedAt))}</time>
                    </p>
                    {participant.isFullyCorrect && <p className={styles.fullCorrectBadge}>모든 칸 정답</p>}
                    {view === "all" && participant.comment && <p className={styles.participantComment}><span className="sr-only">한줄평: </span>{participant.comment}</p>}
                  </div>
                  <ParticipantAnswerGrid grid={grid} participant={participant} />
                </article>
              </li>;
            })}
          </ol>
        </>}
      </>;
    })()}
  </section>;
}
