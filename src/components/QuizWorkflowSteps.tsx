import { AdminLabel } from './AdminHelp';
import { AdminIcon } from './AdminIcon';
import styles from './quiz-workflow-steps.module.css';
import { quizSteps } from "./quiz-workflow-steps";
import type { ReactNode } from "react";
import { HelpButton } from "./HelpButton";
const shortTitles = ["준비", "정리", "검토", "구성", "점검", "공개"];
export function QuizWorkflowSteps({ current, available, reasons, onSelect, footer }: {
  current: number; available: readonly boolean[]; reasons: readonly string[]; onSelect: (step: number) => void;
  footer?: ReactNode;
}) {
  return <section className={styles.chassis} aria-label="퀴즈 제작 조작판"><nav aria-label="초안 편집 단계"><ol className={styles.keys} aria-label="주간 발행 6단계">
    {quizSteps.map((item, index) => <li key={item.title}><button type="button" disabled={!available[index]}
      aria-label={`${index + 1}단계 ${item.title}${!available[index] ? " · 대기" : ""}`}
      aria-current={current === index + 1 ? 'step' : undefined} data-recessed={index + 1 < current || undefined}
      aria-describedby={!available[index] ? `step-lock-${index}` : undefined} onClick={() => onSelect(index + 1)}>
      <span className={styles.number} aria-hidden="true">{index + 1}</span>
      <span className={styles.title} aria-hidden="true">{!available[index] && <AdminIcon name="lock"/>}<span>{item.title}</span><b>{shortTitles[index]}</b></span>
      <small aria-hidden="true">{!available[index] ? '대기' : current === index + 1 ? '현재' : index + 1 < current ? '이전' : '이동'}</small>
    </button>{!available[index] && <span id={`step-lock-${index}`} className="sr-only">{reasons[index]}</span>}</li>)}
  </ol></nav>{footer && <div className={styles.footer}>{footer}</div>}</section>;
}
export function QuizStageHeading({ step, id, onHelp }: { step: number; id?: string; onHelp?: (() => void) | undefined }) {
  const item = quizSteps[step - 1] ?? quizSteps[0];
  return <header className={styles.stageHeading}><div><h2 id={id}><AdminLabel text={item.title}/></h2>{onHelp && <HelpButton label={`${item.title} 도움말`} aria-haspopup="dialog" onClick={onHelp}/>}</div><p>{item.description}</p></header>;
}
