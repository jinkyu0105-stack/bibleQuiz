import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  adminSermonInputComparisonSuccessSchema,
  adminSermonInputCorrectionSuccessSchema,
  adminSermonInputHistorySuccessSchema,
  adminSermonInputMutationSuccessSchema,
  adminSermonInputSuccessSchema,
} from "../../shared/api/admin-sermon-input";
import { createDatabase } from "../_shared/db/client";
import { createSermonInputStore } from "../_shared/repositories/sermon-input-store";
import { createAccessFixture } from "./test/access-fixture";
import { seedMetadataSermon } from "./test/sermon-metadata-fixture";

const origin = "https://example.com";
const database = createDatabase((env as Env).DB);

async function setup() {
  const sermonId = crypto.randomUUID();
  await seedMetadataSermon(database, sermonId);
  const fixture = await createAccessFixture(new Date());
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(fixture.jwks));
  return {
    endpoint: `${origin}/api/admin/sermons/${sermonId}/input`,
    fixture,
    sermonId,
  };
}

function request(
  endpoint: string,
  token: string | undefined,
  body: unknown,
  headers: HeadersInit = {},
) {
  return exports.default.fetch(new Request(endpoint, {
    body: JSON.stringify(body),
    headers: {
      ...(token === undefined ? {} : { "Cf-Access-Jwt-Assertion": token }),
      "Content-Type": "application/json",
      Origin: origin,
      ...headers,
    },
    method: "POST",
  }));
}

function mutationRequest(
  endpoint: string,
  token: string | undefined,
  body: unknown,
  headers: HeadersInit = {},
) {
  return exports.default.fetch(new Request(endpoint, {
    body: JSON.stringify(body),
    headers: {
      ...(token === undefined ? {} : { "Cf-Access-Jwt-Assertion": token }),
      "Content-Type": "application/json",
      Origin: origin,
      ...headers,
    },
    method: "PATCH",
  }));
}

function privateGet(endpoint: string, token?: string) {
  return exports.default.fetch(new Request(endpoint, {
    headers: token === undefined ? {} : { "Cf-Access-Jwt-Assertion": token },
  }));
}

function expectation(head: {
  documentId: string;
  documentSha256: string;
  sourceId: string;
  version: number;
}) {
  return {
    expectedVersion: head.version,
    sourceId: head.sourceId,
    documentId: head.documentId,
    documentSha256: head.documentSha256,
  };
}

function correctionItem(originalText: string) {
  return {
    id: "fix",
    segmentId: null,
    start: null,
    duration: null,
    from: 0,
    to: originalText.length,
    originalText,
    proposedText: "TEST_ONLY_CORRECT",
    changeType: "spelling" as const,
    reason: "TEST_ONLY_REASON",
    confidence: 0.9,
    riskFlags: ["needs_review" as const],
    contextBefore: "",
    contextAfter: "",
  };
}

function manualInput(
  rawTranscriptText: string,
  manualSourceKind: "youtube_visible_transcript" | "sermon_manuscript" | "sermon_summary" = "youtube_visible_transcript",
) {
  const youtube = manualSourceKind === "youtube_visible_transcript";
  return {
    expectedVersion: 0 as const,
    sourceMode: youtube ? "manual_paste" as const : "sermon_notes" as const,
    manualSourceKind,
    sourceCoverage: youtube ? "full_transcript" as const : "partial_notes" as const,
    rawTranscriptText,
  };
}

describe("administrator sermon input routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("authenticates before method, query, body, and database handling", async () => {
    const certs = vi.spyOn(globalThis, "fetch");
    const response = await request(
      `${origin}/api/admin/sermons/not-present/input?unexpected=1`,
      undefined,
      { privateText: "TEST_ONLY_PRIVATE" },
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ADMIN_AUTH_REQUIRED" },
    });
    expect(certs).not.toHaveBeenCalled();

    const patchResponse = await mutationRequest(
      `${origin}/api/admin/sermons/not-present/input?unexpected=1`,
      undefined,
      { action: "not-a-command", privateText: "TEST_ONLY_PRIVATE" },
    );
    expect(patchResponse.status).toBe(401);
    await expect(patchResponse.json()).resolves.toMatchObject({
      error: { code: "ADMIN_AUTH_REQUIRED" },
    });
    for (const path of [
      "history?unexpected=1",
      "comparison?sourceId=x&leftDocumentId=y&rightDocumentId=z",
      "corrections/proposal?unexpected=1",
    ]) {
      const readResponse = await privateGet(
        `${origin}/api/admin/sermons/not-present/input/${path}`,
      );
      expect(readResponse.status).toBe(401);
      await expect(readResponse.json()).resolves.toMatchObject({
        error: { code: "ADMIN_AUTH_REQUIRED" },
      });
    }
    expect(certs).not.toHaveBeenCalled();
  });

  it("returns null for an existing sermon without input and never exposes it publicly", async () => {
    const { endpoint, fixture, sermonId } = await setup();
    const response = await exports.default.fetch(new Request(endpoint, {
      headers: { "Cf-Access-Jwt-Assertion": fixture.token },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(adminSermonInputSuccessSchema.parse(await response.json())).toEqual({
      data: { input: null },
    });

    const historyResponse = await privateGet(`${endpoint}/history`, fixture.token);
    expect(historyResponse.status).toBe(200);
    expect(adminSermonInputHistorySuccessSchema.parse(await historyResponse.json())).toEqual({
      data: { history: null },
    });

    const publicResponse = await exports.default.fetch(new Request(
      `${origin}/api/sermons/${sermonId}/input`,
    ));
    expect(publicResponse.status).toBe(404);
  });

  it.each([
    ["youtube_visible_transcript", "manual_paste", "full_transcript"],
    ["sermon_manuscript", "sermon_notes", "partial_notes"],
    ["sermon_summary", "sermon_notes", "partial_notes"],
  ] as const)("stores and reloads one lossless %s original", async (
    manualSourceKind,
    sourceMode,
    sourceCoverage,
  ) => {
    const { endpoint, fixture, sermonId } = await setup();
    const text = `TEST_ONLY_${manualSourceKind}\r\n"그대로"\\끝`;
    const saved = await request(
      endpoint,
      fixture.token,
      manualInput(text, manualSourceKind),
    );
    const savedText = await saved.text();
    expect(saved.status).toBe(200);
    expect(saved.headers.get("cache-control")).toBe("private, no-store");
    const savedData = adminSermonInputSuccessSchema.parse(JSON.parse(savedText));
    expect(savedData.data.input).toMatchObject({
      version: 1,
      source: { sourceMode, manualSourceKind, sourceCoverage },
      content: { format: "plain_text", text },
    });
    expect(savedText).not.toContain("admin@example.com");
    expect(savedText).not.toContain("rawTranscriptSha256");
    expect(savedText).not.toContain("actor");

    const loaded = await exports.default.fetch(new Request(endpoint, {
      headers: { "Cf-Access-Jwt-Assertion": fixture.token },
    }));
    expect(loaded.status).toBe(200);
    expect(adminSermonInputSuccessSchema.parse(await loaded.json())).toEqual(savedData);

    const events = await (env as Env).DB.prepare(
      "SELECT kind, actor_id FROM sermon_input_events WHERE sermon_id = ? ORDER BY version",
    ).bind(sermonId).all<{ actor_id: string; kind: string }>();
    expect(events.results).toHaveLength(1);
    expect(events.results[0]).toMatchObject({ kind: "source" });
    expect(events.results[0]!.actor_id).toMatch(/^[0-9a-f]{64}$/u);
    expect(events.results[0]!.actor_id).not.toContain("admin");
  });

  it("accepts exactly 30,000 caption characters and rejects 30,001 without a second write", async () => {
    const { endpoint, fixture, sermonId } = await setup();
    const accepted = await request(
      endpoint,
      fixture.token,
      manualInput("가".repeat(30_000)),
    );
    expect(accepted.status).toBe(200);

    const rejectedSetup = await setup();
    const rejected = await request(
      rejectedSetup.endpoint,
      rejectedSetup.fixture.token,
      manualInput("가".repeat(30_001)),
    );
    expect(rejected.status).toBe(422);
    await expect(rejected.json()).resolves.toMatchObject({
      error: { code: "INPUT_TOO_LARGE" },
    });

    const savedCount = await (env as Env).DB.prepare(
      "SELECT count(*) AS count FROM sermon_input_events WHERE sermon_id IN (?, ?)",
    ).bind(sermonId, rejectedSetup.sermonId).first<{ count: number }>();
    expect(savedCount?.count).toBe(1);
  });

  it("keeps first-registration CAS and strict private request boundaries", async () => {
    const { endpoint, fixture, sermonId } = await setup();
    const first = await request(endpoint, fixture.token, manualInput("TEST_ONLY_FIRST"));
    expect(first.status).toBe(200);

    const conflict = await request(endpoint, fixture.token, manualInput("TEST_ONLY_SECOND"));
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      error: { code: "INPUT_CONFLICT" },
    });

    const sourceReplacement = await request(endpoint, fixture.token, {
      ...manualInput("TEST_ONLY_REPLACEMENT"),
      expectedVersion: 1,
    });
    expect(sourceReplacement.status).toBe(400);
    await expect(sourceReplacement.json()).resolves.toMatchObject({
      error: { code: "INVALID_SERMON_INPUT_REQUEST" },
    });

    const extra = await request(endpoint, fixture.token, {
      ...manualInput("TEST_ONLY_EXTRA"),
      adminEmail: "attacker@example.com",
    });
    expect(extra.status).toBe(400);
    await expect(extra.json()).resolves.toMatchObject({
      error: { code: "INVALID_SERMON_INPUT_REQUEST" },
    });

    const wrongCombination = await request(endpoint, fixture.token, {
      ...manualInput("TEST_ONLY_WRONG"),
      sourceMode: "sermon_notes",
    });
    expect(wrongCombination.status).toBe(422);
    await expect(wrongCombination.json()).resolves.toMatchObject({
      error: { code: "MANUAL_SOURCE_MISMATCH" },
    });

    const wrongMethod = await exports.default.fetch(new Request(endpoint, {
      headers: { "Cf-Access-Jwt-Assertion": fixture.token },
      method: "DELETE",
    }));
    expect(wrongMethod.status).toBe(405);

    const rows = await (env as Env).DB.prepare(
      "SELECT count(*) AS count FROM sermon_input_events WHERE sermon_id = ?",
    ).bind(sermonId).first<{ count: number }>();
    expect(rows?.count).toBe(1);
  });

  it("edits, confirms, and restores a caption while preserving every earlier record", async () => {
    const { endpoint, fixture, sermonId } = await setup();
    const originalText = "TEST_ONLY_ORIGINAL\r\n그대로";
    const importedResponse = await request(
      endpoint,
      fixture.token,
      manualInput(originalText),
    );
    const imported = adminSermonInputSuccessSchema.parse(await importedResponse.json()).data.input;
    if (imported === null) throw new Error("Synthetic import missing");

    const editedResponse = await mutationRequest(endpoint, fixture.token, {
      action: "edit",
      ...expectation(imported),
      content: { format: "plain_text", text: "TEST_ONLY_EDITED\n수정" },
    });
    expect(editedResponse.status).toBe(200);
    const editedText = await editedResponse.text();
    const edited = adminSermonInputMutationSuccessSchema.parse(JSON.parse(editedText)).data.head;
    expect(edited).toMatchObject({
      version: 2,
      sourceId: imported.sourceId,
      confirmationId: null,
    });
    expect(edited.documentId).not.toBe(imported.documentId);
    expect(editedText).not.toContain("TEST_ONLY_EDITED");
    expect(editedText).not.toContain("admin@example.com");
    expect(editedText).not.toContain("actor");

    const confirmedResponse = await mutationRequest(endpoint, fixture.token, {
      action: "confirm",
      ...expectation(edited),
      reviewed: true,
    });
    expect(confirmedResponse.status).toBe(200);
    const confirmed = adminSermonInputMutationSuccessSchema.parse(
      await confirmedResponse.json(),
    ).data.head;
    expect(confirmed).toMatchObject({
      version: 3,
      documentId: edited.documentId,
      documentSha256: edited.documentSha256,
    });
    expect(confirmed.confirmationId).not.toBeNull();

    const restoredResponse = await mutationRequest(endpoint, fixture.token, {
      action: "restore",
      ...expectation(confirmed),
      restoreDocumentId: imported.documentId,
    });
    expect(restoredResponse.status).toBe(200);
    const restored = adminSermonInputMutationSuccessSchema.parse(
      await restoredResponse.json(),
    ).data.head;
    expect(restored).toMatchObject({
      version: 4,
      sourceId: imported.sourceId,
      confirmationId: null,
    });
    expect(restored.documentId).not.toBe(imported.documentId);
    expect(restored.documentId).not.toBe(edited.documentId);

    const loaded = await exports.default.fetch(new Request(endpoint, {
      headers: { "Cf-Access-Jwt-Assertion": fixture.token },
    }));
    expect(adminSermonInputSuccessSchema.parse(await loaded.json()).data.input).toMatchObject({
      version: 4,
      documentId: restored.documentId,
      content: { format: "plain_text", text: originalText },
    });

    const stale = await mutationRequest(endpoint, fixture.token, {
      action: "edit",
      ...expectation(edited),
      content: { format: "plain_text", text: "TEST_ONLY_STALE" },
    });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({
      error: { code: "INPUT_CONFLICT" },
    });

    const events = await (env as Env).DB.prepare(
      "SELECT kind, source_id, document_id FROM sermon_input_events WHERE sermon_id = ? ORDER BY version",
    ).bind(sermonId).all<{ document_id: string; kind: string; source_id: string }>();
    expect(events.results.map((event) => event.kind)).toEqual([
      "source",
      "edit",
      "confirm",
      "restore",
    ]);
    expect(new Set(events.results.map((event) => event.source_id))).toEqual(
      new Set([imported.sourceId]),
    );

    const historyResponse = await privateGet(`${endpoint}/history`, fixture.token);
    expect(historyResponse.status).toBe(200);
    expect(historyResponse.headers.get("cache-control")).toBe("private, no-store");
    const historyText = await historyResponse.text();
    const history = adminSermonInputHistorySuccessSchema.parse(JSON.parse(historyText));
    expect(history.data.history?.events.map((event) => event.kind)).toEqual([
      "source", "edit", "confirm", "restore",
    ]);
    expect(historyText).not.toContain(originalText);
    expect(historyText).not.toContain("TEST_ONLY_EDITED");
    expect(historyText).not.toContain("actor");
    expect(historyText).not.toContain("sha256");
    expect(historyText).not.toContain("byteLength");

    const comparisonQuery = new URLSearchParams({
      sourceId: imported.sourceId,
      leftDocumentId: imported.documentId,
      rightDocumentId: edited.documentId,
    });
    const comparisonResponse = await privateGet(
      `${endpoint}/comparison?${comparisonQuery.toString()}`,
      fixture.token,
    );
    expect(comparisonResponse.status).toBe(200);
    expect(adminSermonInputComparisonSuccessSchema.parse(
      await comparisonResponse.json(),
    ).data.comparison).toEqual({
      sourceId: imported.sourceId,
      left: {
        documentId: imported.documentId,
        content: { format: "plain_text", text: originalText },
      },
      right: {
        documentId: edited.documentId,
        content: { format: "plain_text", text: "TEST_ONLY_EDITED\n수정" },
      },
    });
  });

  it("keeps one edit winner for the same current version and leaves the loser unrecorded", async () => {
    const { endpoint, fixture, sermonId } = await setup();
    const importedResponse = await request(
      endpoint,
      fixture.token,
      manualInput("TEST_ONLY_CONCURRENT_ORIGINAL"),
    );
    const imported = adminSermonInputSuccessSchema.parse(await importedResponse.json()).data.input;
    if (imported === null) throw new Error("Synthetic import missing");

    const responses = await Promise.all(["FIRST", "SECOND"].map((suffix) => mutationRequest(
      endpoint,
      fixture.token,
      {
        action: "edit",
        ...expectation(imported),
        content: { format: "plain_text", text: `TEST_ONLY_${suffix}` },
      },
    )));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const rows = await (env as Env).DB.prepare(
      "SELECT kind FROM sermon_input_events WHERE sermon_id = ? ORDER BY version",
    ).bind(sermonId).all<{ kind: string }>();
    expect(rows.results.map((row) => row.kind)).toEqual(["source", "edit"]);
  });

  it.each(["sermon_manuscript", "sermon_summary"] as const)(
    "rejects every editing command for pastor-provided %s without a record",
    async (manualSourceKind) => {
      const { endpoint, fixture, sermonId } = await setup();
      const importedResponse = await request(
        endpoint,
        fixture.token,
        manualInput("TEST_ONLY_PASTOR", manualSourceKind),
      );
      const imported = adminSermonInputSuccessSchema.parse(
        await importedResponse.json(),
      ).data.input;
      if (imported === null) throw new Error("Synthetic import missing");
      const proposal = {
        sourceId: imported.sourceId,
        sourceSha256: imported.documentSha256,
        baseDocumentId: imported.documentId,
        baseDocumentSha256: imported.documentSha256,
        items: [correctionItem("TEST_ONLY_PASTOR")],
      };
      const commands = [
        { action: "edit", content: { format: "plain_text", text: "TEST_ONLY_EDIT" } },
        { action: "restore", restoreDocumentId: imported.documentId },
        { action: "propose_corrections", proposal },
        {
          action: "decide_corrections",
          proposalId: "proposal",
          decisions: [{ itemId: "fix", decision: "accepted" }],
          reviewed: true,
        },
        { action: "merge_corrections", proposalId: "proposal" },
      ];
      for (const command of commands) {
        const response = await mutationRequest(endpoint, fixture.token, {
          ...command,
          ...expectation(imported),
        });
        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toMatchObject({
          error: { code: "INPUT_READ_ONLY" },
        });
      }
      const rows = await (env as Env).DB.prepare(
        "SELECT count(*) AS count FROM sermon_input_events WHERE sermon_id = ?",
      ).bind(sermonId).first<{ count: number }>();
      expect(rows?.count).toBe(1);
    },
  );

  it("stores a synthetic correction proposal, decision, and merge without exposing private proposal data", async () => {
    const { endpoint, fixture, sermonId } = await setup();
    const originalText = "TEST_ONLY_WRONG";
    const importedResponse = await request(
      endpoint,
      fixture.token,
      manualInput(originalText),
    );
    const imported = adminSermonInputSuccessSchema.parse(await importedResponse.json()).data.input;
    if (imported === null) throw new Error("Synthetic import missing");

    const proposedResponse = await mutationRequest(endpoint, fixture.token, {
      action: "propose_corrections",
      ...expectation(imported),
      proposal: {
        sourceId: imported.sourceId,
        sourceSha256: imported.documentSha256,
        baseDocumentId: imported.documentId,
        baseDocumentSha256: imported.documentSha256,
        items: [correctionItem(originalText)],
      },
    });
    expect(proposedResponse.status).toBe(200);
    const proposedText = await proposedResponse.text();
    const proposed = adminSermonInputMutationSuccessSchema.parse(
      JSON.parse(proposedText),
    ).data.head;
    expect(proposed).toMatchObject({
      version: 2,
      documentId: imported.documentId,
      documentSha256: imported.documentSha256,
    });
    expect(proposedText).not.toContain("TEST_ONLY_REASON");
    expect(proposedText).not.toContain(originalText);

    const decidedResponse = await mutationRequest(endpoint, fixture.token, {
      action: "decide_corrections",
      ...expectation(proposed),
      proposalId: proposed.eventId,
      decisions: [{ itemId: "fix", decision: "accepted" }],
      reviewed: true,
    });
    expect(decidedResponse.status).toBe(200);
    const decided = adminSermonInputMutationSuccessSchema.parse(
      await decidedResponse.json(),
    ).data.head;
    expect(decided).toMatchObject({ version: 3, documentId: imported.documentId });

    const mergedResponse = await mutationRequest(endpoint, fixture.token, {
      action: "merge_corrections",
      ...expectation(decided),
      proposalId: proposed.eventId,
    });
    expect(mergedResponse.status).toBe(200);
    const merged = adminSermonInputMutationSuccessSchema.parse(
      await mergedResponse.json(),
    ).data.head;
    expect(merged).toMatchObject({ version: 4, confirmationId: null });
    expect(merged.documentId).not.toBe(imported.documentId);

    const loaded = await exports.default.fetch(new Request(endpoint, {
      headers: { "Cf-Access-Jwt-Assertion": fixture.token },
    }));
    expect(adminSermonInputSuccessSchema.parse(await loaded.json()).data.input).toMatchObject({
      version: 4,
      content: { format: "plain_text", text: "TEST_ONLY_CORRECT" },
    });
    const events = await (env as Env).DB.prepare(
      "SELECT kind FROM sermon_input_events WHERE sermon_id = ? ORDER BY version",
    ).bind(sermonId).all<{ kind: string }>();
    expect(events.results.map((event) => event.kind)).toEqual([
      "source",
      "proposal",
      "decision",
      "merge",
    ]);

    const correctionResponse = await privateGet(
      `${endpoint}/corrections/${proposed.eventId}`,
      fixture.token,
    );
    expect(correctionResponse.status).toBe(200);
    const correctionText = await correctionResponse.text();
    const correction = adminSermonInputCorrectionSuccessSchema.parse(
      JSON.parse(correctionText),
    ).data.correction;
    expect(correction.proposal).toMatchObject({
      proposalId: proposed.eventId,
      sourceId: imported.sourceId,
      baseDocumentId: imported.documentId,
      items: [{ id: "fix", originalText, proposedText: "TEST_ONLY_CORRECT" }],
    });
    if (!("decisions" in correction)) throw new Error("Expected legacy correction");
    expect(correction.decisions).toHaveLength(1);
    expect(correction.decisions[0]).toMatchObject({
      decisions: [{ itemId: "fix", decision: "accepted" }],
    });
    expect(correctionText).not.toContain("sourceSha256");
    expect(correctionText).not.toContain("baseDocumentSha256");
    expect(correctionText).not.toContain("actor");
    expect(correctionText).not.toContain("admin@example.com");
  });

  it("reads and applies a stored document proposal through Access, then confirms separately", async () => {
    const { endpoint, fixture, sermonId } = await setup();
    const importedResponse = await request(endpoint, fixture.token, manualInput("TEST_ONLY_ORIGINAL"));
    const imported = adminSermonInputSuccessSchema.parse(await importedResponse.json()).data.input;
    if (!imported) throw new Error("Synthetic import missing");
    const store = createSermonInputStore((env as Env).DB);
    const original = await store.head(sermonId);
    if (!original) throw new Error("Synthetic source missing");
    const proposalId = crypto.randomUUID();
    const proposal = { kind: "correction_document_v1", sourceId: original.source_id,
      sourceSha256: original.document_sha256, baseDocumentId: original.document_id,
      baseDocumentSha256: original.document_sha256,
      content: { format: "plain_text", text: "TEST_ONLY_CORRECTED" } };
    expect(await store.append({ sermon_id: sermonId, version: 2, id: proposalId, kind: "proposal",
      source_type: original.source_type, source_id: original.source_id, document_id: original.document_id,
      confirmation_id: null, parent_document_id: original.document_id, related_id: null,
      document_sha256: original.document_sha256, actor_id: "synthetic-admin",
      created_at: new Date().toISOString() }, proposal)).toBe("saved");
    const detailResponse = await privateGet(`${endpoint}/corrections/${proposalId}`, fixture.token);
    expect(detailResponse.status).toBe(200);
    const detail = adminSermonInputCorrectionSuccessSchema.parse(await detailResponse.json()).data.correction;
    expect(detail).toMatchObject({ proposal: { kind: "correction_document_v1", content: proposal.content } });
    const proposedHead = await store.head(sermonId);
    if (!proposedHead) throw new Error("Synthetic proposal missing");
    expect((await mutationRequest(endpoint, fixture.token, { action: "decide_corrections",
      ...expectation({ version: proposedHead.version, sourceId: proposedHead.source_id,
        documentId: proposedHead.document_id, documentSha256: proposedHead.document_sha256 }),
      proposalId, reviewed: true, decisions: [{ itemId: "fake", decision: "accepted" }] })).status).toBe(400);
    const applyResponse = await mutationRequest(endpoint, fixture.token, { action: "apply_correction_document",
      ...expectation({ version: proposedHead.version, sourceId: proposedHead.source_id,
        documentId: proposedHead.document_id, documentSha256: proposedHead.document_sha256 }),
      proposalId, reviewed: true, content: { format: "plain_text", text: "TEST_ONLY_HUMAN_EDIT" } });
    expect(applyResponse.status).toBe(200);
    const applied = adminSermonInputMutationSuccessSchema.parse(await applyResponse.json()).data.head;
    expect(applied.confirmationId).toBeNull();
    expect((await store.head(sermonId))?.related_id).toBe(proposalId);
    const confirmResponse = await mutationRequest(endpoint, fixture.token, { action: "confirm", ...expectation(applied), reviewed: true });
    expect(confirmResponse.status).toBe(200);
    expect(adminSermonInputMutationSuccessSchema.parse(await confirmResponse.json()).data.head.confirmationId).not.toBeNull();
  });

  it("closes invalid history selections, queries, methods, and public lookalike routes", async () => {
    const { endpoint, fixture, sermonId } = await setup();
    const importedResponse = await request(
      endpoint,
      fixture.token,
      manualInput("TEST_ONLY_PRIVATE_ORIGINAL"),
    );
    const imported = adminSermonInputSuccessSchema.parse(await importedResponse.json()).data.input;
    if (imported === null) throw new Error("Synthetic import missing");

    const missingQuery = await privateGet(
      `${endpoint}/comparison?sourceId=${imported.sourceId}&leftDocumentId=${imported.documentId}`,
      fixture.token,
    );
    expect(missingQuery.status).toBe(400);
    const duplicateQuery = await privateGet(
      `${endpoint}/comparison?sourceId=${imported.sourceId}&sourceId=${imported.sourceId}&leftDocumentId=${imported.documentId}&rightDocumentId=${imported.documentId}`,
      fixture.token,
    );
    expect(duplicateQuery.status).toBe(400);
    const wrongSource = await privateGet(
      `${endpoint}/comparison?sourceId=other-source&leftDocumentId=${imported.documentId}&rightDocumentId=${imported.documentId}`,
      fixture.token,
    );
    expect(wrongSource.status).toBe(404);
    await expect(wrongSource.json()).resolves.toMatchObject({
      error: { code: "SERMON_INPUT_SELECTION_NOT_FOUND" },
    });
    const otherSermonId = crypto.randomUUID();
    await seedMetadataSermon(database, otherSermonId);
    const otherEndpoint = `${origin}/api/admin/sermons/${otherSermonId}/input`;
    const otherResponse = await request(
      otherEndpoint,
      fixture.token,
      manualInput("TEST_ONLY_OTHER_SERMON"),
    );
    const otherInput = adminSermonInputSuccessSchema.parse(await otherResponse.json()).data.input;
    if (otherInput === null) throw new Error("Synthetic other input missing");
    const crossSermon = await privateGet(
      `${endpoint}/comparison?sourceId=${imported.sourceId}&leftDocumentId=${otherInput.documentId}&rightDocumentId=${imported.documentId}`,
      fixture.token,
    );
    expect(crossSermon.status).toBe(404);
    const missingProposal = await privateGet(
      `${endpoint}/corrections/not-present`,
      fixture.token,
    );
    expect(missingProposal.status).toBe(404);

    const extraHistoryQuery = await privateGet(
      `${endpoint}/history?unexpected=1`,
      fixture.token,
    );
    expect(extraHistoryQuery.status).toBe(400);
    const wrongMethod = await request(
      `${endpoint}/history`,
      fixture.token,
      {},
    );
    expect(wrongMethod.status).toBe(405);
    const publicHistory = await privateGet(
      `${origin}/api/sermons/${sermonId}/input/history`,
    );
    expect(publicHistory.status).toBe(404);
  });

  it("rejects oversized and malformed editing commands before writing", async () => {
    const { endpoint, fixture, sermonId } = await setup();
    const importedResponse = await request(
      endpoint,
      fixture.token,
      manualInput("TEST_ONLY_ORIGINAL"),
    );
    const imported = adminSermonInputSuccessSchema.parse(await importedResponse.json()).data.input;
    if (imported === null) throw new Error("Synthetic import missing");

    const oversized = await mutationRequest(endpoint, fixture.token, {
      action: "edit",
      ...expectation(imported),
      content: { format: "plain_text", text: "가".repeat(30_001) },
    });
    expect(oversized.status).toBe(422);
    await expect(oversized.json()).resolves.toMatchObject({
      error: { code: "INPUT_TOO_LARGE" },
    });

    const malformed = await mutationRequest(endpoint, fixture.token, {
      action: "confirm",
      ...expectation(imported),
      reviewed: false,
      privateExtra: "TEST_ONLY_PRIVATE",
    });
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toMatchObject({
      error: { code: "INVALID_SERMON_INPUT_COMMAND" },
    });

    const rows = await (env as Env).DB.prepare(
      "SELECT count(*) AS count FROM sermon_input_events WHERE sermon_id = ?",
    ).bind(sermonId).first<{ count: number }>();
    expect(rows?.count).toBe(1);
  });
});
