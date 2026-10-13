import { Fragment, type ReactNode } from "react";
import { useAdminTooltip } from "./useAdminTooltip";
import { adminTerms, adminTermTones, adminToneLabels, adminTitleEmoji, type AdminTerm } from "../config/admin-help";
import css from "./admin-help.module.css";

export function AdminEmoji({ children }: { children: string }) {
  return <span className={css.emoji} aria-hidden="true">{children}</span>;
}
export function AdminLabel({ text, explain = false }: { text: string; explain?: boolean }) {
  return <>{adminTitleEmoji[text] && <AdminEmoji>{adminTitleEmoji[text]}</AdminEmoji>}{explain ? <GuideText text={text}/> : text}</>;
}

/** Shared compact explanation for an icon, status or count. */
export function AdminTooltip({ label, children }: { label: string; children: ReactNode | ((descriptionId: string) => ReactNode) }) {
  const { id, triggerRef, bubbleRef, triggerEvents, bubbleEvents } = useAdminTooltip<HTMLSpanElement>();
  return <span ref={triggerRef} className={css.hint} {...triggerEvents}>
    {typeof children === "function" ? children(id) : children}
    <span id={id} ref={bubbleRef} role="tooltip" popover="auto" className={`${css.tooltip} ${css.compact}`} data-compact data-admin-tone="action" {...bubbleEvents}>{label}</span>
  </span>;
}

/** Native top layer avoids clipping inside glass panels and nested disclosures. */
export function HelpTerm({ term }: { term: AdminTerm }) {
  const { id, triggerRef, bubbleRef, show, triggerEvents, bubbleEvents } = useAdminTooltip<HTMLButtonElement>();
  return <><button type="button" ref={triggerRef} className={css.term} data-admin-tone={adminTermTones[term]} aria-describedby={id} popoverTarget={id} popoverTargetAction="show" {...triggerEvents} onClick={show}>
    {term}
  </button><span id={id} ref={bubbleRef} role="tooltip" popover="auto" className={css.tooltip} data-admin-tone={adminTermTones[term]} {...bubbleEvents}>
    <span className={css.tooltipHeading}><strong>{term}</strong><span className={css.kind} aria-hidden="true">{adminToneLabels[adminTermTones[term]]}</span></span><span>{adminTerms[term]}</span>
  </span></>;
}
const termPattern = new RegExp(`(${Object.keys(adminTerms).sort((a,b) => b.length-a.length).join("|")})`, "gu");
/** Only use for repository-authored prose, never inside a link, label or button. */
export function GuideText({ text }: { text: string }) {
  const seen = new Set<string>();
  const parts = text.split(termPattern);
  return <>{parts.map((part, index) => {
    if (Object.hasOwn(adminTerms, part) && !seen.has(part)) {
      seen.add(part);
      // Keep only the rest of this Korean word with its term, never a whole phrase.
      const ending = parts[index + 1]?.match(/^[가-힣]+/u)?.[0] ?? "";
      if (ending) parts[index + 1] = parts[index + 1]!.slice(ending.length);
      return <span key={index} className={css.termWord}><HelpTerm term={part as AdminTerm}/>{ending}</span>;
    }
    return <Fragment key={index}>{part}</Fragment>;
  })}</>;
}
export function AdminConcepts({ terms }: { terms: readonly AdminTerm[] }) {
  return <div className={css.concepts} aria-label="용어 도움말"><span className={css.conceptLabel}><AdminEmoji>💡</AdminEmoji>용어 도움말</span>
    {terms.map(term => <HelpTerm key={term} term={term}/>)}
    <small>용어에 마우스를 올리거나 눌러 보세요</small>
  </div>;
}
