import type { ReactNode } from "react";
import styles from "./admin-record.module.css";

/** A shared reading order for inbox messages and participant records. */
export function AdminRecord({ title, label, meta, status, attention = false, children }: {
  title: string; label: string; meta: ReactNode; status: string; attention?: boolean; children: ReactNode;
}) {
  return <li className={styles.record}>
    <header className={styles.header}><div><p className={styles.label}>{label}</p><h3>{title}</h3></div>
      <span className={styles.status} data-attention={attention || undefined}>{status}</span>
    </header>
    <div className={styles.meta}>{meta}</div>
    <div className={styles.body}>{children}</div>
  </li>;
}
