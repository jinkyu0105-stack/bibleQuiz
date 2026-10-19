import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { WeeklyQuiz } from "../../../shared/api/admin-weekly";
import { AdminIcon } from "../../components/AdminIcon";
import { GlassArrowButton } from "../../components/glass/GlassArrowButton";
import styles from "./quiz-row-actions.module.css";

/** Mobile disclosure keeps the same destinations and participant counts as desktop. */
export function QuizRowActions({ quiz, stateLabel }: { quiz: WeeklyQuiz; stateLabel: string }) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const published = ["published", "archived"].includes(quiz.status);
  function position() {
    const button = trigger.current, menu = panel.current;
    if (!button || !menu) return;
    const anchor = button.getBoundingClientRect(), box = menu.getBoundingClientRect();
    const left = Math.max(12, Math.min(anchor.right - box.width, innerWidth - box.width - 12));
    const above = anchor.top - box.height - 8;
    menu.style.left = `${left}px`;
    menu.style.top = `${above >= 12 ? above : Math.max(12, Math.min(anchor.bottom + 8, innerHeight - box.height - 12))}px`;
    menu.dataset.positioned = "true";
  }
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: Event) => {
      // Scrolling the menu itself must remain possible on short screens.
      if (event.type === "scroll" && event.target instanceof Node && panel.current?.contains(event.target)) return;
      if (panel.current?.matches(":popover-open")) panel.current.hidePopover();
    };
    window.addEventListener("resize", dismiss);
    document.addEventListener("scroll", dismiss, true);
    return () => { window.removeEventListener("resize", dismiss); document.removeEventListener("scroll", dismiss, true); };
  }, [open]);
  return <div className={styles.mobile}>
    <GlassArrowButton ref={trigger} glyph="more" label={`${quiz.title} 관리 더보기`} popoverTarget={id} aria-haspopup="dialog" aria-expanded={open}/>
    <div ref={panel} id={id} popover="auto" role="dialog" aria-label={`${quiz.title} 관리`} className={styles.panel}
      onToggle={event => { const showing = event.newState === "open"; setOpen(showing); if (showing) position(); else if (panel.current) delete panel.current.dataset.positioned; }}>
      <header className={styles.heading}><div><span>{stateLabel}</span><strong>{quiz.title}</strong></div><button type="button" aria-label="퀴즈 관리 메뉴 닫기" popoverTarget={id} popoverTargetAction="hide">×</button></header>
      {published && <div className={styles.counts} aria-label="참여 인원"><span><AdminIcon name="child"/>어린이 <strong>{quiz.childVisibleCount}</strong>명</span><span><AdminIcon name="adult"/>장년 <strong>{quiz.adultVisibleCount}</strong>명</span></div>}
      <nav aria-label="퀴즈 관리 작업" className={styles.links}>
        {!quiz.expired && <Link to={`/admin/quiz/${quiz.quizSetId}`}><span><AdminIcon name={published ? "settings" : "edit"}/></span>{published ? "퀴즈 설정" : "초안 편집"}<AdminIcon name="chevron"/></Link>}
        {published && <Link to={`/admin/submissions?quiz=${quiz.quizSetId}`}><span><AdminIcon name="people"/></span>참여 기록<AdminIcon name="chevron"/></Link>}
      </nav>
      {quiz.expired && <p className={styles.note}>초안 본문은 정리되었으며 발행 기록과 비용은 보존됩니다.</p>}
    </div>
  </div>;
}
