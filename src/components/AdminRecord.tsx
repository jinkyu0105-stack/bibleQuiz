import { useId, useState, type ReactNode } from "react";
import { AdminLabel } from "./AdminHelp";
import { AdminIcon } from "./AdminIcon";
import type { AdminTone } from "../config/admin-help";
import styles from "./admin-record.module.css";

/** Flat bulletin-board rows share one reading order and a split category/status badge. */
export function AdminRecord({ title, label, meta, status, tone = "success", children }: {
  title: string; label: string; meta: ReactNode; status: string; tone?: AdminTone; children: ReactNode;
}) {
  return <li className={styles.record} data-admin-record>
    <header className={styles.header}><h3>{title}</h3>
      <span className={styles.badge}><span className={styles.label}>{label}</span><span className={styles.status} data-admin-tone={tone}>{status}</span></span>
    </header>
    <div className={styles.meta}>{meta}</div>
    <div className={styles.body}>{children}</div>
  </li>;
}

/** One tool opens at a time; hidden panels stay mounted to preserve unfinished forms. */
export function AdminRecordPanels({ panels }: { panels: readonly { id: string; title: string; content: ReactNode }[] }) {
  const prefix = useId();
  const [active, setActive] = useState<string | null>(null);
  return <div className={styles.panels}>
    <div className={styles.panelControls}>
      {panels.map(panel => <button key={panel.id} id={`${prefix}-${panel.id}-button`} type="button" aria-expanded={active === panel.id} aria-controls={`${prefix}-${panel.id}`} onClick={() => setActive(active === panel.id ? null : panel.id)}><AdminLabel text={panel.title}/><AdminIcon name="chevron"/></button>)}
    </div>
    {panels.map(panel => <div key={panel.id} id={`${prefix}-${panel.id}`} role="region" aria-labelledby={`${prefix}-${panel.id}-button`} className={styles.panel} hidden={active !== panel.id}>{panel.content}</div>)}
  </div>;
}
