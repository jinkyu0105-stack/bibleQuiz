import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import type { AdminTone } from "../../config/admin-help";
import { AdminIcon, type AdminIconName } from "../../components/AdminIcon";
import { GlassPanel } from "../../components/glass/GlassPanel";
import { AdminMenu, AdminMenuIcon } from "../../components/AdminMenu";
import styles from "./admin-navigation.module.css";

const primary = [
  { to: "/admin", label: "퀴즈 관리", icon: "document", tone: "action" },
  { to: "/admin/submissions", label: "참여 기록", icon: "people", tone: "success" },
  { to: "/admin/privacy-requests", label: "문의·삭제 요청", icon: "message", tone: "attention" },
] as const;
const secondary = [
  { to: "/admin/tools", label: "수정·보관 도구", icon: "edit", tone: "action" },
  { to: "/admin/moderation", label: "이름·문구 필터", icon: "filter", tone: "danger" },
  { to: "/admin/operations", label: "비용·백업", icon: "chart", tone: "attention" },
  { to: "/admin/manual", label: "도움말", icon: "book", tone: "guide" },
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
  const links = (items: readonly { to: string; label: string; icon: AdminIconName; tone: AdminTone }[]) => items.map(item =>
    <Link key={item.to} to={item.to} data-admin-menu-item aria-current={active(item.to) ? "page" : undefined} onClick={() => setExpanded(false)}>
      <AdminMenuIcon><AdminIcon name={item.icon} tone={item.tone}/></AdminMenuIcon>
      <span>{item.label}</span>
    </Link>);
  return <GlassPanel as="aside" surface="standard" className={styles.sidebar}>
    <p className={styles.eyebrow}>다사랑 성경퀴즈</p>
    <h2 className={styles.title}><span>관리 공간</span></h2>
    <details className={styles.menu} open={wide || expanded}>
      <summary onClick={event => { event.preventDefault(); setExpanded(!expanded); }}>관리자 운영 메뉴 <AdminIcon name="chevron"/></summary>
      <AdminMenu label="관리자 운영 메뉴" selectionKey={`${pathname}:${settingsOpen}:${wide}:${expanded}`}>
        <h3 className={styles.groupTitle}>퀴즈 운영</h3>
        <div className={styles.nav}>{links(primary)}</div>
        <details className={styles.settings} open={settingsOpen} onToggle={event => setSettings({path: pathname, open: event.currentTarget.open})}>
          <summary>도구와 설정 <AdminIcon name="chevron"/></summary>
          <div className={styles.nav}>{links(secondary)}</div>
        </details>
      </AdminMenu>
    </details>
  </GlassPanel>;
}
