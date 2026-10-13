import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import type { AdminTone } from "../../config/admin-help";
import { AdminIcon, type AdminIconName } from "../../components/AdminIcon";
import { GlassPanel } from "../../components/glass/GlassPanel";
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
  const navigation = useRef<HTMLElement>(null);
  const [highlight, setHighlight] = useState<{x:number; y:number; width:number; height:number} | null>(null);
  function showHighlight(link: HTMLElement | null) {
    const nav = navigation.current;
    if (!nav || !link) { setHighlight(null); return; }
    const parent = nav.getBoundingClientRect(), box = link.getBoundingClientRect();
    setHighlight({x:box.left-parent.left, y:box.top-parent.top, width:box.width, height:box.height});
  }
  function restoreHighlight() { showHighlight(navigation.current?.querySelector<HTMLElement>('a[aria-current="page"]') ?? null); }

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
  useLayoutEffect(() => {
    const nav = navigation.current;
    if (!nav) return;
    const update = () => {
      const activeLink = nav.querySelector<HTMLElement>('a[aria-current="page"]');
      if (!activeLink || !activeLink.getClientRects().length) { setHighlight(null); return; }
      const parent = nav.getBoundingClientRect(), box = activeLink.getBoundingClientRect();
      setHighlight({x:box.left-parent.left,y:box.top-parent.top,width:box.width,height:box.height});
    };
    update();
    const observer = new ResizeObserver(update); observer.observe(nav);
    return () => observer.disconnect();
  }, [pathname, settingsOpen, wide, expanded]);
  const active = (to: string) => to === "/admin"
    ? pathname === to || pathname === "/admin/new" || pathname.startsWith("/admin/quiz/")
    : pathname.startsWith(to);
  const links = (items: readonly { to: string; label: string; icon: AdminIconName; tone: AdminTone }[]) => items.map(item =>
    <Link key={item.to} to={item.to} aria-current={active(item.to) ? "page" : undefined} onClick={() => setExpanded(false)}>
      <AdminIcon name={item.icon} tone={item.tone}/>
      <span>{item.label}</span>
    </Link>);
  return <GlassPanel as="aside" surface="standard" className={styles.sidebar}>
    <p className={styles.eyebrow}>다사랑 성경퀴즈</p>
    <h2 className={styles.title}><span>관리 공간</span></h2>
    <details className={styles.menu} open={wide || expanded}>
      <summary onClick={event => { event.preventDefault(); setExpanded(!expanded); }}>관리자 운영 메뉴 <AdminIcon name="chevron"/></summary>
      <nav ref={navigation} aria-label="관리자 운영 메뉴"
        onPointerOver={event => { if (event.pointerType !== "touch") { const link = (event.target as HTMLElement).closest('a'); if (link) showHighlight(link); } }}
        onPointerLeave={restoreHighlight}
        onFocus={event => { const link = (event.target as HTMLElement).closest('a'); if (link) showHighlight(link); }}
        onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) restoreHighlight(); }}>
        {highlight && <span className={styles.highlight} aria-hidden="true" style={{transform:`translate(${highlight.x}px, ${highlight.y}px)`,width:highlight.width,height:highlight.height}}/>}
        <h3 className={styles.groupTitle}>퀴즈 운영</h3>
        <div className={styles.nav}>{links(primary)}</div>
        <details className={styles.settings} open={settingsOpen} onToggle={event => setSettings({path: pathname, open: event.currentTarget.open})}>
          <summary>도구와 설정 <AdminIcon name="chevron"/></summary>
          <div className={styles.nav}>{links(secondary)}</div>
        </details>
      </nav>
    </details>
  </GlassPanel>;
}
