import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
const exec = promisify(execFile);

export async function prepareLocalDemo(persistPath) {
  const args = ["exec", "wrangler", "d1", "execute", "biblequiz-local", "--local", "--persist-to", persistPath, "--config", "wrangler.jsonc"];
  const result = await exec("pnpm", [...args, "--command", "SELECT count(*) n FROM bible_translations WHERE id='p915-reference-only'", "--json"]);
  const response = JSON.parse(result.stdout);
  if (response[0]?.results?.[0]?.n === 0) {
    await exec("pnpm", [...args, "--file", "scripts/fixtures/p9-15-preview.sql", "--yes", "--json"]);
    console.log("로컬 초안1·공개1·지난2·참여/코멘트12·삭제 요청2를 추가했습니다.");
  } else if (response[0]?.results?.[0]?.n === 1) console.log("기존 체험 자료와 편집·삭제 기록을 유지합니다.");
  else throw new Error("로컬 체험 자료 상태를 확인하지 못했습니다.");
  const keyPath = path.join(persistPath, "local-demo-keys.json");
  let keys;
  try { keys = JSON.parse(await readFile(keyPath, "utf8")); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    keys = { SESSION_PEPPER: randomBytes(32).toString("hex"), ARCHIVE_CURSOR_SECRET: randomBytes(32).toString("hex") };
    await writeFile(keyPath, JSON.stringify(keys), { mode: 0o600, flag: "wx" });
  }
  if (![keys.SESSION_PEPPER, keys.ARCHIVE_CURSOR_SECRET].every(value => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value))) throw new Error("로컬 시험 키 형식이 잘못되었습니다.");
  const configPath = path.resolve(".wrangler/local-demo/wrangler.jsonc");
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify({
    name: "biblequiz-local-demo", main: path.resolve("workers/local-demo/index.ts"), compatibility_date: "2026-08-25",
    workers_dev: false, preview_urls: false,
    assets: { not_found_handling: "single-page-application", run_worker_first: ["/api/*"] },
    vars: { LOCAL_DEMO_ENABLED: "true", ...keys },
    d1_databases: [{ binding: "DB", database_name: "biblequiz-local", database_id: "00000000-0000-0000-0000-000000000001", preview_database_id: "biblequiz-local", migrations_dir: path.resolve("migrations") }],
  }, null, 2), { mode: 0o600 });
  await chmod(configPath, 0o600);
  return configPath;
}
