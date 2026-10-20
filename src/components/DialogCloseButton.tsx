import type { ComponentPropsWithRef } from "react";
import { AdminIcon } from "./AdminIcon";
import styles from "./dialog-close-button.module.css";

/** One raised close control for help, quiz choices and screenshot dialogs. */
export function DialogCloseButton({ label = "닫기", className = "", ...props }: Omit<ComponentPropsWithRef<"button">,"children"> & { label?: string }) {
  return <button {...props} type="button" aria-label={label} className={`${styles.close} ${className}`}><AdminIcon name="close"/></button>;
}
