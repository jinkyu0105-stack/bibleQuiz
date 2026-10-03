import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest(async () => ({
    wrangler: { configPath: "./wrangler.jsonc" },
    miniflare: {
      workflows: { CONTENT_WORKFLOW: { name: "biblequiz-content-local", className: "ContentWorkflow" } },
      bindings: { TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, "migrations")),
        AI_GENERATION_ENABLED: "true", OPENAI_API_KEY: "synthetic-test-key",
        ACCESS_AUD: "test-access-audience", ACCESS_TEAM_DOMAIN: "test-team.cloudflareaccess.com" },
    },
  }))],
  test: { include: ["workers/app/content-workflow.test.ts"], setupFiles: ["./workers/app/test/apply-migrations.ts"] },
});
