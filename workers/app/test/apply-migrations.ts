import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";

interface MigrationTestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

const testEnv = env as MigrationTestEnv;

await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
