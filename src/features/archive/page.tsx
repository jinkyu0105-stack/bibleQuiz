import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { archiveFilterKey, parseArchiveQuery, type ArchivePage, type ArchiveQuery } from "../../../shared/api/archive";
import { appendArchive, ArchiveLoadError, archiveSearch, fetchArchive, parseArchiveLocation, restoreArchive } from "./api";
import { ArchiveCards } from "./ArchiveCards";
import { readArchiveHistory, writeArchiveHistory } from "./history";
import { GlassPanel } from "../../components/glass/GlassPanel";
import { AdminIcon } from "../../components/AdminIcon";
import { Tooltip } from "../../components/Tooltip";
import styles from "./archive.module.css";

export function Component() {
  const location = useLocation();
  const query = useMemo(() => { try { return parseArchiveLocation(location.search); } catch { return null; } }, [location.search]);
  if (!query) return <GlassPanel className={`${styles.page} archive-browser`} surface="standard"><header className={styles.archiveHeading}><AdminIcon name="book"/><h2>지난 퀴즈</h2></header><div className={styles.state} role="alert"><AdminIcon name="alert"/><p>검색 조건이 올바르지 않습니다.</p><Link className="text-link" to="/archive">검색 조건 지우기</Link></div></GlassPanel>;
  return <ArchiveResults key={location.key} query={query} search={location.search} />;
}

type View = { state: "loading" } | { state: "error"; invalid: boolean } | { state: "ready"; page: ArchivePage };
function ArchiveResults({ query, search }: { query: ArchiveQuery; search: string }) {
  const navigate = useNavigate();
  const filter = archiveFilterKey(query);
  const [saved] = useState(() => readArchiveHistory(window.history.state, filter));
  const [view, setView] = useState<View>({ state: "loading" });
  const [retry, setRetry] = useState(0);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreError, setMoreError] = useState<"invalid" | "network" | null>(null);
  const [formError, setFormError] = useState(false);
  const [q, setQ] = useState(query.q);
  const controller = useRef<AbortController | null>(null);
  const restoringScroll = useRef<number | null>(saved?.scrollY ?? 0);
  const pendingFocus = useRef<string | null>(null);
  const count = view.state === "ready" ? view.page.items.length : 0;
  const savePosition = useCallback(() => {
    if (restoringScroll.current === null && window.location.pathname === "/archive" && window.location.search === search) writeArchiveHistory(filter, count, window.scrollY);
  }, [filter, count, search]);

  useEffect(() => {
    const abort = new AbortController(); controller.current = abort;
    void restoreArchive(query, saved?.count ?? 12, abort.signal).then((page) => {
      if (!abort.signal.aborted) setView({ state: "ready", page });
    }).catch((error: unknown) => {
      if (!abort.signal.aborted) setView({ state: "error", invalid: error instanceof ArchiveLoadError && error.invalidFilter });
    });
    return () => abort.abort();
  }, [query, saved, retry]);

  useEffect(() => {
    if (view.state !== "ready") return;
    const frame = requestAnimationFrame(() => {
      if (restoringScroll.current !== null) {
        window.scrollTo({ top: restoringScroll.current, behavior: "instant" }); restoringScroll.current = null;
      }
      if (pendingFocus.current) { document.getElementById(pendingFocus.current)?.focus(); pendingFocus.current = null; }
      savePosition();
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => { clearTimeout(timer); timer = setTimeout(savePosition, 150); };
    const previousRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", savePosition);
    // Save before any router navigation, not in cleanup (which may already be on another history entry).
    document.addEventListener("click", savePosition, true);
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); window.removeEventListener("scroll", onScroll); window.removeEventListener("pagehide", savePosition); document.removeEventListener("click", savePosition, true); window.history.scrollRestoration = previousRestoration; };
  }, [view, savePosition]);

  function changeFilters(year: string, month: string, event?: FormEvent) {
    event?.preventDefault();
    const params = new URLSearchParams();
    if (q) params.set("q", q); if (year) params.set("year", year); if (month) params.set("month", month);
    try {
      const next = parseArchiveQuery(params);
      setFormError(false); savePosition();
      if (archiveFilterKey(next) !== filter) void navigate(`/archive${archiveSearch(next) ? `?${archiveSearch(next)}` : ""}`);
      else setQ(next.q);
    } catch { setFormError(true); }
  }
  async function more() {
    if (view.state !== "ready" || !view.page.nextCursor || moreBusy || !controller.current) return;
    const signal = controller.current.signal;
    setMoreBusy(true); setMoreError(null);
    try {
      const next = await fetchArchive({ ...query, cursor: view.page.nextCursor }, signal);
      const page = appendArchive(view.page, next);
      if (!signal.aborted) { pendingFocus.current = next.items[0] ? `archive-${next.items[0].slug}` : null; setView({ state: "ready", page }); }
    } catch (error) {
      if (!signal.aborted) setMoreError(error instanceof ArchiveLoadError && error.invalidFilter ? "invalid" : "network");
    } finally { if (!signal.aborted) setMoreBusy(false); }
  }
  const years = view.state === "ready" ? view.page.availableYears ?? [] : [];
  const months = view.state === "ready" ? view.page.availableMonths ?? [] : [];
  const hasFilters = Boolean(query.q || query.year !== null || query.month !== null);
  return <GlassPanel className={`${styles.page} archive-browser`} surface="standard" aria-labelledby="archive-heading">
    <header className={styles.archiveHeading}>
      <span className={styles.headingIcon}><AdminIcon name="book"/></span>
      <h2 id="archive-heading">지난 퀴즈</h2>
    </header>
    <aside className={styles.practiceNote}><AdminIcon name="check"/><p><strong>부담 없이 다시 풀어보세요.</strong> 지난 퀴즈는 새 참여 기록을 남기지 않습니다.</p></aside>
    <form className={styles.filters} role="search" aria-label="지난 퀴즈 검색" onSubmit={(event) => changeFilters(query.year === null ? "" : String(query.year).padStart(4, "0"), query.month === null ? "" : String(query.month), event)}>
      <div className={styles.searchField}>
        <label className="sr-only" htmlFor="archive-search">설교 제목 · 성경 장절</label>
        <input id="archive-search" type="search" value={q} onChange={(event) => setQ(event.target.value)} placeholder="설교 제목 · 성경 장절" aria-invalid={formError || undefined} aria-describedby={formError ? "archive-form-error" : undefined} />
        <Tooltip label="입력한 제목이나 장절로 검색">{descriptionId => <button className={styles.searchButton} type="submit" aria-label="검색" aria-describedby={descriptionId}><AdminIcon name="search"/></button>}</Tooltip>
      </div>
      <div className={styles.dateFilters}>
        <label><span className="sr-only">연도</span><select value={query.year === null ? "" : String(query.year).padStart(4, "0")} disabled={view.state !== "ready"} onChange={(event) => changeFilters(event.target.value, query.month === null ? "" : String(query.month))}>
          <option value="">모든 연도</option>{query.year !== null && !years.includes(query.year) && <option value={String(query.year).padStart(4, "0")} disabled>{query.year}년 (결과 없음)</option>}{years.map((year) => <option value={String(year).padStart(4, "0")} key={year}>{year}년</option>)}
        </select></label>
        <label><span className="sr-only">월</span><select value={query.month ?? ""} disabled={view.state !== "ready"} onChange={(event) => changeFilters(query.year === null ? "" : String(query.year).padStart(4, "0"), event.target.value)}>
          <option value="">모든 월</option>{query.month !== null && !months.includes(query.month) && <option value={query.month} disabled>{query.month}월 (결과 없음)</option>}{months.map((month) => <option value={month} key={month}>{month}월</option>)}
        </select></label>
      </div>
    </form>
    {formError && <p className={styles.alert} role="alert" id="archive-form-error"><AdminIcon name="alert"/>검색어는 60자 이내로 입력해 주세요.</p>}
    {hasFilters && <div className={styles.filterSummary}>
      <div><span className="sr-only">검색 조건: </span>{query.q && <code>“{query.q}”</code>}{query.year !== null && <code>{query.year}년</code>}{query.month !== null && <code>{query.month}월</code>}</div>
      <Tooltip label="검색어와 날짜 조건 지우기"><Link className={styles.reset} to="/archive" aria-label="검색 조건 지우기"><AdminIcon name="refresh"/><span>초기화</span></Link></Tooltip>
    </div>}
    {view.state === "loading" ? <div className={styles.state} role="status"><AdminIcon name="book"/><p>지난 퀴즈를 불러오고 있습니다.</p></div> : view.state === "error" ? <div className={styles.state} role="alert">
      <AdminIcon name="alert"/><h3>{view.invalid ? "검색 조건을 다시 확인해 주세요" : "지난 퀴즈를 불러오지 못했습니다"}</h3><p>입력한 검색 조건은 그대로 남아 있습니다.</p>
      {view.invalid ? <Link className="text-link" to="/archive">검색 조건 지우기</Link> : <button className="primary-button" type="button" onClick={() => { setView({ state: "loading" }); setRetry((value) => value + 1); }}>다시 시도</button>}
    </div> : <>
      <div className={styles.listHeading}><p className={styles.resultCount} role="status" aria-live="polite"><strong>{view.page.items.length}</strong>개 표시</p><span>최근 설교 순</span></div>
      {count ? <ArchiveCards items={view.page.items} onNavigate={savePosition} /> : <div className={styles.state}><AdminIcon name="search"/><h3>찾는 지난 퀴즈가 없습니다</h3><p>{hasFilters ? "검색어나 날짜를 바꾸어 다시 찾아보세요." : "퀴즈 참여가 마감되면 이곳에서 다시 풀 수 있습니다."}</p></div>}
      {moreError && <p className={styles.alert} role="alert">{moreError === "invalid" ? "목록의 연결 정보가 변경되었습니다. 처음부터 다시 불러와 주세요." : "다음 목록을 불러오지 못했습니다. 기존 목록은 남아 있습니다."}</p>}
      {moreError === "invalid" ? <button className="primary-button" type="button" onClick={() => { restoringScroll.current = 0; void navigate(`/archive${search}`, { replace: true }); }}>목록 처음부터 다시 불러오기</button> : view.page.nextCursor && <button className={styles.more} type="button" onClick={() => void more()} disabled={moreBusy} aria-busy={moreBusy}><AdminIcon name={moreError ? "refresh" : "chevron"}/>{moreBusy ? "불러오는 중…" : moreError ? "더 보기 다시 시도" : "더 보기"}</button>}
    </>}
  </GlassPanel>;
}
