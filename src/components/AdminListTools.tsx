import type { ComponentProps, ReactNode } from "react";
import { Button } from "./Button";
import { AdminIcon } from "./AdminIcon";
import styles from "./admin-list-tools.module.css";

/** The same labelled, circular control is used by every admin list. */
export function AdminRefreshButton({ label, title = label, ...props }: Omit<ComponentProps<typeof Button>, "children" | "className" | "aria-label"> & { label: string }) {
  return <Button {...props} type="button" data-admin-refresh className={styles.refresh} aria-label={label} title={title}><AdminIcon name="refresh"/></Button>;
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
