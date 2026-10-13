import type { ServiceId } from "../config/service-registry";
import { AdminIcon } from "./AdminIcon";
import styles from "./service-icon.module.css";

/** Original provider artwork; the adjacent service name supplies the accessible name. */
export function ServiceIcon({ service }: { service: ServiceId }) {
  if (service === "domain") return <AdminIcon name="globe" tone="action"/>;
  const file = service === "openai" ? "openai.svg" : service === "github_actions" ? "github.svg" : "cloudflare.png";
  return <span className={styles.logo} aria-hidden="true"><img src={`/images/services/${file}`} alt="" width="24" height="24"/></span>;
}
