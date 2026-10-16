import { AdminIcon } from "../../components/AdminIcon";
import { Tooltip } from "../../components/Tooltip";
import "./quiz-reader.css";
import { QuizShare } from "./QuizShare";
import type { Difficulty } from "../../../shared/api/public-quiz";

export type SermonHeroProps = {
  difficulty: Difficulty;
  slug?: string;
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
        <Tooltip label={`설교일 · ${dateLabel}`}>{id => <button type="button" className="quiz-icon-button" aria-label="설교일" aria-describedby={id} popoverTarget={id} popoverTargetAction="show"><AdminIcon name="calendar"/></button>}</Tooltip>
        {props.slug && <QuizShare key={`${props.slug}:${props.difficulty}`} slug={props.slug} difficulty={props.difficulty} title={props.title}/>}
      </div>
    </div>
    <p className="quiz-scripture"><code>{props.reference}</code></p>
  </section>;
}
