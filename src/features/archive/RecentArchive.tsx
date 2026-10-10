import { GlassPanel } from "../../components/glass/GlassPanel";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { parseArchiveQuery, type ArchivePage } from "../../../shared/api/archive";
import { fetchArchive } from "./api";
import { ArchiveCards } from "./ArchiveCards";
import styles from "./archive.module.css";

export function RecentArchive({ landing = false }: { landing?: boolean }) {
  const [page, setPage] = useState<ArchivePage | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    void fetchArchive(parseArchiveQuery(new URLSearchParams("limit=3")), abort.signal).then((data) => {
      if (!abort.signal.aborted) setPage(data);
    }).catch(() => { if (!abort.signal.aborted) setError(true); });
    return () => abort.abort();
  }, [attempt]);
  return <section id={landing ? "archive" : undefined} className={landing ? "archive-section" : styles.recent} aria-labelledby="recent-archive-heading">
    {landing && <div className="archive-heading"><p className="eyebrow">지난 퀴즈</p><h2>다시 꺼내 보는<br />한 주의 말씀.</h2><p>마음에 머문 말씀은<br />언제든 다시 만나도 좋으니까요.</p></div>}
    <GlassPanel as="div" className={landing ? "archive-list" : "recent-archive-panel"}>
    <div className={styles.heading}><h2 id="recent-archive-heading">지난 퀴즈</h2><Link className="text-link" to="/archive">지난 퀴즈 전체 보기 <span aria-hidden="true">→</span></Link></div>
    {page ? page.items.length ? <ArchiveCards items={page.items} compact /> : <p>아직 지난 퀴즈가 없습니다.</p> : error ? <p role="status">지난 퀴즈를 불러오지 못했습니다. <button className="text-link" type="button" onClick={() => { setError(false); setAttempt((value) => value + 1); }}>지난 퀴즈 다시 시도</button></p> : <p role="status">지난 퀴즈를 불러오고 있습니다.</p>}
    </GlassPanel>
  </section>;
}
