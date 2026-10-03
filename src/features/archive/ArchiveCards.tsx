import { Link } from "react-router-dom";
import type { ArchiveItem } from "../../../shared/api/archive";
import styles from "./archive.module.css";

export function ArchiveCards({ items, compact = false, onNavigate }: { items: ArchiveItem[]; compact?: boolean; onNavigate?: () => void }) {
  return <ol className={`${styles.cards} ${compact ? styles.compact : ""}`} aria-label="지난 퀴즈 목록">
    {items.map((item, index) => <li className={styles.card} key={item.slug} data-testid="archive-card">
      <div className={styles.cardBody}>
        <p className={styles.date}><time dateTime={item.sermonDate}>{item.sermonDate.replaceAll("-", ". ")}</time>{index === 0 && <span>가장 최근</span>}</p>
        <h3 id={`archive-${item.slug}`} tabIndex={-1}>{item.title}</h3>
        <p className={styles.reference}>{item.bibleReferenceLabel}</p>
      </div>
      <div className={styles.actions}>{item.availableDifficulties.map((level) => <Link key={level} to={`/quiz/${item.slug}?level=${level}`} onClick={onNavigate}>
        {level === "child" ? "어린이용" : "장년용"}<span aria-hidden="true">↗</span><span className="sr-only"> - {item.title} 풀기</span>
      </Link>)}</div>
    </li>)}
  </ol>;
}
