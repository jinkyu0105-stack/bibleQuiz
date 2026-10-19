import { useState, type ComponentPropsWithoutRef } from "react";
import { AdminIcon } from "./AdminIcon";
import styles from "./compact-select.module.css";

type Props = Omit<ComponentPropsWithoutRef<"select">, "aria-label"> & { label: string; pointerFocus?: "ring" | "surface" };

/** Native options and keyboard behavior, with an inset chevron and one full-width focus surface. */
export function CompactSelect({ label, pointerFocus = "ring", className = "", onPointerDown, onKeyDown, onBlur, children, ...props }: Props) {
  const [pointer, setPointer] = useState(false);
  return <label className={`${styles.field} ${className}`} data-focus-style={pointerFocus} data-pointer-focus={pointer ? "true" : undefined}>
    <span className="sr-only">{label}</span>
    <select {...props} aria-label={label} onPointerDown={event => { setPointer(true); onPointerDown?.(event); }} onKeyDown={event => { setPointer(false); onKeyDown?.(event); }} onBlur={event => { setPointer(false); onBlur?.(event); }}>{children}</select>
    <AdminIcon name="chevron"/>
  </label>;
}
