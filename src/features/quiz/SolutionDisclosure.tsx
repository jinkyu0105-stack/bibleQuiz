import { useEffect, useId, useRef, useState } from "react";

import {
  readQuizSolution,
  type SolutionClientError,
  type SolutionTarget,
} from "./solution-client";
import type { RevealedSolution } from "../../../shared/api/solution";
import styles from "./quiz.module.css";

type SolutionState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; error: SolutionClientError }
  | { status: "ready" };

export function SolutionDisclosure({
  available,
  blockedMessage,
  isRevealed,
  onHide,
  onReveal,
  target,
}: {
  available: boolean;
  blockedMessage: string;
  isRevealed: boolean;
  onHide(): void;
  onReveal(solution: RevealedSolution): boolean;
  target: SolutionTarget;
}) {
  const headingId = useId();
  const request = useRef<AbortController | null>(null);
  const [state, setState] = useState<SolutionState>({ status: "idle" });

  useEffect(() => () => request.current?.abort(), []);

  function loadSolution() {
    if (!available) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState({ status: "loading" });
    void readQuizSolution(target, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok) {
        setState(onReveal(result.data.solution)
          ? { status: "ready" }
          : {
              status: "error",
              error: {
                code: "CLIENT_UNAVAILABLE",
                message: "저장된 결과와 정답을 함께 확인하지 못했습니다.",
              },
            });
      } else {
        setState({ status: "error", error: result.error });
      }
    });
  }

  return <section className={styles.solutionSection} aria-labelledby={headingId}>
    <div>
      <p className={styles.solutionKicker}>내 답안과 공식 정답</p>
      <h3 id={headingId}>정답보기</h3>
      <p>{isRevealed
        ? "내 답안과 공식 정답을 비교하고 있습니다."
        : available
        ? "정답은 이 버튼을 누른 뒤 안전하게 불러옵니다."
        : blockedMessage}</p>
    </div>
    <div className={styles.solutionAction}>
      {isRevealed ? <button type="button" aria-pressed="true" onClick={() => {
        onHide();
        setState({ status: "idle" });
      }}>정답 닫기</button> : <button
        type="button"
        aria-disabled={!available}
        disabled={state.status === "loading"}
        onClick={loadSolution}
      >{state.status === "loading"
          ? "정답을 불러오고 있습니다"
          : state.status === "error" ? "정답 다시 시도" : "정답보기"}</button>}
    </div>
    {state.status === "loading" && <p className={styles.solutionStatus} role="status" aria-label="정답을 불러오고 있습니다.">
      정답을 불러오고 있습니다.
    </p>}
    {state.status === "error" && <div className={styles.solutionError} role="alert">
      <p>{state.error.message}</p>
      {state.error.requestId && <p className="request-id">문의용 번호: {state.error.requestId}</p>}
    </div>}
  </section>;
}
