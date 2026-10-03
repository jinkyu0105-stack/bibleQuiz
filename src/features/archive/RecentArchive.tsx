import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { parseArchiveQuery, type ArchivePage } from "../../../shared/api/archive";
import { fetchArchive } from "./api";
import { ArchiveCards } from "./ArchiveCards";
import styles from "./archive.module.css";

export function RecentArchive() {
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
  return <section className={styles.recent} aria-labelledby="recent-archive-heading">
    <div className={styles.heading}><h2 id="recent-archive-heading">지난 퀴즈</h2><Link className="text-link" to="/archive">지난 퀴즈 전체 보기 <span aria-hidden="true">→</span></Link></div>
    {page ? page.items.length ? <ArchiveCards items={page.items} compact /> : <p>아직 지난 퀴즈가 없습니다.</p> : error ? <p role="status">지난 퀴즈를 불러오지 못했습니다. <button className="text-link" type="button" onClick={() => { setError(false); setAttempt((value) => value + 1); }}>지난 퀴즈 다시 시도</button></p> : <p role="status">지난 퀴즈를 불러오고 있습니다.</p>}
  </section>;
}
