import { useEffect, useRef, useState } from "react";

import type { PracticeCheckData } from "../../../shared/api/practice";
import {
  checkPracticeAnswers,
  type PracticeCheckTarget,
  type PracticeClientError,
} from "./practice-client";
import styles from "./quiz.module.css";

export function PracticeCheckPanel({
  cells,
  onSuccess,
  target,
}: {
  cells: ReadonlyMap<string, string>;
  onSuccess(result: PracticeCheckData, answers: Readonly<Record<string, string>>): void;
  target: PracticeCheckTarget;
}) {
  const request = useRef<AbortController | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<PracticeClientError | null>(null);
  const writtenCount = cells.size;

  useEffect(() => () => request.current?.abort(), []);

  function check() {
    if (loading || writtenCount === 0) return;
    const answers = Object.fromEntries(cells);
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(null);
    void checkPracticeAnswers(target, answers, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setLoading(false);
      if (result.ok) onSuccess(result.data, answers);
      else setError(result.error);
    });
  }

  return <section className={styles.confirmPanel} aria-labelledby="practice-check-title">
    <div>
      <h3 id="practice-check-title">지난 퀴즈 풀어보기</h3>
      <p>{writtenCount === 0
        ? "한 칸 이상 작성하면 기록을 남기지 않고 채점할 수 있습니다."
        : `현재 작성한 ${writtenCount}칸을 채점할 수 있습니다.`}</p>
      <p className={styles.resultNote}>이름, 한줄평, 개인정보 동의나 사람 확인은 필요하지 않습니다.</p>
    </div>
    <button
      type="button"
      className="primary-button"
      disabled={loading || writtenCount === 0}
      onClick={check}
    >{loading ? "채점하고 있습니다" : error === null ? "채점하기" : "채점 다시 시도"}</button>
    {loading && <p className={styles.solutionStatus} role="status" aria-label="답안을 채점하고 있습니다.">
      답안을 채점하고 있습니다.
    </p>}
    {error && <div className={styles.solutionError} role="alert">
      <p>{error.message}</p>
      {error.requestId && <p className="request-id">문의용 번호: {error.requestId}</p>}
    </div>}
  </section>;
}

export function PracticeResultSummary({
  result,
}: {
  result: PracticeCheckData;
}) {
  return <section className={styles.resultPanel} aria-labelledby="practice-result-title" aria-live="polite">
    <div>
      <h3 id="practice-result-title">채점 결과</h3>
      <p className={styles.score}>{result.scoreBasisPoints / 100}%</p>
      <p>{result.correctCells} / {result.totalCells}칸, {result.correctWords} / {result.totalWords}개 낱말을 맞혔습니다.</p>
    </div>
    {result.correctCells === result.totalCells && <p className={styles.fullCorrect}>모든 칸을 맞혔습니다.</p>}
    <p className={styles.resultNote}>이 결과는 제출 기록, 참여 수나 순위로 저장되지 않습니다.</p>
  </section>;
}
