import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { archiveFilterKey, parseArchiveQuery, type ArchivePage, type ArchiveQuery } from "../../../shared/api/archive";
import { appendArchive, ArchiveLoadError, archiveSearch, fetchArchive, parseArchiveLocation, restoreArchive } from "./api";
import { ArchiveCards } from "./ArchiveCards";
import { readArchiveHistory, writeArchiveHistory } from "./history";
import styles from "./archive.module.css";

export function Component() {
  const location = useLocation();
  const query = useMemo(() => { try { return parseArchiveLocation(location.search); } catch { return null; } }, [location.search]);
  if (!query) return <section className={styles.page}><h2>지난 퀴즈</h2><p role="alert">검색 조건이 올바르지 않습니다.</p><Link className="text-link" to="/archive">검색 조건 지우기</Link></section>;
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
  return <section className={styles.page} aria-labelledby="archive-heading">
    <header className={styles.heading}><div><p className="eyebrow">말씀을 다시 만나는 시간</p><h2 id="archive-heading">지난 퀴즈</h2></div><p>함께 나눈 말씀을 찾아<br />원하는 난이도로 다시 풀어보세요.</p></header>
    <form className={styles.filters} role="search" aria-label="지난 퀴즈 검색" onSubmit={(event) => changeFilters(query.year === null ? "" : String(query.year).padStart(4, "0"), query.month === null ? "" : String(query.month), event)}>
      <label className={styles.search}>설교 제목 · 성경 장절<input type="search" value={q} onChange={(event) => setQ(event.target.value)} placeholder="제목이나 성경 장절을 입력하세요" aria-describedby={formError ? "archive-form-error" : undefined} /></label>
      <label>연도<select value={query.year === null ? "" : String(query.year).padStart(4, "0")} disabled={view.state !== "ready"} onChange={(event) => changeFilters(event.target.value, query.month === null ? "" : String(query.month))}>
        <option value="">모든 연도</option>{query.year !== null && !years.includes(query.year) && <option value={String(query.year).padStart(4, "0")} disabled>{query.year}년 (결과 없음)</option>}{years.map((year) => <option value={String(year).padStart(4, "0")} key={year}>{year}년</option>)}
      </select></label>
      <label>월<select value={query.month ?? ""} disabled={view.state !== "ready"} onChange={(event) => changeFilters(query.year === null ? "" : String(query.year).padStart(4, "0"), event.target.value)}>
        <option value="">모든 월</option>{query.month !== null && !months.includes(query.month) && <option value={query.month} disabled>{query.month}월 (결과 없음)</option>}{months.map((month) => <option value={month} key={month}>{month}월</option>)}
      </select></label><button className="primary-button" type="submit">검색</button>
    </form>
    {formError && <p role="alert" id="archive-form-error">검색어는 정규화 후 60자 이내로 입력해 주세요.</p>}
    {(query.q || query.year !== null || query.month !== null) && <div className={styles.filterSummary}><p>검색 조건: {query.q ? `“${query.q}” · ` : ""}{query.year === null ? "모든 연도" : `${query.year}년`} · {query.month === null ? "모든 월" : `${query.month}월`}</p><Link className="text-link" to="/archive">검색 조건 지우기</Link></div>}
    {view.state === "loading" ? <div className={styles.state} role="status">지난 퀴즈를 불러오고 있습니다.</div> : view.state === "error" ? <div className={styles.state} role="alert">
      <h3>{view.invalid ? "검색 조건을 다시 확인해 주세요" : "지난 퀴즈를 불러오지 못했습니다"}</h3><p>입력한 검색 조건은 그대로 남아 있습니다.</p>
      {view.invalid ? <Link className="text-link" to="/archive">검색 조건 지우기</Link> : <button className="primary-button" type="button" onClick={() => { setView({ state: "loading" }); setRetry((value) => value + 1); }}>다시 시도</button>}
    </div> : <>
      <p className={styles.resultCount} role="status" aria-live="polite">{view.page.items.length}개의 지난 퀴즈를 표시하고 있습니다.</p>
      {count ? <ArchiveCards items={view.page.items} onNavigate={savePosition} /> : <div className={styles.state}><h3>찾는 지난 퀴즈가 없습니다</h3><p>검색어나 날짜를 바꾸어 다시 찾아보세요.</p>{!(query.q || query.year !== null || query.month !== null) && <Link className="text-link" to="/archive">검색 조건 지우기</Link>}</div>}
      {moreError && <p role="alert">{moreError === "invalid" ? "목록의 연결 정보가 변경되었습니다. 처음부터 다시 불러와 주세요." : "다음 목록을 불러오지 못했습니다. 기존 목록은 남아 있습니다."}</p>}
      {moreError === "invalid" ? <button className="primary-button" type="button" onClick={() => { restoringScroll.current = 0; void navigate(`/archive${search}`, { replace: true }); }}>목록 처음부터 다시 불러오기</button> : view.page.nextCursor && <button className={styles.more} type="button" onClick={() => void more()} disabled={moreBusy} aria-busy={moreBusy}>{moreBusy ? "불러오는 중…" : moreError ? "더 보기 다시 시도" : "더 보기"}</button>}
    </>}
  </section>;
}
