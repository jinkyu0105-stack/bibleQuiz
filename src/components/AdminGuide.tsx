import { AdminLabel, AdminEmoji, AdminConcepts, GuideText } from "./AdminHelp";
import { AdminIcon } from "./AdminIcon";
import { AdminScreenshots } from "./AdminScreenshots";
import { adminTextTones, type AdminTerm } from "../config/admin-help";
import type { AdminScreenshotId } from "../config/admin-screenshots";
import { useEffect, useRef, type ReactNode } from "react";
import styles from "./admin-guide.module.css";

/** Short orientation shared by admin screens; actions keep their existing forms. */
export function AdminIntro({ title, description, eyebrow, children, terms, screenshots }: {
  title: string; description: string; eyebrow?: string; children?: ReactNode; terms?: readonly AdminTerm[]; screenshots?: readonly AdminScreenshotId[];
}) {
  return <header className={styles.intro}>
    {eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}
    <h2><AdminLabel text={title}/></h2>
    <p className={styles.description}><GuideText text={description}/></p>
    {(terms || screenshots) && <div className={styles.quickHelp}>
      {terms && <AdminConcepts terms={terms}/>}
      {screenshots && <AdminScreenshots ids={screenshots} compact/>}
    </div>}
    {children}
  </header>;
}

export function AdminSteps({ steps, label = "사용 순서" }: {
  steps: readonly { title: string; description: string }[]; label?: string;
}) {
  return <details className={styles.help}><summary><span><AdminEmoji>📖</AdminEmoji>사용 방법</span><span aria-hidden="true">＋</span></summary><ol className={styles.steps} aria-label={label}>
    {steps.map((step, index) => <li key={step.title} data-admin-tone={adminTextTones[step.title] ?? "action"}>
      <span className={styles.number} aria-hidden="true">{index + 1}</span>
      <div><strong><AdminLabel text={step.title}/></strong><p><GuideText text={step.description}/></p></div>
    </li>)}
  </ol></details>;
}

/** Native disclosure keeps editors mounted, so closing it never clears a draft. */
export function AdminTool({ id, title, description, tag, children }: {
  id: string; title: string; description: string; tag: string; children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const reveal = () => {
      if (window.location.hash === `#${id}` && ref.current) {
        ref.current.open = true;
        ref.current.scrollIntoView({ block: "start" });
      }
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, [id]);
  return <details ref={ref} id={id} className={styles.tool} data-admin-tool={id}>
    <summary>
      <span className={styles.toolCopy}><span className={styles.tag}>{tag}</span>
        <strong><AdminLabel text={title}/></strong><span className={styles.description}>{description}</span>
      </span>
      <span className={styles.toggle} aria-hidden="true"><AdminIcon name="chevron" className={styles.chevron ?? ""}/></span>
    </summary>
    <div className={styles.toolBody}>{children}</div>
  </details>;
}
