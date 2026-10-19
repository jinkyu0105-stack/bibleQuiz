import type { ComponentPropsWithRef } from "react";
import { AdminIcon } from "../AdminIcon";
import styles from "./glass-arrow-button.module.css";

type Props = { decorative: true; className?: string } | (Omit<ComponentPropsWithRef<"button">, "children" | "aria-label"> & { decorative?: false; label: string; glyph?: "arrow" | "more" });

/** 유리 화살표 버튼. Row owners opt into coordinated hover with data-glass-arrow-group. */
export function GlassArrowButton(props: Props) {
  const face = <span className={styles.face} aria-hidden="true">{!props.decorative && props.glyph === "more" ? <span className={styles.more}><i/><i/><i/></span> : <AdminIcon name="chevron"/>}</span>;
  if (props.decorative) return <span className={`${styles.decoration} ${props.className ?? ""}`} aria-hidden="true">{face}</span>;
  const { label, className = "", decorative, glyph, type = "button", ...buttonProps } = props;
  void decorative; void glyph;
  return <button {...buttonProps} type={type} className={`${styles.button} ${className}`} aria-label={label}>{face}</button>;
}
