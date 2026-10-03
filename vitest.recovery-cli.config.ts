import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: { alias: { "cloudflare:workers": fileURLToPath(new URL("./scripts/test/local-recovery-env.mjs", import.meta.url)) } },
  test: { include: ["scripts/archived-intent-application.test.mjs"], testTimeout: 60_000, maxWorkers: 1 },
});
