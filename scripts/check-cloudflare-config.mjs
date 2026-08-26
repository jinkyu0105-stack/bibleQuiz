import { readFile } from "node:fs/promises";

const wranglerConfig = JSON.parse(
  await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
);

const placeholderDatabaseId = "00000000-0000-0000-0000-000000000001";
const preview = wranglerConfig.env?.preview;
const previewDatabase = preview?.d1_databases?.find(
  (database) => database.binding === "DB",
);
const topLevelDatabase = wranglerConfig.d1_databases?.find(
  (database) => database.binding === "DB",
);

const failures = [];

if (preview?.name !== "biblequiz-app-preview") {
  failures.push("Preview Worker 이름은 biblequiz-app-preview여야 합니다.");
}

if (previewDatabase?.database_name !== "biblequiz-d1-preview") {
  failures.push("Preview DB는 biblequiz-d1-preview여야 합니다.");
}

if (
  !previewDatabase?.database_id ||
  previewDatabase.database_id.startsWith("00000000-")
) {
  failures.push("Preview DB에는 실제 Cloudflare UUID가 필요합니다.");
}

if (previewDatabase?.preview_database_id !== "biblequiz-d1-preview-local") {
  failures.push("Preview의 local D1 식별자가 환경 규칙과 다릅니다.");
}

if (topLevelDatabase?.database_id !== placeholderDatabaseId) {
  failures.push(
    "Production D1은 아직 승인되지 않았으므로 placeholder 상태여야 합니다.",
  );
}

if (topLevelDatabase?.database_id === previewDatabase?.database_id) {
  failures.push("Preview와 Production D1 ID가 같을 수 없습니다.");
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exitCode = 1;
}
