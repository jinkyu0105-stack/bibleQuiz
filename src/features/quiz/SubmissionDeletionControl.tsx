import { useEffect, useId, useRef, useState } from "react";

import type { SubmissionDeletionData } from "../../../shared/api/submission";
import {
  deleteOwnSubmission,
  type PublicClientError,
  type SubmissionDeletionTarget,
} from "./submission-client";
import styles from "./quiz.module.css";

export function SubmissionDeletionControl({
  difficultyLabel,
  onDeleted,
  target,
}: {
  difficultyLabel: string;
  onDeleted(submission: SubmissionDeletionData["submission"]): void;
  target: SubmissionDeletionTarget;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<PublicClientError | null>(null);

  useEffect(() => () => requestRef.current?.abort(), []);

  function openDialog() {
    setError(null);
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    if (deleting) return;
    setError(null);
    dialogRef.current?.close();
  }

  async function confirmDeletion() {
    if (deleting) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setDeleting(true);
    setError(null);
    const result = await deleteOwnSubmission(target, controller.signal);
    if (controller.signal.aborted) return;
    requestRef.current = null;
    setDeleting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    dialogRef.current?.close();
    onDeleted(result.data);
  }

  return <div className={styles.deletionControl}>
    <button type="button" className={styles.deleteButton} onClick={openDialog}>내 제출 삭제</button>
    <dialog
      ref={dialogRef}
      className={styles.deletionDialog}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        if (deleting) event.preventDefault();
        else setError(null);
      }}
      onClose={() => setError(null)}
    >
      <div className={styles.deletionDialogContent}>
        <p className={styles.dialogKicker}>제출 기록 관리</p>
        <h3 id={titleId}>내 제출을 삭제할까요?</h3>
        <p id={descriptionId}>삭제하면 이름, 답안과 한줄평이 공개 기록에서 제거됩니다. 이 작업은 되돌릴 수 없으며 이 퀴즈의 {difficultyLabel}에 다시 제출할 수 없습니다.</p>
        {error && <div className={styles.deletionError} role="alert">
          <p>{error.message}</p>
          {error.requestId && <p className="request-id">문의용 번호: {error.requestId}</p>}
        </div>}
        <div className={styles.dialogActions}>
          <button type="button" disabled={deleting} onClick={closeDialog}>취소</button>
          <button type="button" className={styles.dangerButton} disabled={deleting} onClick={() => void confirmDeletion()}>
            {deleting ? "삭제하고 있습니다" : error ? "삭제 다시 시도" : "삭제하기"}
          </button>
        </div>
      </div>
    </dialog>
  </div>;
}
