import { AdminIcon, type AdminIconName } from "./AdminIcon";
import type { AdminTone } from "../config/admin-help";
import styles from "./glossy-icon.module.css";

/** Soft coloured glass surface; the adjacent label supplies the meaning and name. */
export function GlossyIcon({ name, tone = "action", size = "small" }: {
  name: AdminIconName; tone?: AdminTone; size?: "small" | "medium";
}) {
  return <span className={styles.icon} data-glossy-tone={tone} data-size={size} aria-hidden="true"><AdminIcon name={name}/></span>;
}
