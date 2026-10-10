import { createElement, type HTMLAttributes } from "react";
import { useGlass } from "./useGlass";

type Props = HTMLAttributes<HTMLElement> & {
  as?: "nav" | "div";
  structure?: string;
  clear?: boolean;
  nested?: boolean;
};

/** The caller keeps native tab/button/link semantics and owns selection. */
export function GlassMenu({ as = "div", structure = "", clear = true, nested = false, className = "", children, ...props }: Props) {
  const ref = useGlass<HTMLElement>(`${as}:${clear}:${nested}:${structure}`);
  return createElement(as, {
    ...props, ref, className: `${clear ? "glass glass-clear " : ""}glass-segmented ${className}`,
    "data-glass-motion": "elastic", "data-glass-convex": "",
    ...(!clear || nested ? { "data-glass-nested": "" } : {}),
    ...(clear ? { "data-glass-lens": "", "data-glint": "", "data-glint-shape": "spot" } : {}),
  }, children);
}
