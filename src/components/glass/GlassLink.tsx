import { Link, type LinkProps } from "react-router-dom";
import { useGlass } from "./useGlass";

export function GlassLink({ className = "", children, ...props }: LinkProps) {
  const ref = useGlass<HTMLAnchorElement>();
  return <Link {...props} ref={ref} className={`glass glass-clear glass-action ${className}`}><span>{children}</span></Link>;
}
