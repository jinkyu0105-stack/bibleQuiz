import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { GlassMenu } from "../../components/glass/GlassMenu";
import { GlassPanel } from "../../components/glass/GlassPanel";
import styles from "./admin-navigation.module.css";

const primary = [
  { to: "/admin", label: "퀴즈 관리", icon: "M4 3h12l4 4v14H4z M8 9h8 M8 13h8 M8 17h5" },
  { to: "/admin/submissions", label: "참여 기록", icon: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M19 8v6 M16 11h6" },
  { to: "/admin/privacy-requests", label: "문의·삭제 요청", icon: "M4 4h16v12H9l-5 4z M8 8h8 M8 12h5" },
] as const;
const secondary = [
  { to: "/admin/tools", label: "수정·보관 도구", icon: "m15 4 5 5 M4 20l5-1L21 7l-4-4L5 15z" },
  { to: "/admin/moderation", label: "이름·문구 필터", icon: "M4 4h16l-6 7v8l-4 2V11z" },
  { to: "/admin/operations", label: "비용·백업", icon: "M4 19V9 M10 19V4 M16 19v-7 M22 19H2" },
  { to: "/admin/manual", label: "도움말", icon: "M12 21V5 M12 5C9 2 5 3 2 4v15c3-1 7-2 10 1 3-3 7-2 10-1V4c-3-1-7-2-10 1" },
] as const;

export function AdminNavigation() {
  const { pathname } = useLocation();
  const [wide, setWide] = useState(() => window.matchMedia("(min-width: 1024px)").matches);
  const [expanded, setExpanded] = useState(false);
  const settingsActive = secondary.some(item => pathname.startsWith(item.to));
  const [settings, setSettings] = useState<{path: string; open: boolean} | null>(null);
  const settingsOpen = settings?.path === pathname ? settings.open : settingsActive;
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const update = () => setWide(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const active = (to: string) => to === "/admin"
    ? pathname === to || pathname === "/admin/new" || pathname.startsWith("/admin/quiz/")
    : pathname.startsWith(to);
  const links = (items: readonly { to: string; label: string; icon: string }[]) => items.map(item =>
    <Link key={item.to} to={item.to} aria-current={active(item.to) ? "page" : undefined} onClick={() => setExpanded(false)}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={item.icon}/></svg>
      <span>{item.label}</span><span className={styles.currentArrow} aria-hidden="true">›</span>
    </Link>);
  return <GlassPanel as="aside" surface="standard" className={styles.sidebar}>
    <p className={styles.eyebrow}>다사랑 성경퀴즈</p><h2 className={styles.title}>관리 공간</h2>
    <details className={styles.menu} open={wide || expanded}>
      <summary onClick={event => { event.preventDefault(); setExpanded(!expanded); }}>관리자 운영 메뉴 <span aria-hidden="true">⌄</span></summary>
      <nav aria-label="관리자 운영 메뉴">
        <GlassMenu clear={false} data-glass-hover-only={primary.some(item => active(item.to)) ? undefined : ""} structure={pathname} className={styles.nav}>{links(primary)}</GlassMenu>
        <details className={styles.settings} open={settingsOpen} onToggle={event => setSettings({path: pathname, open: event.currentTarget.open})}>
          <summary>도구와 설정 <span aria-hidden="true">⌄</span></summary>
          <GlassMenu clear={false} data-glass-hover-only={settingsActive ? undefined : ""} structure={`${pathname}:${settingsOpen}`} className={styles.nav}>{links(secondary)}</GlassMenu>
        </details>
      </nav>
    </details>
    <Link className={styles.homeLink} to="/">사이트 보기 <span aria-hidden="true">↗</span></Link>
  </GlassPanel>;
}
