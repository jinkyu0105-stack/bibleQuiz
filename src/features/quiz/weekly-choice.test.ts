import { afterEach, expect, it, vi } from "vitest";
import { publicResponse } from "../../../tests/fixtures/public-response";
import { loadWeeklyChoice } from "./weekly-choice";
afterEach(() => vi.unstubAllGlobals());
it("uses the server's chosen quiz slug and retries adult-only availability", async () => {
  const fixture = publicResponse("adult"); fixture.data.quiz!.availableDifficulties = ["adult"];
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 404 })).mockResolvedValueOnce(Response.json(fixture));
  vi.stubGlobal("fetch", fetcher);
  const result = await loadWeeklyChoice(new AbortController().signal);
  expect(result).toEqual({ title: fixture.data.quiz!.sermon.title, slug: fixture.data.quiz!.slug, difficulties: ["adult"] });
  expect(fetcher.mock.calls.map(args => args[0])).toEqual(["/api/quizzes/latest?difficulty=child", "/api/quizzes/latest?difficulty=adult"]);
});
it("distinguishes no published quiz from connection failure and rejects private fields", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ data: { quiz: null, otherOpenQuizzes: [] } }))
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ ...publicResponse(), privateToken: "secret" }));
  vi.stubGlobal("fetch", fetcher);
  expect(await loadWeeklyChoice(new AbortController().signal)).toBeNull();
  await expect(loadWeeklyChoice(new AbortController().signal)).rejects.toThrow();
  await expect(loadWeeklyChoice(new AbortController().signal)).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(3);
});
