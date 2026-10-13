import type { ComponentProps, ReactNode } from "react";
import { Button, ButtonLink } from "./Button";
import { AdminTooltip } from "./AdminHelp";
import { AdminIcon, type AdminIconName } from "./AdminIcon";
import styles from "./admin-list-tools.module.css";

/** The same labelled, circular control is used by every admin list. */
export function AdminRefreshButton({ label, title = label, ...props }: Omit<ComponentProps<typeof Button>, "children" | "className" | "aria-label"> & { label: string }) {
  return <AdminTooltip label={title}><Button {...props} type="button" data-admin-refresh className={`${styles.iconControl} ${styles.refresh}`} aria-label={label}><AdminIcon name="refresh"/></Button></AdminTooltip>;
}

/** Square navigation controls keep their names available to keyboard and screen readers. */
export function AdminIconLink({ label, icon, ...props }: Omit<ComponentProps<typeof ButtonLink>, "children" | "className" | "aria-label"> & { label: string; icon: AdminIconName }) {
  return <AdminTooltip label={label}><ButtonLink {...props} className={styles.iconControl} aria-label={label} data-admin-icon-action><AdminIcon name={icon}/></ButtonLink></AdminTooltip>;
}

export function AdminFilterTabs<T extends string>({ label, options, value, onChange, children }: {
  label: string; options: readonly { value: T; label: string; count: number | string }[];
  value: T; onChange: (value: T) => void; children?: ReactNode;
}) {
  return <div className={styles.toolbar} data-admin-list-toolbar>
    <div className={styles.filters} role="group" aria-label={label}>
      {options.map(option => <button type="button" key={option.value} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}<span>{option.count}</span></button>)}
    </div>
    {children && <div className={styles.controls}>{children}</div>}
  </div>;
}
