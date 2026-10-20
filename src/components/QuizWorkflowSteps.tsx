import { AdminLabel } from './AdminHelp';
import { AdminIcon } from './AdminIcon';
import styles from './quiz-workflow-steps.module.css';
import { quizSteps } from "./quiz-workflow-steps";
export function QuizWorkflowSteps({ current, available, reasons, onSelect }: {
  current: number; available: readonly boolean[]; reasons: readonly string[]; onSelect: (step: number) => void;
}) {
  return <nav className={styles.chassis} aria-label="초안 편집 단계"><ol className={styles.keys} aria-label="주간 발행 6단계">
    {quizSteps.map((item, index) => <li key={item.title}><button type="button" disabled={!available[index]}
      aria-current={current === index + 1 ? 'step' : undefined} data-recessed={index + 1 < current || undefined}
      aria-describedby={!available[index] ? `step-lock-${index}` : undefined} onClick={() => onSelect(index + 1)}>
      <span className={styles.number} aria-hidden="true">{index + 1}</span><span className={styles.title}>{item.title}</span>
      <small>{!available[index] ? <><AdminIcon name="lock"/>대기</> : current === index + 1 ? '현재 단계' : index + 1 < current ? '이전 단계' : '이동 가능'}</small>
    </button>{!available[index] && <span id={`step-lock-${index}`} className="sr-only">{reasons[index]}</span>}</li>)}
  </ol></nav>;
}
export function QuizStageHeading({ step, id }: { step: number; id?: string }) {
  const item = quizSteps[step - 1] ?? quizSteps[0];
  return <header className={styles.stageHeading}><h2 id={id}><AdminLabel text={item.title}/></h2><p>{item.description}</p></header>;
}
