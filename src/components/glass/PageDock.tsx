import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { GlassMenu } from "./GlassMenu";

/** The approved review dock now links to the real application pages. */
export function PageDock({ settings, mobile }: { settings: ReactNode; mobile: boolean }) {
  return <GlassMenu as="nav" className="page-dock" aria-label="빠른 이동" data-glass-selection-only={mobile ? "" : undefined}>
    <span>바로가기</span><Link to="/" aria-current="page" aria-label="홈" title="홈"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9" /></svg></Link>
    <Link to="/?level=child">퀴즈</Link><Link to="/privacy-requests">문의</Link>
    {settings}
  </GlassMenu>;
}
