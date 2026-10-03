import { afterEach, describe, expect, it, vi } from "vitest";
import { publicResponse } from "../../../tests/fixtures/public-response";
import { ownSubmissionDataSchema } from "../../../shared/api/submission";
import { loadPublicQuiz } from "./public-loader";

afterEach(() => vi.unstubAllGlobals());
function load(path = "/", slug?: string) {
  return loadPublicQuiz({ request: new Request(`https://example.com${path}`), params: slug ? { slug } : {} });
}
describe("public quiz client loader", () => {
  it("requests selected difficulty and validates the public response", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json(publicResponse("adult")))
      .mockResolvedValueOnce(Response.json({ data: { submission: null } }));
    vi.stubGlobal("fetch", fetcher);
    expect(await load("/?level=adult")).toMatchObject({
      state: "ready",
      ownSubmission: { state: "ready", data: null },
    });
    expect(fetcher).toHaveBeenNthCalledWith(1, "/api/quizzes/latest?difficulty=adult", expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }));
    expect(fetcher).toHaveBeenNthCalledWith(2, "/api/quizzes/2026-08-31-test01/adult/me", expect.objectContaining({ cache: "no-store", credentials: "same-origin", method: "GET" }));
  });
  it("rejects unknown private fields and mismatched variants/slugs", async () => {
    const body = publicResponse();
    for (const value of [
      { data: { ...body.data, solution: "PRIVATE_CANARY" } },
      { data: { ...body.data, quiz: { ...body.data.quiz, solution: "PRIVATE_CANARY" } } },
      { data: { ...body.data, quiz: { ...body.data.quiz, submissionCount: null } } },
      publicResponse("adult"),
    ]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(value)));
      expect((await load()).state).toBe("error");
    }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(publicResponse())));
    expect((await load("/quiz/2026-08-31-other1", "2026-08-31-other1")).state).toBe("error");
  });
  it("distinguishes empty/not-found and hides arbitrary server error contents", async () => {
    for (const [response, state] of [
      [Response.json({ data: { quiz: null, otherOpenQuizzes: [] } }), "ready"],
      [new Response("not found", { status: 404 }), "not-found"],
      [Response.json({ error: { message: "PRIVATE_CANARY", requestId: "not-a-safe-id" } }, { status: 503 }), "error"],
      [new Response("<html>sign in</html>"), "error"],
    ] as const) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
      const result = await load();
      expect(result.state).toBe(state);
      expect(JSON.stringify(result)).not.toContain("PRIVATE_CANARY");
    }
  });
  it("does not fetch an invalid slug and handles rejected requests", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetcher);
    expect((await load("/quiz/bad", "bad")).state).toBe("not-found");
    expect(fetcher).not.toHaveBeenCalled();
    expect((await load()).state).toBe("error");
  });

  it("restores only an exact strict variant result and keeps lookup errors non-public", async () => {
    const body = publicResponse();
    const quiz = body.data.quiz!;
    const cellIds = quiz.variant.grid.cells.map((cell) => cell.id);
    const own = ownSubmissionDataSchema.parse({
      submission: {
        status: "submitted",
        quizVariantId: quiz.variant.id,
        quizRevision: quiz.variant.revision,
        answers: { [cellIds[0]!]: "가" },
        result: {
          submissionId: "submission-1",
          submittedAt: "2026-09-01T00:00:00.000Z",
          correctCells: 1,
          totalCells: cellIds.length,
          correctWords: 0,
          totalWords: quiz.variant.grid.entries.length,
          scoreBasisPoints: Math.round(10_000 / cellIds.length),
          correctnessMask: `1${"0".repeat(cellIds.length - 1)}`,
          canRevealAnswer: true,
          solution: {
            cells: Object.fromEntries(cellIds.map((cellId) => [cellId, "가"])),
            entries: Object.fromEntries(quiz.variant.grid.entries.map((entry) => [entry.id, "가".repeat(entry.length)])),
          },
        },
      },
    });
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json(body))
      .mockResolvedValueOnce(Response.json({ data: own })));
    expect(await load()).toMatchObject({
      state: "ready",
      ownSubmission: { state: "ready", data: { status: "submitted" } },
    });

    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json(body))
      .mockResolvedValueOnce(Response.json({
        data: {
          submission: {
            ...own.submission!,
            quizVariantId: "another-variant",
          },
        },
      })));
    expect(await load()).toMatchObject({ state: "ready", ownSubmission: { state: "error" } });

    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json(body))
      .mockResolvedValueOnce(new Response("PRIVATE_CANARY", { status: 503 })));
    const failed = await load();
    expect(failed).toMatchObject({ state: "ready", ownSubmission: { state: "error" } });
    expect(JSON.stringify(failed)).not.toContain("PRIVATE_CANARY");
  });
});
