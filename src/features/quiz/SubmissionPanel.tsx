import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import type { Difficulty } from "../../../shared/api/public-quiz";
import type { SubmissionResult } from "../../../shared/api/submission";
import {
  generateUuidV7,
  prepareSubmissionSession,
  submissionFingerprint,
  submitQuiz,
  type PublicClientError,
} from "./submission-client";
import { TurnstileChallenge } from "./TurnstileChallenge";
import styles from "./quiz.module.css";

export interface SubmissionTarget {
  difficulty: Difficulty;
  revision: number;
  slug: string;
}

const segmenter = new Intl.Segmenter("ko", { granularity: "grapheme" });

function graphemeCount(value: string): number {
  return Array.from(segmenter.segment(value)).length;
}

function localValidation(name: string, comment: string, consent: boolean): PublicClientError | null {
  const nameLength = graphemeCount(name.normalize("NFC").trim());
  if (nameLength < 2 || nameLength > 12) {
    return { code: "INVALID_NAME", field: "name", message: "이름은 2자에서 12자로 입력해 주세요." };
  }
  if (graphemeCount(comment.normalize("NFC").trim()) > 80) {
    return { code: "INVALID_COMMENT", field: "comment", message: "한줄평은 80자 이내로 입력해 주세요." };
  }
  if (!consent) return { code: "CONSENT_REQUIRED", message: "공개와 보관 동의를 확인해 주세요." };
  return null;
}

export function SubmissionPanel({
  cells,
  onSuccess,
  target,
}: {
  cells: ReadonlyMap<string, string>;
  onSuccess(result: SubmissionResult): void;
  target: SubmissionTarget;
}) {
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const [sessionState, setSessionState] = useState<"error" | "loading" | "ready">("loading");
  const [sessionError, setSessionError] = useState<PublicClientError | null>(null);
  const [challengeState, setChallengeState] = useState<"error" | "expired" | "loading" | "ready" | "unavailable">("loading");
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [challengeKey, setChallengeKey] = useState(0);
  const [name, setName] = useState("");
  const [comment, setComment] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<PublicClientError | null>(null);
  const attemptRef = useRef<{ fingerprint: string; idempotencyKey: string } | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const writtenCells = useMemo(() => Object.fromEntries(cells), [cells]);

  useEffect(() => {
    let active = true;
    void prepareSubmissionSession().then((result) => {
      if (!active) return;
      if (result.ok) {
        setSessionState("ready");
        setSessionError(null);
      } else {
        setSessionState("error");
        setSessionError(result.error);
      }
    });
    return () => { active = false; };
  }, [sessionAttempt]);

  const receiveToken = useCallback((token: string | null) => setChallengeToken(token), []);
  const receiveChallengeState = useCallback((state: typeof challengeState) => setChallengeState(state), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || sessionState !== "ready") return;
    const validation = localValidation(name, comment, consent);
    if (validation !== null) {
      setSubmitError(validation);
      if (validation.field === "name") nameRef.current?.focus();
      if (validation.field === "comment") commentRef.current?.focus();
      return;
    }
    if (challengeToken === null) {
      setSubmitError({ code: "TURNSTILE_REQUIRED", message: "사람 확인을 완료해 주세요." });
      return;
    }

    const fingerprint = submissionFingerprint({
      cells: writtenCells,
      comment,
      consent,
      name,
      revision: target.revision,
    });
    if (attemptRef.current?.fingerprint !== fingerprint) {
      attemptRef.current = { fingerprint, idempotencyKey: generateUuidV7() };
    }
    setSubmitting(true);
    setSubmitError(null);
    const result = await submitQuiz(target, {
      revision: target.revision,
      idempotencyKey: attemptRef.current.idempotencyKey,
      turnstileToken: challengeToken,
      name,
      comment,
      consent: true,
      cells: writtenCells,
    });
    setSubmitting(false);
    if (result.ok) {
      onSuccess(result.data);
      return;
    }
    setSubmitError(result.error);
    setChallengeKey((value) => value + 1);
    if (result.error.field === "name") nameRef.current?.focus();
    if (result.error.field === "comment") commentRef.current?.focus();
  }

  if (sessionState === "error") {
    return <div className={styles.submissionPrepare} role="alert">
      <p>{sessionError?.message ?? "제출 세션을 준비하지 못했습니다."}</p>
      <button type="button" onClick={() => {
        setSessionState("loading");
        setSessionAttempt((value) => value + 1);
      }}>세션 다시 준비</button>
      {sessionError?.requestId && <p className="request-id">문의용 번호: {sessionError.requestId}</p>}
    </div>;
  }

  return <form className={styles.submissionForm} onSubmit={(event) => void submit(event)} noValidate>
    <fieldset disabled={submitting || sessionState !== "ready"}>
      <legend>제출 정보</legend>
      <p className={styles.formIntro}>{sessionState === "loading" ? "제출 세션을 준비하고 있습니다." : "한 글자 이상 작성한 부분 답안도 제출할 수 있습니다."}</p>
      <label htmlFor="submission-name">이름</label>
      <input ref={nameRef} id="submission-name" name="name" type="text" value={name} onChange={(event) => setName(event.currentTarget.value)} autoComplete="name" aria-invalid={submitError?.field === "name"} aria-describedby="submission-name-help submission-error" />
      <p id="submission-name-help" className={styles.fieldHelp}>2자에서 12자, 한글·영문·숫자와 한 칸 공백을 사용할 수 있습니다.</p>

      <label htmlFor="submission-comment">한줄평 <span>(선택)</span></label>
      <textarea ref={commentRef} id="submission-comment" name="comment" value={comment} onChange={(event) => setComment(event.currentTarget.value)} rows={3} aria-invalid={submitError?.field === "comment"} aria-describedby="submission-comment-help submission-error" />
      <p id="submission-comment-help" className={styles.fieldHelp}>80자 이내로 입력해 주세요. 현재 {graphemeCount(comment.normalize("NFC").trim())}자</p>

      <label className={styles.consent}>
        <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.currentTarget.checked)} />
        <span>입력한 표시 이름, 답안 및 코멘트가 참여현황에 공개되고, 참여 기록이 운영되는 동안 보관되는 것에 동의합니다.</span>
      </label>

      {sessionState === "ready" && <TurnstileChallenge
        key={challengeKey}
        refreshKey={challengeKey}
        onState={receiveChallengeState}
        onToken={receiveToken}
      />}
      <button className="primary-button" type="submit" disabled={submitting || sessionState !== "ready" || challengeState !== "ready" || !consent}>
        {submitting ? "제출하고 있습니다" : "답안 제출"}
      </button>
      {submitError && <div id="submission-error" className={styles.submissionError} role="alert">
        <p>{submitError.message}</p>
        {submitError.requestId && <p className="request-id">문의용 번호: {submitError.requestId}</p>}
      </div>}
    </fieldset>
  </form>;
}

export function SubmissionResultSummary({
  result,
}: {
  result: SubmissionResult;
}) {
  const submittedAt = new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(result.submittedAt));
  return <section className={styles.resultPanel} aria-labelledby="submission-result-title" aria-live="polite">
    <div>
      <h3 id="submission-result-title">제출이 완료되었습니다</h3>
      <p className={styles.score}>{result.scoreBasisPoints / 100}%</p>
      <p>{result.correctCells} / {result.totalCells}칸, {result.correctWords} / {result.totalWords}개 낱말을 맞혔습니다.</p>
      <p className={styles.submittedAt}><time dateTime={result.submittedAt}>{submittedAt}</time> 제출</p>
    </div>
    {result.correctCells === result.totalCells && <p className={styles.fullCorrect}>모든 칸을 맞혔습니다.</p>}
    <p className={styles.resultNote}>같은 브라우저로 다시 방문하면 저장된 결과를 불러옵니다.</p>
  </section>;
}
