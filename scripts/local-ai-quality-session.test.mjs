import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chmod, mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createSessionDirectory, qualityStorageRoot, readPrivateFile, requestSession, validateCommand, validateSettings } from "./local-ai-quality-session.mjs";

const settings = { accessTeamDomain: "test-team.cloudflareaccess.com", accessAudience: "synthetic-audience" };
test("paid activation requires explicit approval and an explicitly supplied key file", () => {
  assert.equal(validateSettings(settings).paidExecutionApproved, false);
  assert.throws(() => validateSettings({ ...settings, savedTranscriptFile: "relative.json" }));
  assert.equal(validateSettings({ ...settings, savedTranscriptFile: "/tmp/capture.json" }).savedTranscriptFile, "/tmp/capture.json");
  assert.throws(() => validateSettings({ ...settings, openAiKeyFile: "/tmp/key" }));
  assert.throws(() => validateSettings({ ...settings, paidExecutionApproved: true }));
  assert.throws(() => validateSettings({ ...settings, paidExecutionApproved: "true", openAiKeyFile: "/tmp/key" }));
  assert.throws(() => validateSettings({ ...settings, accessTeamDomain: "https://untrusted.example" }));
  assert.throws(() => validateSettings({ ...settings, remote: true }));
  assert.equal(validateSettings({ ...settings, paidExecutionApproved: true, openAiKeyFile: "/tmp/key" }).paidExecutionApproved, true);
});
test("review and polling remain available while unapproved generation and out-of-scope routes fail", () => {
  for (const route of ["content", "correction", "regenerate", "job/resume"]) {
    assert.throws(() => validateCommand({ method: "POST", path: `/api/admin/sermons/source/generation/${route}`, body: {} }, false));
  }
  for (const command of [
    { method: "POST", path: "/api/admin/sermons/source/generation/job/review", body: {} },
    { method: "GET", path: "/api/admin/sermons/source/generation/content" },
    { method: "POST", path: "/api/admin/sermons/source/input/saved-captions", body: { expectedVersion: 0, expectedSourceSha256: "a".repeat(64) } },
  ]) assert.equal(validateCommand(command, false), command);
  for (const route of ["https://example.com/api/admin/sermon-drafts", "//example.com", "/api/admin/quiz-sets/q/publish", "/api/admin/sermons/s/input/public-captions", "/api/admin/sermon-drafts/video-preview", "/api/admin/sermon-drafts?x=1", "/api/admin/sermons/../input"]) {
    assert.throws(() => validateCommand({ method: "POST", path: route, body: {} }, true));
  }
});
test("private file reader rejects shared permissions and symbolic links", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "biblequiz-quality-test-"));
  const file = path.join(directory, "private");
  await writeFile(file, "synthetic-only", { mode: 0o600 });
  assert.equal(await readPrivateFile(file), "synthetic-only");
  await chmod(file, 0o644);
  await assert.rejects(readPrivateFile(file));
  await chmod(file, 0o600);
  await symlink(file, path.join(directory, "link"));
  await assert.rejects(readPrivateFile(path.join(directory, "link")));
});
test("local publication needs its own approval; free review and placement remain available", () => {
  assert.equal(validateSettings(settings).localPublicationApproved, false);
  assert.throws(() => validateSettings({ ...settings, localPublicationApproved: "true" }));
  assert.equal(validateSettings({ ...settings, localPublicationApproved: true }).localPublicationApproved, true);
  const publish = { method: "POST", path: "/api/admin/quiz-sets/quiz/publish", body: {} };
  assert.throws(() => validateCommand(publish, true), /LOCAL_PUBLICATION_NOT_APPROVED/u);
  assert.throws(() => validateCommand(publish, false, "true"), /LOCAL_PUBLICATION_NOT_APPROVED/u);
  assert.equal(validateCommand(publish, false, true), publish);
  for (const operation of ["quality", "placement-trial", "placement-select"]) {
    const command = { method: "POST", path: `/api/admin/sermons/sermon/generation/job/${operation}`, body: {} };
    assert.equal(validateCommand(command, false), command);
  }
  assert.throws(() => validateCommand({ method: "POST", path: "/api/admin/sermons/sermon/generation/content", body: {} }, false, true), /PAID_EXECUTION_NOT_APPROVED/u);
});
test("local client sends one authenticated request, stores private output, and never follows redirects", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "biblequiz-quality-client-test-"));
  let calls = 0, status = 200, assertion;
  const server = createServer((request, response) => {
    calls++; assertion = request.headers["cf-access-jwt-assertion"];
    assert.equal(request.headers.origin, `http://${request.headers.host}`);
    response.writeHead(status, { "Content-Type": "application/json", Location: "https://must-not-be-contacted.invalid" });
    response.end(JSON.stringify({ privateSyntheticText: "synthetic-content-only" }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const save = (name, value) => writeFile(path.join(directory, name), JSON.stringify(value), { mode: 0o600 });
  await save("session.json", { schema: "biblequiz-local-quality-session-v1", running: true, paidEnabled: false, origin });
  await save("command.json", { method: "GET", path: "/api/admin/sermon-drafts" });
  await writeFile(path.join(directory, "token"), "synthetic.token.signature", { mode: 0o600 });
  try {
    const result = await requestSession(directory, path.join(directory, "command.json"), path.join(directory, "token"));
    assert.equal(result.status, 200); assert.equal(calls, 1); assert.equal(assertion, "synthetic.token.signature");
    assert.equal(JSON.stringify(result).includes("synthetic-content-only"), false);
    assert.equal(JSON.parse(await readPrivateFile(result.responsePath)).data.privateSyntheticText, "synthetic-content-only");
    status = 401;
    assert.equal((await requestSession(directory, path.join(directory, "command.json"), path.join(directory, "token"))).status, 401);
    assert.equal(calls, 2);
    status = 302;
    await assert.rejects(requestSession(directory, path.join(directory, "command.json"), path.join(directory, "token")));
    assert.equal(calls, 3);
    await save("session.json", { schema: "biblequiz-local-quality-session-v1", running: false, origin });
    await assert.rejects(requestSession(directory, path.join(directory, "command.json"), path.join(directory, "token")));
    assert.equal(calls, 3);
    assert.ok(await readFile(path.join(directory, "session.json")));
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("trial storage defaults to the user state directory and preserves independent sessions", async () => {
  assert.equal(qualityStorageRoot, path.join(homedir(), ".local", "state", "biblequiz"));
  const parent = await mkdtemp(path.join(tmpdir(), "biblequiz-durable-test-"));
  const first = await createSessionDirectory(parent);
  await writeFile(path.join(first, "saved-source"), "synthetic-source", { mode: 0o600 });
  const second = await createSessionDirectory(parent);
  assert.notEqual(first, second);
  assert.equal(await readFile(path.join(first, "saved-source"), "utf8"), "synthetic-source");
  assert.equal((await stat(first)).mode & 0o777, 0o700);
  await chmod(parent, 0o755);
  await assert.rejects(createSessionDirectory(parent), /PRIVATE_DIRECTORY_REQUIRED/u);
});
test("trial storage rejects a symbolic-link parent", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "biblequiz-storage-link-test-"));
  const link = `${parent}-link`;
  await symlink(parent, link);
  await assert.rejects(createSessionDirectory(link), /PRIVATE_DIRECTORY_REQUIRED/u);
});
