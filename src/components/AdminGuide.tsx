import type { ReactNode } from "react";
import styles from "./admin-guide.module.css";

/** Short orientation shared by admin screens; actions keep their existing forms. */
export function AdminIntro({ title, description, eyebrow = "운영 안내", children }: {
  title: string; description: string; eyebrow?: string; children?: ReactNode;
}) {
  return <header className={styles.intro}>
    <p className={styles.eyebrow}>{eyebrow}</p>
    <h2>{title}</h2>
    <p className={styles.description}>{description}</p>
    {children}
  </header>;
}

export function AdminSteps({ steps, label = "사용 순서" }: {
  steps: readonly { title: string; description: string }[]; label?: string;
}) {
  return <ol className={styles.steps} aria-label={label}>
    {steps.map((step, index) => <li key={step.title}>
      <span className={styles.number} aria-hidden="true">{index + 1}</span>
      <div><strong>{step.title}</strong><p>{step.description}</p></div>
    </li>)}
  </ol>;
}

/** Native disclosure keeps editors mounted, so closing it never clears a draft. */
export function AdminTool({ id, title, description, tag, children }: {
  id: string; title: string; description: string; tag: string; children: ReactNode;
}) {
  return <details className={styles.tool} data-admin-tool={id}>
    <summary>
      <span className={styles.toolCopy}><span className={styles.tag}>{tag}</span>
        <strong>{title}</strong><span className={styles.description}>{description}</span>
      </span>
      <span className={styles.toggle} aria-hidden="true"><span className={styles.closed}>열기</span><span className={styles.open}>접기</span><span className={styles.chevron}>⌄</span></span>
    </summary>
    <div className={styles.toolBody}>{children}</div>
  </details>;
}
