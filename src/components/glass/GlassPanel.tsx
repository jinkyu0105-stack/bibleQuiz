import { createElement, type HTMLAttributes } from "react";
import { useGlass } from "./useGlass";

type Props = HTMLAttributes<HTMLElement> & {
  as?: "section" | "article" | "aside" | "div" | "header" | "li";
  surface?: "reading" | "standard";
};

export function GlassPanel({ as = "section", surface = "reading", className = "", children, ...props }: Props) {
  const ref = useGlass<HTMLElement>(`${as}:${surface}`);
  return createElement(as, { ...props, ref, className: `glass ${className}`, "data-glass-panel": surface }, children);
}
