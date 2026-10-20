import type { ReactNode } from "react";
import { AdminIcon, type AdminIconName } from "../../components/AdminIcon";
import styles from "./admin-sermon-input.module.css";

/** One task's heading, fields and actions stay together on the workflow sheet. */
export function WorkflowSection({ title, icon, label, status, tone = "action", children }: {
  title: string;
  icon: AdminIconName;
  label?: string;
  status?: string;
  tone?: "action" | "success" | "attention";
  children: ReactNode;
}) {
  return <section className={`${styles.metadataSection} ${styles.workflowSection}`}
    aria-label={label ?? title} data-workflow-section data-tone={tone}>
    <h4><AdminIcon name={icon}/>{title}{status && <span className={styles.sectionStatus}>{status}</span>}</h4>
    <div className={styles.metadataSectionBody}>{children}</div>
  </section>;
}
