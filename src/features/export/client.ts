import { z } from "zod";
import { blankExportSchema, topNExportSchema } from "../../../shared/api/quiz-export";
import { difficultySchema, quizSlugSchema, type Difficulty } from "../../../shared/api/public-quiz";

export async function readExport<T>(slug: string, difficulty: Difficulty, output: "export-data" | "top-n-export", schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
  quizSlugSchema.parse(slug); difficultySchema.parse(difficulty);
  const response = await fetch(`/api/quizzes/${encodeURIComponent(slug)}/${difficulty}/${output}`, {
    credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(response.status === 403
    ? `${difficulty === "child" ? "어린이용" : "장년용"}에 답안을 제출한 브라우저에서 출력할 수 있습니다.`
    : "출력 자료를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
  const parsed = z.strictObject({ data: schema }).safeParse(await response.json());
  if (!parsed.success) throw new Error("출력 자료의 형식을 확인하지 못했습니다.");
  const result = parsed.data.data;
  const identity = result as { slug: string; difficulty: Difficulty };
  if (identity.slug !== slug || identity.difficulty !== difficulty) throw new Error("출력 대상이 일치하지 않습니다.");
  return result;
}
export const readBlank = (slug: string, difficulty: Difficulty, signal?: AbortSignal) => readExport(slug, difficulty, "export-data", blankExportSchema, signal);
export const readTopN = (slug: string, difficulty: Difficulty, signal?: AbortSignal) => readExport(slug, difficulty, "top-n-export", topNExportSchema, signal);
