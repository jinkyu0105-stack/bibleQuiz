import type { ReactNode } from "react";
import { useAdminTooltip } from "./useAdminTooltip";
import css from "./admin-help.module.css";

/** Shared compact explanation for an icon, status or count. */
export function Tooltip({ label, children }: { label: string; children: ReactNode | ((descriptionId: string) => ReactNode) }) {
  const { id, triggerRef, bubbleRef, triggerEvents, bubbleEvents } = useAdminTooltip<HTMLSpanElement>();
  return <span ref={triggerRef} className={css.hint} {...triggerEvents}>
    {typeof children === "function" ? children(id) : children}
    <span id={id} ref={bubbleRef} role="tooltip" popover="auto" className={`${css.tooltip} ${css.compact}`} data-compact data-admin-tone="action" {...bubbleEvents}>{label}</span>
  </span>;
}

