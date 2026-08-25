import {
  Link,
  NavLink,
  Outlet,
  isRouteErrorResponse,
  useLoaderData,
  useParams,
  useRouteError,
} from "react-router-dom";

import type { HealthData } from "../lib/api-client/health";

const navigation = [
  { to: "/", label: "이번 주" },
  { to: "/archive", label: "지난 퀴즈" },
  { to: "/admin", label: "관리" },
] as const;

export function RootLayout() {
  const health = useLoaderData<HealthData>();

  return (
    <div className="app-shell">
      <header className="site-header">
        <div>
          <p className="eyebrow">다사랑교회</p>
          <h1>이번 주의 말씀 : 낱말 퀴즈</h1>
        </div>
        <span className="health" role="status">
          <span aria-hidden="true" /> 기반 연결 정상 · {health.service}
        </span>
      </header>

      <nav aria-label="주요 메뉴">
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

      <main>
        <Outlet />
      </main>
    </div>
  );
}

export function HomePage() {
  return (
    <section className="placeholder" aria-labelledby="development-title">
      <p className="eyebrow">Phase 1 · 실행 골격</p>
      <h2 id="development-title">개발 기반을 준비했습니다.</h2>
      <p>
        현재 화면은 디자인 시안이 아닌 연결 점검용 임시 화면입니다. 실제 설교
        퀴즈와 참여 기능은 다음 단계부터 이 기반 위에 구현합니다.
      </p>
      <Link className="text-link" to="/quiz/test-slug">
        퀴즈 경로 점검하기
      </Link>
    </section>
  );
}

export function ArchivePlaceholder() {
  return <Placeholder title="지난 퀴즈 목록" />;
}

export function AdminPlaceholder() {
  return <Placeholder title="관리자 화면" />;
}

export function QuizPlaceholder() {
  const { slug } = useParams();
  return <Placeholder detail={`현재 시험 주소: ${slug ?? "없음"}`} title="퀴즈 화면" />;
}

function Placeholder({ title, detail }: { title: string; detail?: string }) {
  return (
    <section className="placeholder">
      <p className="eyebrow">경로 연결 점검</p>
      <h2>{title}</h2>
      <p>{detail ?? "이 기능은 이후 구현 단계에서 채워집니다."}</p>
    </section>
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
