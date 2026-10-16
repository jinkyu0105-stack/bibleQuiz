import type { ReactNode } from "react";
import type { AdminTone } from "../config/admin-help";

// Shared line icons extend the existing admin navigation's stroke and proportions.
const shapes = {
  help: <><circle cx="12" cy="12" r="9"/><path d="M9.5 8.5a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4 M12 16.5h.01"/></>,
  share: <><path d="M12 15V3 M8 7l4-4 4 4 M5 11v10h14V11"/></>,
  arrowKeys: <><rect x="9" y="2" width="6" height="8" rx="1"/><rect x="1" y="12" width="6" height="8" rx="1"/><rect x="9" y="12" width="6" height="8" rx="1"/><rect x="17" y="12" width="6" height="8" rx="1"/><path d="M10.5 6 12 4.5 13.5 6 M4.5 14.5 3 16l1.5 1.5 M10.5 15.5l1.5 1.5 1.5-1.5 M19.5 14.5l1.5 1.5-1.5 1.5"/></>,
  refresh: <><path d="M4 12a8 8 0 0 1 13.66-5.66L20 9 M20 4v5h-5"/><path d="M4 12a8 8 0 0 1 13.66-5.66L20 9 M20 4v5h-5" transform="rotate(180 12 12)"/></>,
  settings: <><path d="M4 7h16 M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/></>,
  document: <path d="M4 3h12l4 4v14H4z M16 3v5h4 M8 12h8 M8 16h5"/>,
  people: <><circle cx="8" cy="7" r="3"/><path d="M2 21v-3a6 6 0 0 1 12 0v3 M16 4a3 3 0 0 1 0 6 M17 14a5 5 0 0 1 5 5v2"/></>,
  child: <><circle cx="12" cy="9" r="5"/><path d="M10 4c0-2 3-2 3 0 M10 9h.01 M14 9h.01 M10 11c1 1 3 1 4 0 M5 21v-1a7 7 0 0 1 14 0v1"/></>,
  adult: <><circle cx="12" cy="6" r="3"/><path d="M5 21v-3a7 7 0 0 1 14 0v3 M9 14l3 3 3-3"/></>,
  message: <path d="M4 4h16v12H9l-5 4z M8 8h8 M8 12h5"/>,
  edit: <path d="m15 4 5 5 M4 20l5-1L21 7l-4-4L5 15z"/>,
  filter: <path d="M4 4h16l-6 7v8l-4 2V11z"/>,
  chart: <path d="M4 19V9h4v10 M12 19V4h4v15 M2 21h20"/>,
  book: <path d="M12 21V5 M12 5C9 2 5 3 2 4v15c3-1 7-2 10 1 3-3 7-2 10-1V4c-3-1-7-2-10 1"/>,
  external: <path d="M14 3h7v7 M21 3 11 13 M10 5H4v16h16v-6"/>,
  chevron: <path d="m7 10 5 5 5-5"/>,
  check: <path d="m5 12 4 4L19 6"/>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3 M12 14v3"/></>,
  alert: <><circle cx="12" cy="12" r="9"/><path d="M12 7v6 M12 17h.01"/></>,
  grid: <path d="M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z"/>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4 M17 3v4 M3 11h18 M7 15h3 M14 15h3"/></>,
  shield: <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z m-4 9 3 3 5-6"/>,
  database: <><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 4 18 4 18 0V5 M3 12c0 4 18 4 18 0"/></>,
  cloud: <path d="M7 19h11a4 4 0 0 0 0-8h-1a6 6 0 0 0-12-1 4.5 4.5 0 0 0 2 9Z"/>,
  code: <path d="m7 6-5 6 5 6 M17 6l5 6-5 6 M14 3l-4 18"/>,
  flow: <><rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/><path d="M9 6h9v9 M6 9v9h9"/></>,
  processor: <><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 3v3 M15 3v3 M9 18v3 M15 18v3 M3 9h3 M3 15h3 M18 9h3 M18 15h3 M10 10h4v4h-4z"/></>,
  globe: <><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></>,
} satisfies Record<string, ReactNode>;
export type AdminIconName = keyof typeof shapes;

/** Decorative: the surrounding control or text supplies the accessible name. */
export function AdminIcon({ name, className, tone }: { name: AdminIconName; className?: string; tone?: AdminTone }) {
  return <svg data-admin-tone={tone} className={className} viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{shapes[name]}</svg>;
}
