import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AdminIcon } from "./AdminIcon";
import styles from "./help-dialog.module.css";

/** Native modal keeps focus inside and restores it to the question button on close. */
export function HelpDialog({ open, title, onClose, children }: {
  open: boolean; title: string; onClose: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null), id = useId();
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal();
    else if (!open && ref.current?.open) ref.current.close();
  }, [open]);
  return createPortal(<dialog className={styles.dialog} ref={ref} aria-labelledby={id}
    onClose={event => { if (event.target === event.currentTarget) onClose(); }}
    onKeyDown={event => {
      if (event.key !== "Tab" || (event.target as HTMLElement).closest("dialog") !== event.currentTarget) return;
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], summary, [tabindex="0"]')]
        .filter(element => element.checkVisibility() && element.closest("dialog") === event.currentTarget);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}
    onClick={event => {
    if (event.target !== event.currentTarget) return;
    const box = event.currentTarget.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) ref.current?.close();
  }}>
    <header><h2 id={id}>{title}</h2><button type="button" aria-label="도움말 닫기" onClick={() => ref.current?.close()}><AdminIcon name="close"/></button></header>
    <div className={styles.content}>{children}</div>
  </dialog>, document.body);
}
