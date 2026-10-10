import type { ComponentPropsWithRef } from "react";
import { Link, type LinkProps } from "react-router-dom";

const material = "glass glass-clear glass-button convex-lens";

/** Reusable CSS glass: no per-button observers, SVG filters or animation loops. */
export function GlassButton({ className = "", ...props }: ComponentPropsWithRef<"button">) {
  return <button {...props} className={`${material} ${className}`} />;
}

/** A navigation action with the same light material and native Router semantics. */
export function GlassButtonLink({ className = "", ...props }: LinkProps) {
  return <Link {...props} className={`${material} ${className}`} />;
}
