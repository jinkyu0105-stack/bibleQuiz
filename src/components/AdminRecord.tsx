import type { ReactNode } from "react";
import { AdminIcon, type AdminIconName } from "./AdminIcon";
import type { AdminTone } from "../config/admin-help";
import styles from "./admin-record.module.css";

/** Native disclosure keeps answers and unfinished forms mounted when a row closes. */
export function AdminRecord({ title, label, meta, status, tone = "success", icon = "message", preview, children }: {
  title: string; label: string; meta: ReactNode; status: string; tone?: AdminTone;
  icon?: AdminIconName; preview?: string; children: ReactNode;
}) {
  return <li className={styles.record} data-admin-record>
    <details className={styles.disclosure}>
      <summary aria-label={`${title} 상세 보기`}>
        <span className={styles.avatar} aria-hidden="true"><AdminIcon name={icon}/></span>
        <span className={styles.identity}>
          <span className={styles.title} role="heading" aria-level={3}>{title}</span>
          <span className={styles.meta}>{meta}</span>
        </span>
        <span className={styles.badge}><span className={styles.label}>{label}</span><span className={styles.status} data-admin-tone={tone}>{status}</span></span>
        <span className={styles.toggle} aria-hidden="true"><AdminIcon name="chevron"/></span>
        {preview && <span className={styles.preview}>{preview}</span>}
      </summary>
      <div className={styles.body}>{children}</div>
    </details>
  </li>;
}
