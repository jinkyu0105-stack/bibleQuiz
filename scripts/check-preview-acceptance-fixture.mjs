// Local-only rehearsal for the P4-23 Preview acceptance candidate.
// It uses a fresh /tmp D1 and localhost; no Cloudflare account or remote data is touched.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, rm, mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const wrangler = path.join(path.dirname(require.resolve("wrangler/package.json")), "bin/wrangler.js");
const vite = path.join(path.dirname(require.resolve("vite/package.json")), "bin/vite.js");
const config = path.join(root, "wrangler.jsonc");
const fixture = path.join(root, "tests/fixtures/preview-acceptance.sql");
const cancellation = path.join(root, "tests/fixtures/preview-acceptance-cancel.sql");
const temp = await mkdtemp(path.join(tmpdir(), "biblequiz-preview-acceptance-"));
const state = path.join(temp, "state");
const wranglerLog = path.join(temp, "wrangler.log");
const database = "biblequiz-local";
let server;
let serverOutput = "";

function runD1(args, options = {}) {
  const child = spawnSync(process.execPath, [wrangler, "d1", ...args,
    "--local", "--config", config, "--persist-to", state], {
    cwd: root,
    env: {
      ...process.env,
      CI: "true",
      WRANGLER_SEND_METRICS: "false",
      WRANGLER_LOG_PATH: wranglerLog,
    },
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (child.error) throw child.error;
  const output = child.stdout + child.stderr;
  if (options.expectFailure) {
    assert.notEqual(child.status, 0, "Applying the one-shot fixture twice must fail");
    assert.match(output, /UNIQUE constraint failed/u);
  } else {
    assert.equal(child.status, 0, output);
  }
  return child.stdout;
}

function query(sql) {
  const result = JSON.parse(runD1(["execute", database, "--command", sql, "--json"]));
  assert.ok(result.every((item) => item.success));
  return result.map((item) => item.results);
}

function fixtureCounts() {
  return query(`
    SELECT
      (SELECT count(*) FROM bible_translations WHERE id = 'p423-preview-translation') AS translations,
      (SELECT count(*) FROM sermons WHERE id = 'p423-preview-sermon') AS sermons,
      (SELECT count(*) FROM sermon_transcripts WHERE sermon_id = 'p423-preview-sermon') AS transcripts,
      (SELECT count(*) FROM quiz_sets WHERE id = 'p423-preview-set') AS quiz_sets,
      (SELECT count(*) FROM quiz_variants WHERE id = 'p423-preview-child') AS variants,
      (SELECT count(*) FROM quiz_entries_public WHERE quiz_variant_id = 'p423-preview-child') AS entries,
      (SELECT count(*) FROM quiz_solutions WHERE quiz_variant_id = 'p423-preview-child') AS solutions,
      (SELECT count(*) FROM submissions WHERE quiz_variant_id = 'p423-preview-child') AS submissions;
  `)[0][0];
}

async function freePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  assert.ok(address && typeof address === "object");
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function startServer() {
  const port = await freePort();
  server = spawn(process.execPath, [vite, "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: root,
    env: {
      ...process.env,
      BIBLEQUIZ_E2E_D1_PATH: state,
      WRANGLER_SEND_METRICS: "false",
      WRANGLER_LOG_PATH: wranglerLog,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const record = (chunk) => {
    serverOutput = (serverOutput + chunk.toString()).slice(-16_000);
  };
  server.stdout.on("data", record);
  server.stderr.on("data", record);

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    assert.equal(server.exitCode, null, serverOutput);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return { port };
    } catch {
      // Vite and the local Worker are still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.fail(`Local acceptance server did not start in time.\n${serverOutput}`);
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  server.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => server.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (server.exitCode === null) server.kill("SIGKILL");
}

try {
  const [fixtureSource, cancellationSource] = await Promise.all([
    readFile(fixture, "utf8"),
    readFile(cancellation, "utf8"),
  ]);
  for (const forbidden of ["PRIVATE_E2E_CANARY", "INSERT INTO sermon_transcripts", "INSERT INTO site_state"]) {
    assert.ok(!fixtureSource.includes(forbidden), `Preview candidate must not contain ${forbidden}`);
  }
  assert.match(fixtureSource, /bible_text_snapshot, ai_summary, ai_summary_disclosure[\s\S]*NULL, NULL, NULL/u);
  assert.match(cancellationSource, /NOT EXISTS[\s\S]*FROM submissions/u);

  runD1(["migrations", "apply", database]);
  runD1(["execute", database, "--file", fixture, "--json"]);
  assert.deepEqual(fixtureCounts(), {
    translations: 1, sermons: 1, transcripts: 0, quiz_sets: 1,
    variants: 1, entries: 6, solutions: 1, submissions: 0,
  });
  assert.deepEqual(query("PRAGMA foreign_key_check;")[0], []);
  assert.deepEqual(query("PRAGMA quick_check;")[0], [{ quick_check: "ok" }]);

  const [[solution]] = query(`
    SELECT solution_cells_json, solution_sha256
    FROM quiz_solutions WHERE quiz_variant_id = 'p423-preview-child';
  `);
  assert.equal(createHash("sha256").update(solution.solution_cells_json).digest("hex"), solution.solution_sha256);

  runD1(["execute", database, "--file", fixture, "--json"], { expectFailure: true });
  assert.deepEqual(fixtureCounts(), {
    translations: 1, sermons: 1, transcripts: 0, quiz_sets: 1,
    variants: 1, entries: 6, solutions: 1, submissions: 0,
  });
  console.log("PASS: one-shot synthetic fixture is complete, internally valid, and collision-safe");

  const { port } = await startServer();
  const response = await fetch(`http://127.0.0.1:${port}/api/quizzes/2026-09-05-p423qa?difficulty=child`);
  assert.equal(response.status, 200);
  const raw = await response.text();
  const body = JSON.parse(raw);
  const quiz = body.data.quiz;
  assert.equal(quiz.slug, "2026-09-05-p423qa");
  assert.equal(quiz.sermon.title, "기능 확인용 연습 문제 — 실제 설교 아님");
  assert.equal(quiz.sermon.summary, null);
  assert.equal(quiz.variant.id, "p423-preview-child");
  assert.equal(quiz.variant.grid.cells.length, 21);
  assert.equal(quiz.variant.grid.entries.length, 6);
  assert.equal(quiz.acceptingSubmissions, true);
  for (const forbidden of ["solution_cells_json", "solutionSha256", "entry_answers", "504e672a75b2bb9e"]) {
    assert.ok(!raw.includes(forbidden), `Public API exposed ${forbidden}`);
  }
  await stopServer();
  console.log("PASS: public API reads the candidate and keeps server-only answers private");

  // A local-only fake submission proves cancellation preserves participation records.
  runD1(["execute", database, "--command", `
    INSERT INTO anonymous_sessions (session_hash, created_at, last_seen_at, expires_at)
    VALUES (
      '${"0".repeat(64)}',
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 day')
    );
    INSERT INTO submissions (
      id, quiz_variant_id, quiz_revision, session_hash, idempotency_key, request_hash,
      display_name, comment, answers_json, correctness_mask, correct_cells, total_cells,
      correct_words, total_words, score_basis_points, is_fully_correct, status, submitted_at
    ) VALUES (
      'p423-preview-submission', 'p423-preview-child', 1, '${"0".repeat(64)}',
      '00000000-0000-7000-8000-000000000001', '${"1".repeat(64)}',
      '기능확인참여자', NULL, '{"r0c0":"가"}', '100000000000000000000',
      1, 21, 0, 6, 476, 0, 'visible', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    );
  `, "--json"]);
  runD1(["execute", database, "--file", cancellation, "--json"]);
  assert.deepEqual(fixtureCounts(), {
    translations: 1, sermons: 1, transcripts: 0, quiz_sets: 1,
    variants: 1, entries: 6, solutions: 1, submissions: 1,
  });
  console.log("PASS: cancellation refuses to remove a candidate with participation data");

  // Test teardown only: real Preview participation must use the documented retention flow.
  runD1(["execute", database, "--command", `
    DELETE FROM submissions WHERE id = 'p423-preview-submission';
    DELETE FROM anonymous_sessions WHERE session_hash = '${"0".repeat(64)}';
  `, "--json"]);
  runD1(["execute", database, "--file", cancellation, "--json"]);
  assert.deepEqual(fixtureCounts(), {
    translations: 0, sermons: 0, transcripts: 0, quiz_sets: 0,
    variants: 0, entries: 0, solutions: 0, submissions: 0,
  });
  assert.deepEqual(query("PRAGMA foreign_key_check;")[0], []);
  assert.deepEqual(query("PRAGMA quick_check;")[0], [{ quick_check: "ok" }]);
  console.log("PASS: cancellation removes only the unused synthetic candidate; FK/quick_check clean");
} finally {
  await stopServer();
  await rm(temp, { recursive: true, force: true });
}
