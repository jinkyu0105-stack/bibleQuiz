import { Link } from "react-router-dom";
import { GlassMenu } from "./GlassMenu";

/** The approved review dock now links to the real application pages. */
export function PageDock() {
  return <GlassMenu as="nav" className="page-dock" aria-label="빠른 이동">
    <span>바로가기</span><Link to="/" aria-current="page">메인</Link>
    <Link to="/?level=child">풀이</Link><Link to="/admin">관리자</Link>
  </GlassMenu>;
}
