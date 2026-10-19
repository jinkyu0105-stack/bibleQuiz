import { WeeklyQuizMenu } from "../features/quiz/WeeklyQuizMenu";
import { useHomeSectionScroll } from "../features/quiz/useHomeSectionScroll";
import { Link, NavLink, Outlet, isRouteErrorResponse, useRouteError, useLocation, ScrollRestoration } from "react-router-dom";
import { AdminNavigation } from "../features/admin-weekly/AdminNavigation";
import { GlassMenu } from "../components/glass/GlassMenu";
import { GlassLink } from "../components/glass/GlassLink";
import { GlassPanel } from "../components/glass/GlassPanel";
import { useGlass } from "../components/glass/useGlass";
import { SkyEnvironment } from "../components/sky/SkyEnvironment";
import { AdminIcon } from "../components/AdminIcon";

export function RootLayout() {
  const location = useLocation();
  const admin = location.pathname.startsWith("/admin");
  const home = location.pathname === "/" && !new URLSearchParams(location.search).has("level");
  const view = admin ? "admin" : home ? "home" : location.pathname === "/archive" ? "archive" : "quiz";
  useHomeSectionScroll(home);
  const header = useGlass<HTMLElement>();
  return <SkyEnvironment view={view}>
    <div className={`app-shell sky-app ${view}-shell`}>
      <ScrollRestoration />
      <a className="skip-link" href="#main-content">본문으로 이동</a>
      <header ref={header} className="site-header glass glass-clear" data-glass-lens="" data-glint="" data-glint-shape="edge">
        <Link className="brand" to="/" aria-label="다사랑교회 성경퀴즈 처음으로"><span className="brand-word">다사랑</span><span className="brand-detail">교회<br />성경퀴즈</span></Link>
        <GlassMenu as="nav" clear={false} data-glass-hover-only="" className="site-navigation" aria-label="주요 메뉴">
          <WeeklyQuizMenu active={location.pathname === "/"}/><NavLink to="/archive">지난 퀴즈</NavLink>
        </GlassMenu>
        <GlassLink className="admin-link" to="/admin" aria-label="관리 공간"><AdminIcon name="grid" className="admin-link-icon" /><span className="admin-link-label">관리</span><span className="admin-link-arrow" aria-hidden="true">↗</span></GlassLink>
      </header>
      <div className={admin ? "admin-layout" : "public-layout"}>
        {admin && <AdminNavigation />}
        {admin ? <main id="main-content" tabIndex={-1}><GlassPanel as="div" surface="standard" className="admin-main"><Outlet /></GlassPanel></main>
          : <main id="main-content" tabIndex={-1}><Outlet /></main>}
      </div>
      <footer className="site-footer"><span>다사랑교회 성경퀴즈</span><Link to={{ pathname: location.pathname, search: location.search, hash: "#main-content" }}>맨 위로 ↑</Link></footer>
    </div>
  </SkyEnvironment>;
}

export function RootError() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : "화면을 불러오지 못했습니다.";

  return (
    <main className="error-page">
      <p className="eyebrow">연결 확인 필요</p>
      <h1>화면을 불러오지 못했습니다.</h1>
      <p>{message}</p>
      <Link className="text-link" to="/">
        처음으로 돌아가기
      </Link>
    </main>
  );
}
