// Explicit, one-fixture-at-a-time operator tool. Uses the real Access API and
// synthetic inputs only. No public route, API key, AI transport or publication.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const [approval, directory, profile, action] = process.argv.slice(2);
assert.equal(approval, "--execute-approved-preview");
assert.ok(directory && resolve(directory).startsWith("/home/onegem/.local/state/biblequiz/"));
assert.ok(["11715", "30000", "invalid_output"].includes(profile));
assert.ok(["seed", "start", "intent", "finish", "finish-only", "verify"].includes(action));
const root = resolve(directory), stateFile = `${root}/fixture-${profile}.json`;
const origin = "https://biblequiz-app-preview.jinkyu0105.workers.dev";
const marker = "P5_71_SYNTHETIC_ONLY";
const token = (await readFile("/home/onegem/.local/state/biblequiz/credentials/access.jwt", "utf8")).trim();
let state;
try { state = JSON.parse(await readFile(stateFile, "utf8")); }
catch (error) { if (error.code !== "ENOENT") throw error; }
const record = async event => {
  await appendFile(`${root}/http-${profile}.jsonl`, JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n", { mode: 0o600 });
  console.log(JSON.stringify(event));
};
const save = () => writeFile(stateFile, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
async function api(path, method = "GET", body) {
  assert.ok(path.startsWith("/api/admin/"));
  const response = await fetch(origin + path, { method, redirect: "manual", signal: AbortSignal.timeout(60_000),
    headers: { "user-agent": "Mozilla/5.0", Cookie: `CF_Authorization=${token}`, Origin: origin,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  let value;
  try { value = await response.json(); } catch { value = {}; }
  await record({ action, method, route: path.replace(/[a-f0-9-]{36}/gu, ":id"), status: response.status,
    ...(typeof value.error?.code === "string" && /^[A-Z_]+$/u.test(value.error.code) ? { error: value.error.code } : {}) });
  assert.ok(response.ok && value.data, `PREVIEW_REQUEST_FAILED_${response.status}`);
  return value.data;
}
const base = () => `/api/admin/sermons/${state.sermonId}`;
const view = () => api(`${base()}/generation/content`);
async function owned() {
  assert.equal(state?.profile, profile);
  const metadata = await api(`/api/admin/sermon-drafts/${state.sermonId}`);
  assert.equal(metadata.title, marker);
  assert.equal(metadata.youtubeUrl, `https://www.youtube.com/watch?v=${state.videoId}`);
  assert.equal(metadata.quizSetId, state.quizSetId);
}
async function waitFor(stage) {
  for (let i = 0; i < 30; i++) {
    const current = await view();
    await record({ status: current.status, stage: current.stage, version: current.version });
    assert.equal(current.jobId, state.jobId);
    if (current.stage === stage || current.status === stage) return current;
    assert.ok(!["failed", "uncertain", "needs_revision"].includes(current.status), "WORKFLOW_STOPPED");
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error("WORKFLOW_WAIT_EXPIRED_NO_RETRY");
}
const operation = body => api(`${base()}/generation/${state.jobId}/review`, "POST", body);

if (action === "seed") {
  assert.equal(state, undefined, "FIXTURE_ALREADY_EXISTS_USE_SAME_STATE");
  state = { profile, videoId: `P571${randomUUID().replaceAll("-", "").slice(0, 7)}`,
    characters: profile === "30000" ? 30000 : 11715, requestKey: randomUUID() };
  await save(); // Record identity before any write; never silently replace a partial fixture.
  const created = await api("/api/admin/sermon-drafts", "POST", { video: `https://youtu.be/${state.videoId}`,
    title: marker, sermonDate: "2026-09-27", referenceInput: "요 3:16", confirmed: true });
  assert.equal(created.outcome, "created");
  state.sermonId = created.sermonId; await save();
  const metadata = await api(`/api/admin/sermon-drafts/${state.sermonId}`);
  state.quizSetId = metadata.quizSetId; await save();
  const imported = await api(`${base()}/input`, "POST", { expectedVersion: 0, sourceMode: "manual_paste",
    manualSourceKind: "youtube_visible_transcript", sourceCoverage: "full_transcript",
    rawTranscriptText: marker + "가".repeat(state.characters - marker.length) });
  const input = imported.input;
  assert.equal(input.version, 1);
  await api(`${base()}/input`, "PATCH", { action: "confirm", expectedVersion: 1,
    sourceId: input.sourceId, documentId: input.documentId, documentSha256: input.documentSha256, reviewed: true });
  state.seeded = true; await save();
} else {
  await owned();
  if (action === "start") {
    assert.ok(state.seeded && !state.jobId, "START_ALREADY_RECORDED");
    const current = await view(); assert.equal(current.version, 2); assert.equal(current.jobId, null);
    const options = { gridSizes: [5, 6], targetWordCounts: [4], seed: "placement-test", maxTrials: 16, searchBudgetPerTrial: 3000 };
    const request = { requestKey: state.requestKey, quizSetId: state.quizSetId, expectedVersion: 2,
      selection: { child: { options, index: 0 }, adult: { options, index: 0 } } };
    state.startRequest = request; await save();
    const started = await api(`${base()}/generation/content`, "POST", request);
    state.jobId = started.jobId; await save();
    assert.equal(started.dispatch, "sent");
    await record({ jobId: state.jobId, dispatch: started.dispatch });
  } else if (action === "intent") {
    assert.notEqual(profile, "invalid_output");
    const current = await waitFor("intent_review");
    const critique = current.snapshots.find(s => s.kind === "intent" && s.value.kind === "critique");
    assert.ok(critique);
    await operation({ requestKey: randomUUID(), expectedVersion: current.version,
      operation: { family: "intent", operation: { kind: "select", analysisId: critique.value.id } } });
    const selected = await view();
    await operation({ requestKey: randomUUID(), expectedVersion: selected.version,
      operation: { family: "intent", operation: { kind: "confirm", analysisId: critique.value.id } } });
    const resumed = await api(`${base()}/generation/${state.jobId}/resume`, "POST", {});
    assert.equal(resumed.outcome, "sent");
    state.resumed = true; await save();
  } else if (action === "finish" || action === "finish-only") {
    assert.notEqual(profile, "invalid_output");
    let current = await waitFor("content_review");
    for (const family of ["summary", "child", "adult"]) {
      const id = current.content[family]?.id; assert.ok(id);
      if (action === "finish-only") {
        assert.ok(current.content[family]?.review?.id, "EXISTING_REVIEW_REQUIRED");
        continue;
      }
      const operation = family === "summary" ? { family, operation: { kind: "review", summaryId: id } } :
        { family: "candidate", operation: { kind: "review", difficulty: family, poolId: id } };
      await api(`${base()}/generation/${state.jobId}/review`, "POST", { requestKey: randomUUID(), expectedVersion: current.version, operation });
      current = await view();
    }
    state.finishRequestKey ??= randomUUID(); await save();
    let finished = await api(`${base()}/generation/${state.jobId}/finish`, "POST", { requestKey: state.finishRequestKey });
    if (finished.outcome === "queued") {
      assert.equal(finished.requestKey, state.finishRequestKey);
      for (let i = 0; i < 30; i++) {
        finished = await api(`${base()}/generation/${state.jobId}/final-check/${state.finishRequestKey}`);
        if (!["queued", "running"].includes(finished.outcome)) break;
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    assert.equal(finished.outcome, "review_ready", "FINAL_CHECK_STOPPED_NO_AUTOMATIC_RETRY");
    state.finished = true; await save();
  } else {
    const current = await view();
    assert.equal(current.jobId, state.jobId);
    assert.equal(current.status, profile === "invalid_output" ? "failed" : "review_ready");
    if (profile !== "invalid_output") assert.ok(current.preview);
    await record({ verified: true, status: current.status, stage: current.stage, version: current.version,
      jobUnknownCalls: current.jobUnknownCalls, syntheticCostMicroUsd: current.jobCostMicroUsd });
  }
}
