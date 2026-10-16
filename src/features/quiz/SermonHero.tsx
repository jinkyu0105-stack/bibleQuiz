import { AdminIcon } from "../../components/AdminIcon";
import { Tooltip } from "../../components/Tooltip";
import "./quiz-reader.css";
import { Link } from "react-router-dom";
import type { Difficulty } from "../../../shared/api/public-quiz";

export type SermonHeroProps = {
  difficulty: Difficulty;
  title: string;
  date: string;
  reference: string;
  translation: string;
  readingUrl: string;
  excerpt?: string | undefined;
  desktopPath?: string | null | undefined;
  mobilePath?: string | null | undefined;
};

export function SermonHero(props: SermonHeroProps) {
  const dateLabel = new Intl.DateTimeFormat("ko-KR", { dateStyle: "full", timeZone: "Asia/Seoul" }).format(new Date(`${props.date}T00:00:00+09:00`));
  return <section className="sermon-header sky-quiz-heading" aria-labelledby="sermon-heading">
    <div className="quiz-title-row"><h2 id="sermon-heading">{props.title}</h2>
      <div className="quiz-meta-tools" aria-label="설교 정보">
        <Tooltip label="이번 주 말씀으로 돌아가기">{id => <Link className="quiz-icon-button quiz-back-icon" to="/#weekly" aria-label="이번 주 말씀으로 돌아가기" aria-describedby={id}><AdminIcon name="chevron"/></Link>}</Tooltip>
        <Tooltip label={`설교일 · ${dateLabel}`}>{id => <button type="button" className="quiz-icon-button" aria-label="설교일" aria-describedby={id} popoverTarget={id} popoverTargetAction="show"><AdminIcon name="calendar"/></button>}</Tooltip>
        <Tooltip label="대한성서공회에서 성경 읽기 · 새 창에서 장절을 선택해 주세요">{id => <a className="quiz-icon-button" href={props.readingUrl} target="_blank" rel="noreferrer" aria-label="대한성서공회에서 성경 읽기 (새 창)" aria-describedby={id}><AdminIcon name="book"/></a>}</Tooltip>
      </div>
    </div>
    <p className="quiz-scripture"><code>{props.reference}</code><span>{props.translation}</span></p>
  </section>;
}
