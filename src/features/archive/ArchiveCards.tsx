import { useState } from "react";
import { Link } from "react-router-dom";
import { AdminIcon } from "../../components/AdminIcon";
import { AdminTooltip } from "../../components/AdminHelp";
import { GlassArrowButton } from "../../components/glass/GlassArrowButton";
import type { ArchiveItem } from "../../../shared/api/archive";
import { QuizChoiceDialog } from "../../components/QuizChoiceDialog";
import { sermonWeekLabel } from "./sermon-week";
import styles from "./archive.module.css";

export function ArchiveCards({ items, compact = false, iconActions = false, onNavigate }: { items: ArchiveItem[]; compact?: boolean; iconActions?: boolean; onNavigate?: () => void }) {
  if (!compact) return <ArchiveRecords items={items} onNavigate={onNavigate}/>;
  return <ol className={`${styles.cards} ${compact ? styles.compact : ""} ${iconActions ? styles.homeCards : ""}`} aria-label="지난 퀴즈 목록">
    {items.map((item, index) => {
      if (iconActions) return <li className={styles.card} key={item.slug} data-testid="archive-card">
        <div className={styles.titleRow}>
          <h3 id={`archive-${item.slug}`} tabIndex={-1}>{item.title}</h3>
          <div className={styles.iconActions}>{item.availableDifficulties.map(level => <AdminTooltip key={level} label={`${level === "child" ? "어린이용" : "장년용"} 풀기`}>
            <Link to={`/quiz/${item.slug}?level=${level}`} onClick={onNavigate} aria-label={`${level === "child" ? "어린이용" : "장년용"} - ${item.title} 풀기`}><AdminIcon name={level}/></Link>
          </AdminTooltip>)}</div>
        </div>
        <div className={styles.homeMeta}><time dateTime={item.sermonDate}>{item.sermonDate.replaceAll("-", ". ")}</time><span>{item.bibleReferenceLabel}</span>{index === 0 && <span className={styles.latest}>가장 최근</span>}</div>
      </li>;
      const content = <>
      <div className={styles.cardBody}>
        <p className={styles.date}><time dateTime={item.sermonDate}>{item.sermonDate.replaceAll("-", ". ")}</time>{index === 0 && <span>가장 최근</span>}</p>
        <h3 id={`archive-${item.slug}`} tabIndex={-1}>{item.title}</h3>
        <p className={styles.reference}>{item.bibleReferenceLabel}</p>
      </div>
      <div className={styles.actions}>{item.availableDifficulties.map((level) => <Link key={level} to={`/quiz/${item.slug}?level=${level}`} onClick={onNavigate}>
        {level === "child" ? "어린이용" : "장년용"}<span aria-hidden="true">↗</span><span className="sr-only"> - {item.title} 풀기</span>
      </Link>)}</div>
    </>;
      return <li className={styles.card} key={item.slug} data-testid="archive-card">{content}</li>;
    })}
  </ol>;
}

/** One reading sheet for the full archive; the home excerpt keeps its own layout. */
function ArchiveRecords({ items, onNavigate }: { items: ArchiveItem[]; onNavigate: (() => void) | undefined }) {
  const [selected, setSelected] = useState<ArchiveItem | null>(null);
  return <><ol className={styles.records} aria-label="지난 퀴즈 목록">
    {items.map(item => <li className={styles.record} key={item.slug} data-testid="archive-card" data-glass-arrow-group>
      <time className={styles.calendarTile} dateTime={item.sermonDate} aria-label={`설교일 ${item.sermonDate}`}>
        <span>{item.sermonDate.slice(0, 4)}</span><strong>{Number(item.sermonDate.slice(5, 7))}<small> / </small>{Number(item.sermonDate.slice(8, 10))}</strong>
      </time>
      <div className={styles.recordBody}>
        <div className={styles.recordMeta}><span className={styles.weekLabel}>{sermonWeekLabel(item.sermonDate)}</span><span className={styles.monthlyTheme}>주제: {item.monthlyTheme || "미등록"}</span><time dateTime={item.sermonDate}>{item.sermonDate.replaceAll("-", ". ")}</time></div>
        <div className={styles.recordSummary}><h3 id={`archive-${item.slug}`} tabIndex={-1}>{item.title}</h3>
        <p className={styles.recordReference}><AdminIcon name="book"/><code>{item.bibleReferenceLabel}</code></p></div>
      </div>
      <GlassArrowButton decorative/>
      <button className={styles.recordOpen} type="button" aria-labelledby={`archive-${item.slug}`} aria-haspopup="dialog" aria-expanded={selected?.slug === item.slug} onClick={() => setSelected(item)}/>
    </li>)}
  </ol>
    <QuizChoiceDialog open={selected !== null} description={selected?.title ?? ""} choices={selected?.availableDifficulties.map(difficulty => ({ difficulty, to: `/quiz/${selected.slug}?level=${difficulty}` })) ?? []} onClose={() => setSelected(null)} onNavigate={onNavigate}/>

  </>;
}
