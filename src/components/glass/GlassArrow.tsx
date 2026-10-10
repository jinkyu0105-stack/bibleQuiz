import { useGlass } from "./useGlass";

export function GlassArrow() {
  const ref = useGlass<HTMLSpanElement>();
  return <span ref={ref} className="round-arrow glass glass-clear" data-glint="" data-glint-shape="spot" aria-hidden="true">↗</span>;
}
