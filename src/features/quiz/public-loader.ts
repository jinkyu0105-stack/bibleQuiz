import type { LoaderFunctionArgs } from "react-router-dom";
import { z } from "zod";
import { publicQuizResponseSchema, quizSlugSchema, type PublicQuizData } from "../../../shared/api/public-quiz";
import type { OwnSubmission } from "../../../shared/api/submission";
import { readOwnSubmission } from "./submission-client";

export type OwnSubmissionLoadResult =
  | { state: "ready"; data: OwnSubmission | null }
  | { state: "error"; requestId?: string };

export type QuizLoadResult =
  | { state: "ready"; data: PublicQuizData; ownSubmission: OwnSubmissionLoadResult }
  | { state: "not-found" }
  | { state: "error"; requestId?: string };
const errorSchema = z.object({ error: z.object({ requestId: z.uuid() }) });

export async function loadPublicQuiz({ request, params }: Pick<LoaderFunctionArgs, "request" | "params">): Promise<QuizLoadResult> {
  const url = new URL(request.url);
  const difficulty = url.searchParams.get("level") === "adult" ? "adult" : "child";
  if (params.slug && !quizSlugSchema.safeParse(params.slug).success) return { state: "not-found" };
  const path = params.slug ? encodeURIComponent(params.slug) : "latest";
  try {
    const response = await fetch(`/api/quizzes/${path}?difficulty=${difficulty}`, {
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]),
      headers: { Accept: "application/json" }, cache: "no-store",
    });
    if (response.status === 404) return { state: "not-found" };
    if (!response.ok) {
      const error = errorSchema.safeParse(await response.json());
      return error.success ? { state: "error", requestId: error.data.error.requestId } : { state: "error" };
    }
    const result = publicQuizResponseSchema.safeParse(await response.json());
    if (!result.success || (result.data.data.quiz && (result.data.data.quiz.variant.difficulty !== difficulty ||
      (params.slug && result.data.data.quiz.slug !== params.slug)))) return { state: "error" };
    const data = result.data.data;
    if (data.quiz === null) {
      return { state: "ready", data, ownSubmission: { state: "ready", data: null } };
    }
    const ownSubmission = await readOwnSubmission({
      difficulty: data.quiz.variant.difficulty,
      slug: data.quiz.slug,
    }, request.signal);
    if (!ownSubmission.ok) {
      return {
        state: "ready",
        data,
        ownSubmission: {
          state: "error",
          ...(ownSubmission.error.requestId === undefined
            ? {}
            : { requestId: ownSubmission.error.requestId }),
        },
      };
    }
    if (
      ownSubmission.data !== null &&
      (ownSubmission.data.quizVariantId !== data.quiz.variant.id ||
        ownSubmission.data.quizRevision !== data.quiz.variant.revision)
    ) {
      return { state: "ready", data, ownSubmission: { state: "error" } };
    }
    return { state: "ready", data, ownSubmission: { state: "ready", data: ownSubmission.data } };
  } catch {
    return { state: "error" };
  }
}
