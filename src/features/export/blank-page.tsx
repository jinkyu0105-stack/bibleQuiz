import { useParams, useSearchParams } from "react-router-dom";
import { BlankExportPanel } from "./BlankExportPanel";
export function Component() {
  const { slug = "" } = useParams(); const [params] = useSearchParams();
  return <BlankExportPanel key={`${slug}:${params.get("level")}`} slug={slug} difficulty={params.get("level") === "adult" ? "adult" : "child"} />;
}
