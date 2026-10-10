import { GlassMenu } from "../../components/glass/GlassMenu";
import { useGlass } from "../../components/glass/useGlass";
import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import styles from "./weekly.module.css";
export function AdminNavigation(){
  const ref = useGlass<HTMLDetailsElement>();
  const [wide, setWide] = useState(() => window.matchMedia("(min-width: 1024px)").matches);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const update = () => setWide(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return <details ref={ref} data-glass-panel="standard" className={`glass ${styles.navigationShell}`} open={wide || expanded}><summary onClick={event => { event.preventDefault(); setExpanded(!expanded); }}>관리자 운영 메뉴</summary><GlassMenu as="nav" clear={false} className={styles.nav} aria-label="관리자 운영 메뉴">{[
  ["/admin", "주간 운영"], ["/admin/moderation", "이름·문구 필터"], ["/admin/privacy-requests", "문의·삭제 요청"],
  ["/admin/tools", "발행·수정 도구"], ["/admin/operations", "비용·백업"], ["/admin/manual", "운영 매뉴얼"],
].map(([to, label]) => <NavLink key={to} to={to!} end={to === "/admin"}>{label}</NavLink>)}</GlassMenu></details>;}
