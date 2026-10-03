import path from "node:path";
import { randomBytes } from "node:crypto";

import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(
        path.join(import.meta.dirname, "migrations"),
      );

      return {
        miniflare: {
          r2Buckets: ["TEST_BACKUP_BUCKET"],
          ratelimits: { TEST_PUBLIC_LIMIT: {namespace_id:"80199",simple:{limit:6,period:10}} },
          durableObjects: {
            ADMIN_COMPUTE: { className: "AdminCompute", useSQLite: true },
          },
          bindings: {
            ACCESS_AUD: "test-access-audience",
            ACCESS_TEAM_DOMAIN: "test-team.cloudflareaccess.com",
            TEST_MIGRATIONS: migrations,
            ARCHIVE_CURSOR_SECRET: randomBytes(32).toString("hex"),
            SESSION_PEPPER: randomBytes(32).toString("hex"),
            TURNSTILE_EXPECTED_HOSTNAME: "example.com",
            TURNSTILE_SECRET: "test-turnstile-secret",
          },
        },
        wrangler: { configPath: "./wrangler.jsonc" },
      };
    }),
  ],
  test: {
    // Limit concurrent D1 actors: unrestricted parallelism can stall workerd after constraint-failure tests.
    maxWorkers: 4,
    reporters: "verbose",
    // D1 integration suites share the local Worker runtime during the full check.
    testTimeout: 30_000,
    include: ["workers/app/**/*.test.ts"],
    exclude: ["workers/app/content-workflow.test.ts"],
    setupFiles: ["./workers/app/test/apply-migrations.ts"],
  },
});
