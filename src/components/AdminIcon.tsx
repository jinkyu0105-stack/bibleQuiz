import type { ReactNode } from "react";
import type { AdminTone } from "../config/admin-help";

// Shared line icons extend the existing admin navigation's stroke and proportions.
const shapes = {
  document: <path d="M4 3h12l4 4v14H4z M16 3v5h4 M8 12h8 M8 16h5"/>,
  people: <><circle cx="8" cy="7" r="3"/><path d="M2 21v-3a6 6 0 0 1 12 0v3 M16 4a3 3 0 0 1 0 6 M17 14a5 5 0 0 1 5 5v2"/></>,
  message: <path d="M4 4h16v12H9l-5 4z M8 8h8 M8 12h5"/>,
  edit: <path d="m15 4 5 5 M4 20l5-1L21 7l-4-4L5 15z"/>,
  filter: <path d="M4 4h16l-6 7v8l-4 2V11z"/>,
  chart: <path d="M4 19V9h4v10 M12 19V4h4v15 M2 21h20"/>,
  book: <path d="M12 21V5 M12 5C9 2 5 3 2 4v15c3-1 7-2 10 1 3-3 7-2 10-1V4c-3-1-7-2-10 1"/>,
  external: <path d="M14 3h7v7 M21 3 11 13 M10 5H4v16h16v-6"/>,
  chevron: <path d="m7 10 5 5 5-5"/>,
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

/** Decorative: the neighbouring text always supplies the accessible name. */
export function AdminIcon({ name, className, tone }: { name: AdminIconName; className?: string; tone?: AdminTone }) {
  return <svg data-admin-tone={tone} className={className} viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{shapes[name]}</svg>;
}
