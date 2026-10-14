import type { WeeklyQuiz } from "../../../shared/api/admin-weekly";
import { AdminTooltip } from "../../components/AdminHelp";
import { AdminIcon, type AdminIconName } from "../../components/AdminIcon";
import styles from "./weekly.module.css";

function InfoIcon({ label, detail, icon, tone = "action" }: { label: string; detail: string; icon: AdminIconName; tone?: string }) {
  return <AdminTooltip label={detail}>{descriptionId => <button type="button" className={styles.metadataIcon} aria-label={label} aria-describedby={descriptionId} popoverTarget={descriptionId} popoverTargetAction="show" data-tone={tone}><AdminIcon name={icon}/></button>}</AdminTooltip>;
}

const savedTime = (value: string) => new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });

export function WorkspaceMeta({ quiz, due }: { quiz: WeeklyQuiz; due: string | null }) {
  const state = quiz.expired ? { label: "본문이 정리된 초안", detail: "초안 본문이 정리되었습니다. 기존 발행 기록과 비용은 보존됩니다.", icon: "database" as const, tone: "neutral" }
    : quiz.withdrawn ? { label: "발행을 취소한 퀴즈", detail: "공개를 취소하고 검수를 기다리는 퀴즈입니다. 발행 당시 자료는 보존됩니다.", icon: "document" as const, tone: "attention" }
    : quiz.status === "archived" ? { label: "마감된 퀴즈", detail: "참여 접수가 끝난 퀴즈입니다. 기존 답안과 결과를 확인할 수 있습니다.", icon: "check" as const, tone: "neutral" }
    : quiz.status === "published" ? { label: "발행된 퀴즈", detail: "발행된 퀴즈입니다. 공개 화면과 참여 기록을 확인할 수 있습니다.", icon: "globe" as const, tone: "success" }
    : { label: "작성 중인 퀴즈", detail: "아직 공개되지 않은 초안입니다. 여섯 단계를 확인한 뒤 발행할 수 있습니다.", icon: "edit" as const, tone: "action" };
  const retention = quiz.expired ? "초안 본문 정리 완료." : due ? `초안 본문 정리 예정: ${savedTime(due)} (한국 시간).` : "초안 본문 정리 일정은 수정·보관 도구의 초안 보관 현황에서 확인하세요.";
  const weekday = new Date(`${quiz.sermonDate}T12:00:00+09:00`).toLocaleDateString("ko-KR", { weekday: "short", timeZone: "Asia/Seoul" });
  return <div className={styles.workspaceMeta}>
    <span className={styles.sermonDate}><AdminIcon name="calendar"/><span className="sr-only">설교일 </span><time dateTime={quiz.sermonDate}>{quiz.sermonDate.replaceAll("-", ".")}</time><small>{weekday}</small></span>
    <InfoIcon label={state.label} detail={`${state.label}. ${state.detail}`} icon={state.icon} tone={state.tone}/>
    <InfoIcon label="저장·초안 보관 정보" detail={`마지막 저장: ${savedTime(quiz.updatedAt)} (한국 시간). ${retention}`} icon="database"/>
  </div>;
}
