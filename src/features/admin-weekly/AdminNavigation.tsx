import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { GlassMenu } from "../../components/glass/GlassMenu";
import { GlassPanel } from "../../components/glass/GlassPanel";
import styles from "./admin-navigation.module.css";

const destinations = [
  ["/admin", "주간 운영"],
  ["/admin/moderation", "이름·문구 필터"],
  ["/admin/privacy-requests", "문의·삭제 요청"],
  ["/admin/tools", "발행·수정 도구"],
  ["/admin/operations", "비용·백업"],
  ["/admin/manual", "운영 매뉴얼"],
] as const;

export function AdminNavigation() {
  const [wide, setWide] = useState(() => window.matchMedia("(min-width: 1024px)").matches);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const update = () => setWide(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return <GlassPanel as="aside" surface="standard" className={styles.sidebar}>
    <p className={styles.eyebrow}>운영 공간</p>
    <h2 className={styles.title}>주간 운영</h2>
    <details className={styles.menu} open={wide || expanded}>
      <summary onClick={event => { event.preventDefault(); setExpanded(!expanded); }}>관리자 운영 메뉴</summary>
      <GlassMenu as="nav" clear={false} className={styles.nav} aria-label="관리자 운영 메뉴">
        {destinations.map(([to, label]) => <NavLink key={to} to={to} end={to === "/admin"}>
          {label}<span className={styles.currentArrow} aria-hidden="true">↗</span>
        </NavLink>)}
      </GlassMenu>
    </details>
    <p className={styles.note}>말씀을 준비하는<br />정성스러운 한 주.</p>
  </GlassPanel>;
}
