import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import type { Difficulty } from "../../shared/api/public-quiz";
import { AdminIcon } from "./AdminIcon";
import styles from "./quiz-choice.module.css";

/** Shared native modal: Escape, focus containment and return to the invoking button. */
export function QuizChoiceDialog({ open, title = "퀴즈 선택", description, choices, onClose, onNavigate, children }: {
  open: boolean; title?: string; description: string; choices: { difficulty: Difficulty; to: string }[];
  onClose: () => void; onNavigate?: (() => void) | undefined; children?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null), id = useId();
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal();
    else if (!open && ref.current?.open) ref.current.close();
  }, [open]);
  return createPortal(<dialog ref={ref} className={`quiz-choice ${styles.dialog}`} aria-labelledby={`${id}-heading`} aria-describedby={`${id}-description`} onClose={onClose} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const box = event.currentTarget.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) event.currentTarget.close();
  }}>
    <div className={styles.header}><h3 id={`${id}-heading`}>{title}</h3><button type="button" className={styles.close} aria-label="선택창 닫기" onClick={() => ref.current?.close()}>×</button></div>
    <p id={`${id}-description`} className={styles.description}>{description}</p>
    {children}
    <div className={styles.choices}>{[...choices].sort((a,b) => Number(a.difficulty === "adult") - Number(b.difficulty === "adult")).map(({ difficulty, to }) => <Link key={difficulty} to={to} onClick={() => { onNavigate?.(); ref.current?.close(); }}>
      <AdminIcon name={difficulty}/><span>{difficulty === "child" ? "어린이 퀴즈" : "장년 퀴즈"}</span>
    </Link>)}</div>
  </dialog>, document.body);
}
