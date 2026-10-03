import { expect } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";

interface MigrationTestEnv extends Env {
  TEST_MIGRATIONS: D1Migration[];
}

const testEnv = env as MigrationTestEnv;

// These preserved v1 adapter/structure suites certify their original contract.
// P5-44 deliberately blocks v1 execution after upgrade; its separate disposable
// rehearsal tests 0013 and legacy blocking without migrating these writers.
const legacyGenerationSuites = new Set([
  "generation-storage-structure.test.ts", "generation-runtime.test.ts",
  "generation-result-storage-structure.test.ts", "generation-ai-result-store.test.ts",
  "human-content-runtime-store.test.ts",
]);
const testFile = expect.getState().testPath?.split(/[\\/]/u).at(-1);
const migrations = testFile && legacyGenerationSuites.has(testFile)
  ? testEnv.TEST_MIGRATIONS.filter((migration) => migration.name < "0013")
  : testEnv.TEST_MIGRATIONS;
await applyD1Migrations(testEnv.DB, migrations);
