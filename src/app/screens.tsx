import {
  Link,
  NavLink,
  Outlet,
  isRouteErrorResponse,
  useRouteError,
  useLocation,
} from "react-router-dom";

import { AdminNavigation } from "../features/admin-weekly/AdminNavigation";
import { ThemeControl } from "../features/quiz/ThemeControl";

const navigation = [
  { to: "/", label: "이번 주" },
  { to: "/archive", label: "지난 퀴즈" },
  { to: "/admin", label: "관리" },
] as const;

export function RootLayout() {
  const pathname = useLocation().pathname;
  const admin = pathname.startsWith("/admin");
  const quiz = pathname === "/" || pathname.startsWith("/quiz/") || pathname === "/dev/quiz";
  return (
    <div className={`app-shell${admin ? " admin-shell" : quiz ? " quiz-shell" : pathname === "/archive" ? " archive-shell" : ""}`}>
      <a className="skip-link" href="#main-content">본문으로 이동</a>
      <header className="site-header">
        <div>
          <p className="eyebrow">다사랑교회</p>
          <h1>이번 주의 말씀 : 낱말 퀴즈</h1>
        </div>
        <ThemeControl />
      <nav className="site-navigation" aria-label="주요 메뉴">
        {navigation.map((item) => (
          <NavLink
            className={({ isActive }) => (isActive ? "active" : undefined)}
            end={item.to === "/"}
            key={item.to}
            to={item.to}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
      </header>

      <div className={admin ? "admin-layout" : "public-layout"}>
      {admin && <AdminNavigation />}
      <main id="main-content" tabIndex={-1}>
        <Outlet />
      </main>
      </div>
      <footer><Link to="/privacy-requests">문의·삭제 요청 및 내 문의</Link></footer>
      {import.meta.env.DEV && <footer className="development-footer">로컬 개발·검수 화면입니다. 실제 서비스 적용 여부는 운영 기록에서 확인합니다.</footer>}
    </div>
  );
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
