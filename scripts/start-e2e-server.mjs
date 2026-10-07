import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const persistPath = await mkdtemp(path.join(tmpdir(), "biblequiz-e2e-d1-"));

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed (${signal ?? code ?? "unknown"})`));
    });
  });
}

async function prepare() {
  await run("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "biblequiz-local", "--local", "--persist-to", persistPath]);
  await run("pnpm", ["exec", "wrangler", "d1", "execute", "biblequiz-local", "--local", "--persist-to", persistPath, "--file", "tests/fixtures/published-quiz.sql"]);
}

try {
  await prepare();
} catch (error) {
  await rm(persistPath, { recursive: true, force: true });
  throw error;
}

const server = spawn("pnpm", ["dev:local", "--host", "127.0.0.1", "--port", "4173", "--strictPort"], {
  env: { ...process.env, BIBLEQUIZ_E2E_D1_PATH: persistPath },
  stdio: "inherit",
});

let stopping = false;
async function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  if (server.exitCode === null) server.kill(signal);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => void stop(signal));
}

server.once("error", (error) => {
  console.error(error);
  void stop();
});
server.once("exit", async (code) => {
  await rm(persistPath, { recursive: true, force: true });
  process.exit(code ?? 0);
});
