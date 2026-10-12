import type { ComponentPropsWithRef } from "react";
import { Link } from "react-router-dom";
import "./button.css";

type ButtonStyle = { variant?: "secondary" | "primary" };

function buttonClass(variant: "secondary" | "primary", className: string) {
  return `action-button ${variant === "primary" ? "primary-button" : "secondary-button"} ${className}`;
}

/** The quiz's existing actions, with native form, disabled, event and ref behavior. */
export function Button({ variant = "secondary", className = "", ...props }: ComponentPropsWithRef<"button"> & ButtonStyle) {
  return <button {...props} className={buttonClass(variant, className)} />;
}

/** Navigation with the same appearance; Router keeps its normal link behavior. */
export function ButtonLink({ variant = "secondary", className = "", ...props }: ComponentPropsWithRef<typeof Link> & ButtonStyle) {
  return <Link {...props} className={buttonClass(variant, className)} />;
}
