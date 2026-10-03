await import("./check-operations-contract.mjs");
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

if (wranglerConfig.durable_objects?.bindings?.length || wranglerConfig.migrations?.length ||
    preview?.vars?.ADMIN_COMPUTE_ENABLED !== "true" ||
    preview?.durable_objects?.bindings?.length !== 1 ||
    preview.durable_objects.bindings[0].name !== "ADMIN_COMPUTE" ||
    preview.durable_objects.bindings[0].class_name !== "AdminCompute" ||
    preview.durable_objects.bindings[0].script_name ||
    preview?.migrations?.length !== 1 || preview.migrations[0].tag !== "admin-compute-v1" ||
    preview.migrations[0].new_sqlite_classes?.join(",") !== "AdminCompute") {
  failures.push("기본 설정의 관리자 계산 DO는 기존 Preview SQLite 클래스를 유지해야 합니다. Production은 별도 설정을 사용합니다.");
}

if (preview?.vars?.AI_GENERATION_ENABLED !== "false" || preview?.vars?.CONTENT_FINAL_CHECK_WORKFLOW_ENABLED !== "false" || preview?.vars?.P571_SYNTHETIC_SERMON_IDS !== "[]" ||
    preview?.vars?.DRAFT_CLEANUP_ENABLED !== "false" ||
    preview?.workflows?.length !== 1 || preview.workflows[0].binding !== "CONTENT_WORKFLOW" ||
    preview.workflows[0].name !== "biblequiz-content-preview" ||
    preview.workflows[0].script_name !== "biblequiz-content-preview" ||
    preview.workflows[0].class_name !== "PreviewMeasurementWorkflow" || wranglerConfig.workflows?.length) {
  failures.push("Preview app은 비활성 생성/정리와 승인된 합성 전용 Workflow만 연결해야 합니다.");
}

if (wranglerConfig.keep_vars !== true) {
  failures.push(
    "대시보드에 저장한 runtime 변수를 배포 때 유지하려면 keep_vars가 true여야 합니다.",
  );
}

const configuredCrons = [
  ...(wranglerConfig.triggers?.crons ?? []),
  ...Object.values(wranglerConfig.env ?? {}).flatMap(
    (environment) => environment?.triggers?.crons ?? [],
  ),
];

if (configuredCrons.length > 0) {
  failures.push(
    "Cloudflare Cron trigger는 아직 승인되지 않았으므로 설정에 연결하면 안 됩니다.",
  );
}

if (preview?.name !== "biblequiz-app-preview") {
  failures.push("Preview Worker 이름은 biblequiz-app-preview여야 합니다.");
}

if (preview?.workers_dev !== true) {
  failures.push(
    "Preview 앱 Worker는 Worker-level Access 뒤에서 workers.dev 주소를 사용해야 합니다.",
  );
}

if (preview?.preview_urls !== false) {
  failures.push(
    "Preview 앱 Worker의 불필요한 버전별 Preview URL은 비활성화되어야 합니다.",
  );
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

if (previewDatabase?.preview_database_id !== previewDatabase?.database_id) {
  failures.push(
    "Preview 원격 개발과 배포는 같은 비운영 D1 UUID를 가리켜야 합니다.",
  );
}

if (topLevelDatabase?.database_id !== placeholderDatabaseId) {
  failures.push(
    "기본 설정 D1은 placeholder를 유지해야 합니다. 실제 Production은 별도 명시적 설정을 사용합니다.",
  );
}

if (topLevelDatabase?.database_id === previewDatabase?.database_id) {
  failures.push("Preview와 Production D1 ID가 같을 수 없습니다.");
}

const measurement = JSON.parse(await readFile(new URL("../wrangler.p5-71-content.jsonc", import.meta.url), "utf8"));
const trial = measurement.env?.preview;
if (measurement.main !== "./workers/content/preview-measurement.ts" || trial?.name !== "biblequiz-content-preview" ||
    measurement.workers_dev !== false || measurement.preview_urls !== false || trial?.workers_dev !== false || trial?.preview_urls !== false ||
    measurement.routes?.length || trial?.routes?.length || measurement.triggers?.crons?.length || trial?.triggers?.crons?.length ||
    trial?.vars?.P571_MEASUREMENT_ENABLED !== "false" || trial?.vars?.P571_SCENARIO !== "success" ||
    trial?.vars?.AI_RESPONSE_ARCHIVE_ENABLED !== "false" ||
    trial?.vars?.CONTENT_DISPLAY_PREPARATION_ENABLED !== "false" || trial?.vars?.CONTENT_DISPLAY_PREPARATION_SERMON_IDS !== "[]" ||
    preview?.vars?.CONTENT_DISPLAY_PREPARATION_ENABLED !== "false" || preview?.vars?.CONTENT_DISPLAY_PREPARATION_SERMON_IDS !== "[]" ||
    Object.keys(trial?.vars ?? {}).some(key => !["P571_MEASUREMENT_ENABLED", "P571_SCENARIO", "AI_RESPONSE_ARCHIVE_ENABLED",
      "CONTENT_DISPLAY_PREPARATION_ENABLED", "CONTENT_DISPLAY_PREPARATION_SERMON_IDS"].includes(key)) ||
    trial?.d1_databases?.length !== 1 || trial.d1_databases[0].database_id !== previewDatabase?.database_id ||
    trial?.workflows?.length !== 1 || trial.workflows[0].name !== "biblequiz-content-preview" ||
    trial.workflows[0].class_name !== "PreviewMeasurementWorkflow" || trial.workflows[0].binding !== "CONTENT_WORKFLOW") {
  failures.push("P5-71 측정 설정은 비활성·비공개·Preview D1/Workflow 전용이어야 하며 키/Cron/route를 추가할 수 없습니다.");
}

// P8-02 explicitly approved remote setup. Separate configs keep an accidental
// default deploy away from Production and bootstrap without public URLs or AI.
const production = await Promise.all([
  "../wrangler.production.jsonc",
  "../workers/content/wrangler.production.jsonc",
  "../workers/backup/wrangler.production.jsonc",
].map(async path => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"))));
const [productionApp, productionContent, productionBackup] = production;
const productionDb = productionApp.d1_databases?.[0]?.database_id;
for (const [index, config] of production.entries()) {
  const expectedName = ["biblequiz-app", "biblequiz-content", "biblequiz-backup"][index];
  if (config.name !== expectedName || config.account_id !== productionApp.account_id ||
      !/^[a-f0-9]{32}$/u.test(config.account_id ?? "") ||
      config.workers_dev !== (index === 0) || config.preview_urls !== false ||
      config.routes?.length ||
      config.d1_databases?.length !== 1 || config.d1_databases[0].binding !== "DB" ||
      config.d1_databases[0].database_name !== "biblequiz-d1" ||
      config.d1_databases[0].database_id !== productionDb ||
      config.vars?.OPERATIONS_ENVIRONMENT !== "production" ||
      config.vars?.D1_DATABASE_ID !== productionDb) {
    failures.push(`Production 설정 ${expectedName}은 동일 계정/별도 D1과 검수한 주소 경계를 유지해야 합니다.`);
  }
  for (const key of ["AI_GENERATION_ENABLED", "AI_RESPONSE_ARCHIVE_ENABLED",
    "CONTENT_FINAL_CHECK_WORKFLOW_ENABLED", "CONTENT_DISPLAY_PREPARATION_ENABLED",
    "DRAFT_CLEANUP_ENABLED", "BACKUP_ENABLED", "OPERATIONS_CRON_ENABLED",
    "PUBLIC_RATE_LIMIT_ENABLED"]) {
    // P8-02: explicit operator approval covers these AI flags; paid production
    // generation remains untested. OpenAI credentials belong only to content.
    const reviewedFlag = (index === 0 && ["OPERATIONS_CRON_ENABLED", "PUBLIC_RATE_LIMIT_ENABLED",
      "DRAFT_CLEANUP_ENABLED", "BACKUP_ENABLED", "AI_GENERATION_ENABLED",
      "CONTENT_FINAL_CHECK_WORKFLOW_ENABLED"].includes(key)) ||
      (index === 1 && ["AI_GENERATION_ENABLED", "AI_RESPONSE_ARCHIVE_ENABLED"].includes(key)) ||
      (index === 2 && key === "BACKUP_ENABLED");
    if (config.vars?.[key] === "true" && !reviewedFlag) failures.push(`미검수 Production 실행 flag ${key}를 켤 수 없습니다.`);
  }
  // P8-02 remote deadline, cleanup and backup rehearsals passed.
  const reviewedCrons = index === 0 && config.vars?.OPERATIONS_CRON_ENABLED === "true"
    ? ["*/5 * * * *"] : index === 2 && config.vars?.BACKUP_ENABLED === "true"
      ? ["*/10 * * * *", "0 19 * * SUN"] : [];
  if (JSON.stringify(config.triggers?.crons ?? []) !== JSON.stringify(reviewedCrons)) {
    failures.push(`Production ${expectedName} Cron은 검수한 마감·정리 5분/삭제 기록 10분/월요일 04:00 KST 백업 일정만 허용합니다.`);
  }
  for (const key of ["P571_SYNTHETIC_SERMON_IDS", "CONTENT_DISPLAY_PREPARATION_SERMON_IDS"]) {
    if (config.vars?.[key] !== undefined && config.vars[key] !== "[]") failures.push(`Production 허용 목록 ${key}는 비어 있어야 합니다.`);
  }
  if (config.r2_buckets?.length && (index !== 2 || config.r2_buckets.length !== 1 ||
      config.r2_buckets[0].binding !== "BACKUP_BUCKET" ||
      config.r2_buckets[0].bucket_name !== "biblequiz-backups")) {
    failures.push("Production R2는 backup의 비공개 biblequiz-backups 하나에만 연결해야 합니다.");
  }
}
if (!/^[a-f0-9-]{36}$/u.test(productionDb ?? "") || productionDb === previewDatabase?.database_id ||
    productionDb === placeholderDatabaseId) failures.push("별도 Production D1에는 Preview와 다른 실제 UUID가 필요합니다.");
if (productionApp.vars?.ADMIN_COMPUTE_ENABLED !== "true" ||
    productionApp.durable_objects?.bindings?.length !== 1 ||
    productionApp.durable_objects.bindings[0].name !== "ADMIN_COMPUTE" ||
    productionApp.durable_objects.bindings[0].class_name !== "AdminCompute" ||
    productionApp.durable_objects.bindings[0].script_name ||
    productionApp.migrations?.length !== 1 || productionApp.migrations[0].tag !== "admin-compute-v1" ||
    productionApp.migrations[0].new_sqlite_classes?.join(",") !== "AdminCompute") {
  failures.push("Production 관리자는 별도 Worker의 SQLite AdminCompute로 설치해야 합니다.");
}
if (productionContent.workflows?.length !== 1 ||
    productionContent.workflows[0].name !== "biblequiz-content-workflow" ||
    productionContent.workflows[0].class_name !== "ContentWorkflow" ||
    productionContent.workflows[0].binding !== "CONTENT_WORKFLOW" ||
    productionBackup.workflows?.length !== 1 ||
    productionBackup.workflows[0].name !== "biblequiz-backup-workflow" ||
    productionBackup.workflows[0].class_name !== "BackupWorkflow" ||
    productionBackup.workflows[0].binding !== "BACKUP_WORKFLOW" ||
    productionApp.workflows?.length !== 2 ||
    !productionApp.workflows.some(w => w.binding === "CONTENT_WORKFLOW" && w.name === "biblequiz-content-workflow" && w.class_name === "ContentWorkflow" && w.script_name === "biblequiz-content") ||
    !productionApp.workflows.some(w => w.binding === "BACKUP_WORKFLOW" && w.name === "biblequiz-backup-workflow" && w.class_name === "BackupWorkflow" && w.script_name === "biblequiz-backup")) {
  failures.push("Production Workflow는 승인된 환경 전용 content/backup Worker를 가리켜야 합니다.");
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exitCode = 1;
}
