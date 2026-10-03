import { adminPlacementTrialSchema } from "../../../shared/api/admin-placement";
import { adminPublicCaptionImportDataSchema, type AdminPublicCaptionImportData } from "../../../shared/api/admin-public-video";
import { adminContentViewSchema, type AdminContentSection, type AdminContentView } from "../../../shared/api/admin-content-generation";
import { adminFinalCheckStatusSchema } from "../../../shared/api/admin-content-final-check";
import { adminAiCostsSchema } from "../../../shared/api/admin-ai-costs";
import { adminPublishDataSchema, adminPublishRequestSchema } from "../../../shared/api/admin-publish";
import { z } from "zod";
import { adminCorrectionGenerationRequestSchema, adminGenerationAvailabilitySchema, adminGenerationStartDataSchema, adminGenerationStatusDataSchema } from "../../../shared/api/admin-generation";

import {
  adminSermonIdSchema,
  adminSermonInputCommandRequestSchema,
  adminSermonInputComparisonSuccessSchema,
  adminSermonInputCorrectionSuccessSchema,
  adminSermonInputHistorySuccessSchema,
  adminSermonInputImportRequestSchema,
  adminSermonInputMutationSuccessSchema,
  adminSermonInputSuccessSchema,
  type AdminSermonInputCommandRequest,
  type AdminSermonInputComparisonData,
  type AdminSermonInputCorrectionDetail,
  type AdminSermonInputCurrent,
  type AdminSermonInputHistory,
  type AdminSermonInputImportRequest,
  type AdminSermonInputMutationData,
} from "../../../shared/api/admin-sermon-input";

const REQUEST_TIMEOUT_MS = 15_000;

const errorResponseSchema = z.strictObject({
  error: z.strictObject({
    code: z.string().min(1).max(128),
    message: z.string().min(1).max(500),
    requestId: z.uuid(),
  }),
});

export interface AdminSermonInputClientError {
  code: string;
  message: string;
  requestId?: string;
  status?: number;
}

export type AdminSermonInputClientResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: AdminSermonInputClientError };

function unavailable(message: string, status?: number): AdminSermonInputClientError {
  return { code: "CLIENT_UNAVAILABLE", message, ...(status === undefined ? {} : { status }) };
}

function requestSignal(signal?: AbortSignal, timeoutMs = REQUEST_TIMEOUT_MS): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
}

async function readError(response: Response, fallback: string): Promise<AdminSermonInputClientError> {
  try {
    const parsed = errorResponseSchema.safeParse(await response.json());
    if (parsed.success) return { ...parsed.data.error, status: response.status };
  } catch {
    // Never surface an arbitrary upstream response in the administrator UI.
  }
  return unavailable(fallback, response.status);
}

async function readSuccess<T>(response: Response, schema: z.ZodType<T>, fallback: string): Promise<AdminSermonInputClientResult<T>> {
  try {
    const parsed = schema.safeParse(await response.json());
    return parsed.success ? { ok: true, data: parsed.data } : { ok: false, error: unavailable(fallback, response.status) };
  } catch {
    return { ok: false, error: unavailable(fallback, response.status) };
  }
}

function sermonPath(sermonId: string): string | null {
  const parsed = adminSermonIdSchema.safeParse(sermonId);
  return parsed.success ? `/api/admin/sermons/${encodeURIComponent(parsed.data)}/input` : null;
}

async function request<T>(
  url: string,
  schema: z.ZodType<T>,
  fallback: string,
  init: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<AdminSermonInputClientResult<T>> {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...init,
      signal: requestSignal(init.signal ?? undefined, timeoutMs),
    });
    if (!response.ok) return { ok: false, error: await readError(response, fallback) };
    return readSuccess(response, schema, fallback);
  } catch {
    return { ok: false, error: unavailable(`${fallback} 연결을 확인해 주세요.`) };
  }
}

export async function loadAdminSermonInput(sermonId: string, signal?: AbortSignal): Promise<AdminSermonInputClientResult<AdminSermonInputCurrent | null>> {
  const path = sermonPath(sermonId);
  if (!path) return { ok: false, error: unavailable("설교 ID를 다시 확인해 주세요.") };
  const result = await request(path, adminSermonInputSuccessSchema, "설교 입력자료를 불러오지 못했습니다.", { method: "GET", ...(signal ? { signal } : {}) });
  return result.ok ? { ok: true, data: result.data.data.input } : result;
}

export async function loadAdminSermonInputHistory(sermonId: string, signal?: AbortSignal): Promise<AdminSermonInputClientResult<AdminSermonInputHistory | null>> {
  const path = sermonPath(sermonId);
  if (!path) return { ok: false, error: unavailable("설교 ID를 다시 확인해 주세요.") };
  const result = await request(`${path}/history`, adminSermonInputHistorySuccessSchema, "입력자료 이력을 불러오지 못했습니다.", { method: "GET", ...(signal ? { signal } : {}) });
  return result.ok ? { ok: true, data: result.data.data.history } : result;
}

export async function importPublicCaptions(
  sermonId: string,
  signal?: AbortSignal,
): Promise<AdminSermonInputClientResult<AdminPublicCaptionImportData>> {
  const path = sermonPath(sermonId);
  if (!path) return { ok: false, error: unavailable("설교 ID를 다시 확인해 주세요.") };
  const result = await request(path + "/public-captions",
    z.strictObject({ data: adminPublicCaptionImportDataSchema }), "공개 자막을 가져오지 못했습니다.",
    { method: "POST", body: JSON.stringify({ expectedVersion: 0 }), ...(signal ? { signal } : {}) }, 45_000);
  return result.ok ? { ok: true, data: result.data.data } : result;
}

export async function importAdminSermonInput(
  sermonId: string,
  input: AdminSermonInputImportRequest,
  signal?: AbortSignal,
): Promise<AdminSermonInputClientResult<AdminSermonInputCurrent>> {
  const path = sermonPath(sermonId);
  const parsed = adminSermonInputImportRequestSchema.safeParse(input);
  if (!path || !parsed.success) return { ok: false, error: unavailable("저장할 입력자료를 다시 확인해 주세요.") };
  const result = await request(path, adminSermonInputSuccessSchema, "설교 입력자료를 저장하지 못했습니다.", {
    body: JSON.stringify(parsed.data), method: "POST", ...(signal ? { signal } : {}),
  });
  if (!result.ok) return result;
  return result.data.data.input === null
    ? { ok: false, error: unavailable("저장된 입력자료 응답을 확인하지 못했습니다.") }
    : { ok: true, data: result.data.data.input };
}

export async function commandAdminSermonInput(
  sermonId: string,
  command: AdminSermonInputCommandRequest,
  signal?: AbortSignal,
): Promise<AdminSermonInputClientResult<AdminSermonInputMutationData>> {
  const path = sermonPath(sermonId);
  const parsed = adminSermonInputCommandRequestSchema.safeParse(command);
  if (!path || !parsed.success) return { ok: false, error: unavailable("변경할 입력자료를 다시 확인해 주세요.") };
  const result = await request(path, adminSermonInputMutationSuccessSchema, "설교 입력자료를 변경하지 못했습니다.", {
    body: JSON.stringify(parsed.data), method: "PATCH", ...(signal ? { signal } : {}),
  });
  return result.ok ? { ok: true, data: result.data.data } : result;
}

export async function loadAdminSermonInputComparison(
  sermonId: string,
  query: { sourceId: string; leftDocumentId: string; rightDocumentId: string },
  signal?: AbortSignal,
): Promise<AdminSermonInputClientResult<AdminSermonInputComparisonData>> {
  const path = sermonPath(sermonId);
  if (!path) return { ok: false, error: unavailable("비교할 설교를 다시 확인해 주세요.") };
  const parameters = new URLSearchParams(query);
  const result = await request(`${path}/comparison?${parameters.toString()}`, adminSermonInputComparisonSuccessSchema, "선택한 두 입력자료를 불러오지 못했습니다.", { method: "GET", ...(signal ? { signal } : {}) });
  return result.ok ? { ok: true, data: result.data.data } : result;
}

export async function loadAdminSermonInputCorrection(
  sermonId: string,
  proposalId: string,
  signal?: AbortSignal,
): Promise<AdminSermonInputClientResult<AdminSermonInputCorrectionDetail>> {
  const path = sermonPath(sermonId);
  if (!path || !adminSermonIdSchema.safeParse(proposalId).success) {
    return { ok: false, error: unavailable("교정 제안을 다시 선택해 주세요.") };
  }
  const result = await request(`${path}/corrections/${encodeURIComponent(proposalId)}`, adminSermonInputCorrectionSuccessSchema, "선택한 교정 제안을 불러오지 못했습니다.", { method: "GET", ...(signal ? { signal } : {}) });
  return result.ok ? { ok: true, data: result.data.data.correction } : result;
}

export async function loadCorrectionGeneration(sermonId: string, jobId?: string, signal?: AbortSignal) {
  const path = sermonPath(sermonId);
  if (!path || jobId !== undefined && !adminSermonIdSchema.safeParse(jobId).success) {
    return { ok: false as const, error: unavailable("생성 작업을 다시 확인해 주세요.") };
  }
  const endpoint = `${path.slice(0, -6)}/generation/${jobId ?? "correction"}`;
  if (jobId) return request(endpoint, z.strictObject({ data: adminGenerationStatusDataSchema }),
    "교정 상태를 불러오지 못했습니다.", { method: "GET", ...(signal ? { signal } : {}) });
  return request(endpoint, z.strictObject({ data: adminGenerationAvailabilitySchema }),
    "AI 교정 연결을 확인하지 못했습니다.", { method: "GET", ...(signal ? { signal } : {}) });
}

export async function startCorrectionGeneration(sermonId: string, command: z.infer<typeof adminCorrectionGenerationRequestSchema>) {
  const path = sermonPath(sermonId), parsed = adminCorrectionGenerationRequestSchema.safeParse(command);
  if (!path || !parsed.success) return { ok: false as const, error: unavailable("교정 요청을 확인해 주세요.") };
  return request(`${path.slice(0, -6)}/generation/correction`, z.strictObject({ data: adminGenerationStartDataSchema }),
    "교정 요청의 접수 여부를 확인하지 못했습니다. 작업 상태를 확인해 주세요.", { method: "POST", body: JSON.stringify(parsed.data) });
}

export async function loadAdminAiCosts(quizSetId: string, signal?: AbortSignal) {
  if (!adminSermonIdSchema.safeParse(quizSetId).success) {
    return { ok: false as const, error: unavailable("퀴즈를 다시 선택해 주세요.") };
  }
  const result = await request(`/api/admin/quiz-sets/${encodeURIComponent(quizSetId)}/ai-costs`,
    z.strictObject({ data: adminAiCostsSchema }), "AI 비용 기록을 불러오지 못했습니다.",
    { method: "GET", ...(signal ? { signal } : {}) });
  return result.ok ? { ok: true as const, data: result.data.data } : result;
}

export async function loadContentGeneration(sermonId: string, signal?: AbortSignal, before?: number,
  onProgress?: (view: AdminContentView, loaded: AdminContentSection[]) => void): Promise<AdminSermonInputClientResult<{ data: AdminContentView }>> {
  const controller = new AbortController();
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const load = (section: AdminContentSection, detail = "") => request(
    `/api/admin/sermons/${encodeURIComponent(sermonId)}/generation/content?section=${section}&parts=true${before && section === "content" ? `&before=${before}` : ""}${section === "placement" && !detail ? "&difficulty=child" : detail}`,
    z.strictObject({ data: adminContentViewSchema }), "생성 자료를 불러오지 못했습니다.", { method: "GET", signal: combined });
  const first = await load("state");
  if (!first.ok || combined.aborted) return first.ok ? { ok: false, error: unavailable("조회가 취소됐습니다.") } : first;
  let view = first.data.data;
  const loaded: AdminContentSection[] = ["state"];
  onProgress?.(view, [...loaded]);
  // These are separate HTTP requests, not parallel work inside one Worker request.
  const fields = {
    costs: ["weekCostMicroUsd", "weekUnknownCalls", "jobCostMicroUsd", "jobUnknownCalls", "quizCostMicroUsd", "quizUnknownCalls"],
    content: ["content", "snapshots", "quality", "historyCursor", "recoveredAnalysisId", "recoveredCritiqueId"],
    activity: ["regenerations"],
    placement: ["placement", "preview", "reviewLayouts"],
  } as const;
  const sameVersion = (part: AdminContentView) => part.viewRevision === first.data.data.viewRevision && part.version === first.data.data.version &&
    part.quizSetId === first.data.data.quizSetId && part.jobId === first.data.data.jobId && part.status === first.data.data.status && part.stage === first.data.data.stage;
  const changed = { ok: false as const, error: { code: "CONTENT_DISPLAY_CHANGED", message: "불러오는 동안 자료가 변경됐습니다. 생성 상태를 다시 확인해 주세요." } };
  async function loadSection(section: Exclude<AdminContentSection, "state">) {
    const initial = await load(section);
    if (!initial.ok) return initial;
    const part = initial.data.data;
    if (!sameVersion(part)) return changed;
    if (section === "content" && part.snapshotIds) {
      const snapshots: AdminContentView["snapshots"] = [];
      for (const id of part.snapshotIds) {
        const item = await load("content", `&snapshotId=${encodeURIComponent(id)}`);
        if (!item.ok) return item;
        if (!sameVersion(item.data.data) || item.data.data.snapshots.length !== 1 || item.data.data.snapshots[0]!.value.id !== id) return changed;
        snapshots.push(item.data.data.snapshots[0]!);
        view = { ...view, ...Object.fromEntries(fields.content.map(key => [key, part[key]])), snapshots: [...snapshots] };
        onProgress?.(view, [...loaded]);
      }
      return { ok: true as const, data: { data: { ...part, snapshots } } };
    }
    if (section === "placement" && part.layoutPart) {
      const second = await load("placement", "&difficulty=adult");
      if (!second.ok) return second;
      const other = second.data.data, child = part.layoutPart, adult = other.layoutPart;
      if (!sameVersion(other) || child.difficulty !== "child" || adult?.difficulty !== "adult" ||
        JSON.stringify(part.placement) !== JSON.stringify(other.placement) || JSON.stringify(child.preview) !== JSON.stringify(adult.preview) ||
        !!child.layout !== !!adult.layout) return changed;
      const preview = child.layout && adult.layout && child.preview ? { ...child.preview, variants: { child: child.layout.grid, adult: adult.layout.grid } } : null;
      const reviewLayouts = child.layout && adult.layout ? { child: child.layout, adult: adult.layout } : null;
      return { ok: true as const, data: { data: { ...part, preview, reviewLayouts } } };
    }
    return initial;
  }
  let failure: AdminSermonInputClientError | undefined;
  await Promise.all((Object.keys(fields) as (keyof typeof fields)[]).map(async section => {
    const result = await loadSection(section);
    if (combined.aborted) return;
    if (!result.ok) failure = result.error;
    else {
      const part = result.data.data;
      if (part.viewRevision !== first.data.data.viewRevision || part.version !== first.data.data.version ||
        part.quizSetId !== first.data.data.quizSetId || part.jobId !== first.data.data.jobId ||
        part.status !== first.data.data.status || part.stage !== first.data.data.stage) {
        failure = { code: "CONTENT_DISPLAY_CHANGED", message: "불러오는 동안 자료가 변경됐습니다. 생성 상태를 다시 확인해 주세요." };
      } else {
        view = { ...view, ...Object.fromEntries(fields[section].map(key => [key, part[key]])) };
        loaded.push(section);
        onProgress?.(view, [...loaded]);
      }
    }
    if (failure) controller.abort();
  }));
  if (failure) return { ok: false, error: failure };
  if (combined.aborted) return { ok: false, error: unavailable("조회가 취소됐습니다.") };
  return { ok: true, data: { data: view } };
}
export async function mutateContentGeneration(sermonId: string, action: "content" | "regenerate" | "review" | "quality" | "resume" | "discard" | "finish" | "placement-select", body: unknown, jobId?: string) {
  const suffix = (action === "content" || action === "regenerate") ? action : `${encodeURIComponent(jobId ?? "")}/${action}`;
  return request(`/api/admin/sermons/${encodeURIComponent(sermonId)}/generation/${suffix}`, z.object({ data: z.object({ outcome: z.string().optional(), jobId: z.string().optional(), dispatch: z.string().optional(), requestKey: z.uuid().optional() }) }),
    "요청을 확인하지 못했습니다. 같은 작업의 상태를 확인해 주세요.", { method: "POST", body: JSON.stringify(body) });
}

export async function loadContentFinalCheck(sermonId: string, jobId: string, requestKey: string, signal?: AbortSignal) {
  return request(`/api/admin/sermons/${encodeURIComponent(sermonId)}/generation/${encodeURIComponent(jobId)}/final-check/${encodeURIComponent(requestKey)}`,
    z.strictObject({ data: adminFinalCheckStatusSchema }), "최종 검사 상태를 확인하지 못했습니다. 저장된 자료는 그대로 유지됩니다.",
    { method: "GET", ...(signal ? { signal } : {}) });
}

export async function trialAdminPlacement(sermonId: string, jobId: string, body: unknown) {
  return request(`/api/admin/sermons/${encodeURIComponent(sermonId)}/generation/${encodeURIComponent(jobId)}/placement-trial`,
    z.strictObject({ data: adminPlacementTrialSchema }), "배치를 시험하지 못했습니다. 최신 자료와 검수 상태를 확인해 주세요.", { method: "POST", body: JSON.stringify(body) });
}

export async function publishAdminQuiz(quizSetId: string, body: unknown) {
  const command = adminPublishRequestSchema.safeParse(body);
  if (!command.success || !/^[A-Za-z0-9_-]{1,128}$/u.test(quizSetId)) return { ok: false as const, error: unavailable("발행 요청을 확인해 주세요.") };
  return request(`/api/admin/quiz-sets/${encodeURIComponent(quizSetId)}/publish`, z.strictObject({ data: adminPublishDataSchema }),
    "발행 상태를 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.", { method: "POST", body: JSON.stringify(command.data) });
}
