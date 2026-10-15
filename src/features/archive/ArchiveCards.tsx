import { GlassPanel } from "../../components/glass/GlassPanel";
import { Link } from "react-router-dom";
import { AdminIcon } from "../../components/AdminIcon";
import { AdminTooltip } from "../../components/AdminHelp";
import type { ArchiveItem } from "../../../shared/api/archive";
import styles from "./archive.module.css";

export function ArchiveCards({ items, compact = false, iconActions = false, onNavigate }: { items: ArchiveItem[]; compact?: boolean; iconActions?: boolean; onNavigate?: () => void }) {
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
      return compact ? <li className={styles.card} key={item.slug} data-testid="archive-card">{content}</li> : <GlassPanel as="li" className={styles.card} key={item.slug} data-testid="archive-card">{content}</GlassPanel>;
    })}
  </ol>;
}
