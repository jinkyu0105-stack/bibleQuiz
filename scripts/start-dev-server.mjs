import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

// Stable, separate storage: never seed the pre-existing local or remote DB.
const persistPath = path.resolve(".wrangler/ui-demo-state");
if (process.env.CLOUDFLARE_ENV || process.env.BIBLEQUIZ_CLOUDFLARE_CONFIG || process.env.BIBLEQUIZ_E2E_D1_PATH) {
  throw new Error("pnpm dev는 로컬 UI 시험 전용입니다. 별도 환경은 pnpm dev:local을 사용하세요.");
}

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`로컬 준비 실패 (${signal ?? code ?? "unknown"})`));
    });
  });
}

console.log("장년·어린이 UI 시험 데이터를 준비합니다. 이전 시험 기록은 유지합니다.");
await mkdir(persistPath, { recursive: true });
await run(["exec", "wrangler", "d1", "migrations", "apply", "biblequiz-local", "--local", "--persist-to", persistPath, "--config", "wrangler.jsonc"]);
await run(["exec", "wrangler", "d1", "execute", "biblequiz-local", "--local", "--persist-to", persistPath, "--config", "wrangler.jsonc", "--file", "scripts/fixtures/dev-ui.sql"]);

console.log("UI 시험 화면을 시작합니다. 어린이: /?level=child · 장년: /?level=adult");
const server = spawn("pnpm", ["exec", "vite", ...process.argv.slice(2)], {
  env: { ...process.env, BIBLEQUIZ_LOCAL_D1_PATH: persistPath },
  stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => { if (server.exitCode === null) server.kill(signal); });
}
server.once("error", (error) => { console.error(error); process.exitCode = 1; });
server.once("exit", (code) => { process.exitCode = code ?? 0; });
