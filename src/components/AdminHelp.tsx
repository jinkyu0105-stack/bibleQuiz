import { Fragment, useEffect, useId, useRef } from "react";
import { adminTerms, adminTitleEmoji, type AdminTerm } from "../config/admin-help";
import css from "./admin-help.module.css";

export function AdminEmoji({ children }: { children: string }) {
  return <span className={css.emoji} aria-hidden="true">{children}</span>;
}
export function AdminLabel({ text, explain = false }: { text: string; explain?: boolean }) {
  return <>{adminTitleEmoji[text] && <AdminEmoji>{adminTitleEmoji[text]}</AdminEmoji>}{explain ? <GuideText text={text}/> : text}</>;
}

function positionBubble(button: HTMLButtonElement, bubble: HTMLSpanElement) {
  const anchor = button.getBoundingClientRect(), box = bubble.getBoundingClientRect();
  const left = Math.max(12, Math.min(anchor.left, window.innerWidth - box.width - 12));
  const below = anchor.bottom + 8;
  const top = below + box.height <= window.innerHeight - 12 ? below : Math.max(12, anchor.top - box.height - 8);
  bubble.style.left = `${left}px`;
  bubble.style.top = `${top}px`;
}

/** Native top layer avoids clipping inside the glass panels and nested disclosures. */
export function HelpTerm({ term }: { term: AdminTerm }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hovered = useRef(false);
  const focused = useRef(false);
  function show() {
    clearTimeout(timer.current);
    const el = bubble.current, button = trigger.current;
    if (!el || !button) return;
    if (!el.matches(":popover-open")) el.showPopover();
    positionBubble(button, el);
  }
  function leave() {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!hovered.current && !focused.current && bubble.current?.matches(":popover-open")) bubble.current.hidePopover();
    }, 160);
  }
  useEffect(() => {
    const reposition = () => {
      const el = bubble.current, button = trigger.current;
      if (!el?.matches(":popover-open") || !button) return;
      const anchor = button.getBoundingClientRect();
      if (anchor.bottom < 0 || anchor.top > window.innerHeight) el.hidePopover();
      else positionBubble(button, el);
    };
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => { clearTimeout(timer.current); window.removeEventListener("resize", reposition); window.removeEventListener("scroll", reposition, true); };
  }, []);
  return <><button type="button" ref={trigger} className={css.term} aria-describedby={id} popoverTarget={id} popoverTargetAction="show"
    onPointerEnter={event => { if (event.pointerType !== "touch") { hovered.current = true; show(); } }}
    onPointerLeave={() => { hovered.current = false; leave(); }}
    onFocus={() => { focused.current = true; show(); }} onBlur={() => { focused.current = false; leave(); }} onClick={show}>
    {term}<span className={css.question} aria-hidden="true">?</span>
  </button><span id={id} ref={bubble} role="tooltip" popover="auto" className={css.tooltip}
    onPointerEnter={() => { hovered.current = true; clearTimeout(timer.current); }} onPointerLeave={() => { hovered.current = false; leave(); }}>
    <strong>{term}</strong><span>{adminTerms[term]}</span>
  </span></>;
}
const termPattern = new RegExp(`(${Object.keys(adminTerms).sort((a,b) => b.length-a.length).join("|")})`, "gu");
/** Only use for repository-authored prose, never inside a link, label or button. */
export function GuideText({ text }: { text: string }) {
  const seen = new Set<string>();
  return <>{text.split(termPattern).map((part, index) => {
    if (Object.hasOwn(adminTerms, part) && !seen.has(part)) {
      seen.add(part);
      return <HelpTerm key={index} term={part as AdminTerm}/>;
    }
    return <Fragment key={index}>{part}</Fragment>;
  })}</>;
}
export function AdminConcepts({ terms }: { terms: readonly AdminTerm[] }) {
  return <div className={css.concepts} aria-label="용어 도움말"><span className={css.conceptLabel}><AdminEmoji>💡</AdminEmoji>용어 도움말</span>
    {terms.map(term => <HelpTerm key={term} term={term}/>)}
    <small>올려 보거나 눌러 보세요</small>
  </div>;
}
