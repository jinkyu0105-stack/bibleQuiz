import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadEnv } from "vite";

const config = JSON.parse(await readFile(new URL("../wrangler.production.jsonc", import.meta.url), "utf8"));
const siteKey = loadEnv("production", process.cwd(), "VITE_").VITE_TURNSTILE_SITE_KEY;
assert.equal(config.name, "biblequiz-app", "PRODUCTION_WORKER_REQUIRED");
assert.equal(config.vars?.OPERATIONS_ENVIRONMENT, "production", "PRODUCTION_ENVIRONMENT_REQUIRED");
assert.equal(config.vars?.TURNSTILE_EXPECTED_HOSTNAME, "biblequiz-app.jinkyu0105.workers.dev", "PRODUCTION_HOSTNAME_REQUIRED");
assert.ok(typeof siteKey === "string" && siteKey.trim().length > 0 && !/\s/u.test(siteKey), "PRODUCTION_TURNSTILE_SITE_KEY_REQUIRED");
assert.equal(siteKey, config.vars?.TURNSTILE_SITE_KEY, "PRODUCTION_TURNSTILE_SITE_KEY_MISMATCH");
console.log("PASS: Production hostname and public Turnstile build key match");
