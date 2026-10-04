import { operationsRoutes } from "./operations-routes";
import type { BackupBindings } from "../_shared/services/backup-storage";
import { publicRateResponse, activeRateActor, type PublicRateBindings } from "../_shared/services/public-rate-limit";
import { blankExport, topNExport } from "../../shared/api/quiz-export";
import { weeklyRoutes } from "./weekly-routes";
import { readContentGenerationParts } from "../_shared/services/content-generation-parts";
import { prepareReadSchema } from "../_shared/services/prepare-input-schema";
import { generationReadSession } from "../_shared/repositories/generation-read-session";
import { fullGenerationEnabled } from "../_shared/services/preview-generation-access";
import { listSermonDrafts, readSermonDraft, registerSermonDraft, saveSermonDraft, SermonDraftError } from "../_shared/services/sermon-drafts";
import { importPublicSermonCaptions, previewPublicSermonVideo, PublicVideoError } from "../_shared/services/public-sermon-video";
import { createPublicTranscriptProvider } from "../_shared/services/supadata-transcript";
import { readQuizDeadline, previewQuizDeadline, changeQuizDeadline } from "../_shared/services/quiz-deadline";
import { readPublishedWording, correctPublishedWording } from "../_shared/services/published-wording";
import { readProblemHistory } from "../_shared/services/problem-history";
import { readProblemCorrection,executeProblemCorrection,readProblemRecords } from "../_shared/services/problem-correction";
import { readQuizRevision, executeQuizRevision } from "../_shared/services/quiz-revision";
import { WithdrawalEditsExpired } from "../_shared/services/withdrawal-edit-cleanup";
import { readWithdrawalEdits, saveWithdrawalEdits } from "../_shared/services/withdrawal-edits";
import { previewWithdrawalEdits } from "../_shared/services/withdrawal-preview";
import { withdrawPublishedQuiz, readWithdrawalReview, listWithdrawalReviews } from "../_shared/services/quiz-withdrawal";
import { correctPublishedDisplayText, listPublishedMetadata, readPublishedDisplayText, SemanticCorrectionRequired } from "../_shared/services/published-display-text";
import { draftIsPurged, listDraftCleanup } from "../_shared/services/draft-cleanup";
import { discardIntentRegeneration, requestContentRegeneration } from "../_shared/services/content-regeneration";
import { trialContentPlacement, selectContentPlacement } from "../_shared/services/content-placement";
import { adminContentRequestSchema, adminContentCommandSchema, adminContentHistoryQuerySchema, adminRegenerationRequestSchema } from "../../shared/api/admin-content-generation";
import { requestFullGeneration, requestContentResume } from "../_shared/services/content-intent-generation";
import { executeContentHumanCommand } from "../_shared/services/content-human-generation";
import { finishContentGeneration } from "../_shared/services/content-generation-final";
import { readContentGenerationView } from "../_shared/services/content-generation-view";
import { AdminAiCostsNotFound, readAdminAiCosts } from "../_shared/services/admin-ai-costs";
import { saveContentQualityReview } from "../_shared/services/content-quality-review";
import { publishReviewedQuiz } from "../_shared/services/quiz-publication";
import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";

import {
  closeQuizSetNowDataSchema,
  closeQuizSetNowRequestSchema,
  quizSetIdSchema,
} from "../../shared/api/admin-finalization";
import {
  adminSubmissionIdSchema,
  deleteSubmissionAsAdminRequestSchema,
  deletedSubmissionAsAdminDataSchema,
  moderateSubmissionRequestSchema,
  moderatedSubmissionDataSchema,
} from "../../shared/api/admin-submission-moderation";
import {
  adminBibleReferenceDataSchema,
  bibleReferencePreviewQuerySchema,
  parseBibleReferenceRequestSchema,
} from "../../shared/api/admin-bible-reference";
import {
  adminSermonIdSchema,
  adminSermonInputCommandRequestSchema,
  adminSermonInputComparisonDataSchema,
  adminSermonInputComparisonQuerySchema,
  adminSermonInputCorrectionDataSchema,
  adminSermonInputDataSchema,
  adminSermonInputHistoryDataSchema,
  adminSermonInputImportRequestSchema,
  adminSermonInputMutationDataSchema,
} from "../../shared/api/admin-sermon-input";
import { failure, success } from "../../shared/api/envelope";
import { InvalidArchiveFilter, parseArchiveQuery } from "../../shared/api/archive";
import {
  practiceCheckDataSchema,
  practiceCheckRequestSchema,
} from "../../shared/api/practice";
import { difficultySchema, quizSlugSchema } from "../../shared/api/public-quiz";
import { sessionDataSchema, sessionRequestSchema } from "../../shared/api/session";
import { quizSolutionDataSchema } from "../../shared/api/solution";
import {
  ownSubmissionDataSchema,
  submissionDeletionDataSchema,
  submissionDeletionRequestSchema,
  submissionRequestSchema,
  submissionResultSchema,
} from "../../shared/api/submission";
import { isCompleteHangulSyllable } from "../../shared/puzzle/hangul";
import {
  createBibleReference,
  parseBibleReference,
  type BibleReferenceResult,
} from "../../shared/bible-reference";
import { createDatabase } from "../_shared/db/client";
import {
  MutationRequestError,
  readSameOriginJson,
} from "../_shared/http/mutation-request";
import { createFoundationRepository } from "../_shared/repositories/foundation-repository";
import { createModerationPolicyRepository } from "../_shared/repositories/moderation-policy-repository";
import { createSermonInputStore } from "../_shared/repositories/sermon-input-store";
import {
  ParticipationBoardUnavailable,
  createParticipationBoardRepository,
} from "../_shared/repositories/participation-board-repository";
import { createArchiveRepository } from "../_shared/repositories/archive-repository";
import {
  PublicQuizUnavailable,
  createPublicQuizRepository,
} from "../_shared/repositories/public-quiz-repository";
import {
  SubmissionSessionUnavailable,
  createSubmissionRepository,
  type StoredDeletedSubmission,
  type StoredScoringSolution,
  type StoredSubmission,
  type StoredVisibleSubmission,
} from "../_shared/repositories/submission-repository";
import { moderateSubmissionContent } from "../_shared/services/content-moderation";
import { prepareManualTranscriptSource } from "../_shared/services/manual-transcript-source";
import {
  AccessAuthenticationRequired,
  AccessAuthenticationUnavailable,
  authenticateAccessRequest,
  type AccessIdentity,
} from "../_shared/services/access-auth";
import { createPublicQuizAccessService } from "../_shared/services/public-quiz-access";
import {
  QuizFinalizationInvalidState,
  QuizFinalizationNotFound,
  createQuizFinalizationService,
} from "../_shared/services/quiz-finalization";
import {
  SESSION_COOKIE_BASENAME,
  SessionConfigurationError,
  createSessionService,
  hashSessionToken,
  isSessionToken,
  serializeSessionCookie,
} from "../_shared/services/session";
import {
  scoreSubmission,
  validateScoringSource,
} from "../_shared/services/submission-scoring";
import {
  SubmissionModerationInvalidState,
  SubmissionModerationNotFound,
  SubmissionModerationUnavailable,
  createSubmissionModerationService,
} from "../_shared/services/submission-moderation";
import { hashSubmissionRequest } from "../_shared/services/submission-request-hash";
import { createSermonInputService } from "../_shared/services/sermon-input";
import { createTurnstileVerifier } from "../_shared/services/turnstile";
import { resumeStoredContent } from "../_shared/services/content-stored-continuation";
import { sha256Bytes } from "../_shared/storage/sha256";

import { adminCorrectionGenerationRequestSchema, adminGenerationAvailabilitySchema, adminGenerationStartDataSchema, adminGenerationStatusDataSchema } from "../../shared/api/admin-generation";
import { requestCorrection, sendContentDispatch } from "../_shared/services/content-generation";
import { queueContentFinalCheck, readContentFinalCheck, queueDisplayPreparation, readDisplayPreparation, displayPreparationEnabled, type ContentWorkflowMessage } from "../_shared/services/content-final-check-workflow";
import { adminFinalCheckRequestSchema, adminFinalCheckStatusSchema } from "../../shared/api/admin-content-final-check";
import { createGenerationLifecycleStore } from "../_shared/repositories/generation-lifecycle-store";

export interface AppBindings extends PublicRateBindings, BackupBindings {
  PUBLIC_TRANSCRIPT_PROVIDER?: string;
  SUPADATA_API_KEY?: string;
  DRAFT_CLEANUP_ENABLED?: string;
  OPERATIONS_CRON_ENABLED?: string;
  CONTENT_WORKFLOW?: Workflow<ContentWorkflowMessage>;
  CONTENT_FINAL_CHECK_WORKFLOW_ENABLED?: string;
  CONTENT_DISPLAY_PREPARATION_ENABLED?: string;
  CONTENT_DISPLAY_PREPARATION_SERMON_IDS?: string;
  AI_GENERATION_ENABLED?: string;
  P571_SYNTHETIC_SERMON_IDS?: string;
  DB: D1Database;
  ACCESS_AUD?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ARCHIVE_CURSOR_SECRET?: string;
  SESSION_PEPPER?: string;
  TURNSTILE_EXPECTED_HOSTNAME?: string;
  TURNSTILE_SECRET?: string;
  // Supplied only by a local test entry; environment secrets cannot define a function.
  TURNSTILE_SITEVERIFY_FETCH?: typeof fetch;
}

interface AppVariables {
  accessIdentity: AccessIdentity;
  requestId: string;
}

export type AppEnvironment = {
  Bindings: AppBindings;
  Variables: AppVariables;
};

type AppContext = Context<AppEnvironment>;

interface HealthData {
  service: "biblequiz-app";
  status: "ok";
  timestamp: string;
}

interface DatabaseHealthData {
  database: "d1";
  status: "ok";
  timestamp: string;
}

export const app = new Hono<AppEnvironment>();

app.use("/api/*", async (context, next) => {
  const requestId = crypto.randomUUID();
  context.set("requestId", requestId);
  await next();
  context.header("x-request-id", requestId);
});

app.use("/api/admin/*", async (context, next) => {
  const requestId = context.get("requestId");
  try {
    context.set("accessIdentity", await authenticateAccessRequest(context.req.raw, {
      audience: context.env.ACCESS_AUD,
      teamDomain: context.env.ACCESS_TEAM_DOMAIN,
    }));
    await next();
  } catch (error) {
    if (error instanceof AccessAuthenticationRequired) {
      return context.json(failure({
        code: "ADMIN_AUTH_REQUIRED",
        message: "관리자 로그인이 필요합니다.",
        requestId,
      }), 401);
    }
    if (error instanceof AccessAuthenticationUnavailable) {
      console.error(JSON.stringify({ level: "error", requestId, code: "ADMIN_AUTH_UNAVAILABLE" }));
      return context.json(failure({
        code: "ADMIN_AUTH_UNAVAILABLE",
        message: "관리자 인증을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        requestId,
      }), 503);
    }
    throw error;
  }
});

app.route("/", operationsRoutes);
app.route("/", weeklyRoutes);

// A preview reads public video information without saving a transcript or creating a draft.
app.post("/api/admin/sermon-drafts/video-preview", async context => {
  context.header("Cache-Control", "private, no-store");
  try {
    if (new URL(context.req.url).search) throw new PublicVideoError("VIDEO_INVALID");
    const body = await readSameOriginJson(context.req.raw);
    const provider = createPublicTranscriptProvider(context.env, fetch);
    return context.json(success(await previewPublicSermonVideo(context.env.DB, body, provider)));
  } catch (error) { return publicVideoErrorResponse(context, error); }
});
app.all("/api/admin/sermon-drafts/video-preview", context => {
  context.header("Cache-Control", "private, no-store");
  return context.json(failure({ code: "METHOD_NOT_ALLOWED", message: mutationErrorMessages.METHOD_NOT_ALLOWED, requestId: context.get("requestId") }), 405);
});
// Draft registration stays behind the same Access and same-origin mutation boundary.
app.on(["GET", "POST"], "/api/admin/sermon-drafts", async context => {
  context.header("Cache-Control", "private, no-store");
  try {
    if (new URL(context.req.url).search) throw new SermonDraftError("DRAFT_INVALID");
    if (context.req.method === "GET") return context.json(success(await listSermonDrafts(context.env.DB)));
    return context.json(success(await registerSermonDraft(context.env.DB, await readSameOriginJson(context.req.raw), context.get("accessIdentity").email)));
  } catch (error) { return draftErrorResponse(context, error); }
});
app.on(["GET", "PATCH"], "/api/admin/sermon-drafts/:id", async context => {
  context.header("Cache-Control", "private, no-store");
  try {
    if (new URL(context.req.url).search) throw new SermonDraftError("DRAFT_INVALID");
    const id = adminSermonIdSchema.safeParse(context.req.param("id"));
    if (!id.success) throw new SermonDraftError("DRAFT_INVALID");
    return context.json(success(context.req.method === "GET"
      ? await readSermonDraft(context.env.DB, id.data)
      : await saveSermonDraft(context.env.DB, id.data, await readSameOriginJson(context.req.raw))));
  } catch (error) { return draftErrorResponse(context, error); }
});
for (const path of ["/api/admin/sermon-drafts", "/api/admin/sermon-drafts/:id"]) app.all(path, context => {
  context.header("Cache-Control", "private, no-store");
  return context.json(failure({ code: "METHOD_NOT_ALLOWED", message: mutationErrorMessages.METHOD_NOT_ALLOWED, requestId: context.get("requestId") }), 405);
});
function draftErrorResponse(context: AppContext, error: unknown) {
  if (error instanceof MutationRequestError) return context.json(failure({ code: error.code, message: mutationErrorMessages[error.code], requestId: context.get("requestId") }), error.status);
  const code = error instanceof SermonDraftError ? error.code : "DRAFT_UNAVAILABLE";
  const message = code === "DRAFT_INVALID" ? "영상 링크·제목·날짜·장절과 확인 여부를 다시 살펴봐 주세요."
    : code === "DRAFT_NOT_FOUND" ? "편집 가능한 미발행 작업을 찾지 못했습니다. 발행 관리와 초안 보관 상태를 확인해 주세요."
    : code === "DRAFT_CONFLICT" ? "다른 저장이나 발행이 처리됐습니다. 최신 정보를 다시 불러와 주세요."
    : "저장 결과를 확인하지 못했습니다. 목록을 새로고침해 확인해 주세요.";
  return context.json(failure({ code, message, requestId: context.get("requestId") }), code === "DRAFT_INVALID" ? 400 : code === "DRAFT_NOT_FOUND" ? 404 : code === "DRAFT_CONFLICT" ? 409 : 503);
}

function publicVideoErrorResponse(context: AppContext, error: unknown) {
  if (error instanceof MutationRequestError) return context.json(failure({ code: error.code, message: mutationErrorMessages[error.code], requestId: context.get("requestId") }), error.status);
  const code = error instanceof PublicVideoError ? error.code
    : error instanceof SermonDraftError && error.code === "DRAFT_NOT_FOUND" ? "DRAFT_NOT_FOUND" : "VIDEO_UNAVAILABLE";
  const message = code === "VIDEO_INVALID" ? "영상 링크 또는 요청 내용을 확인해 주세요."
    : code === "VIDEO_CONFLICT" ? "다른 입력자료가 먼저 저장됐습니다. 현재 작업을 새로고침해 주세요."
    : code === "VIDEO_TOO_LARGE" ? "공개 자막이 3만 자를 넘습니다. 원본을 자동으로 자르지 않았습니다."
    : code === "DRAFT_NOT_FOUND" ? "편집 가능한 미발행 작업을 찾지 못했습니다."
    : code === "VIDEO_SAVE_UNCERTAIN" ? "원본 저장 결과를 확인하지 못했습니다. 현재 작업을 새로고침해 주세요."
    : "영상 조회 또는 원본 저장을 완료하지 못했습니다. 직접 붙여넣기로 진행할 수 있습니다.";
  const status = code === "VIDEO_INVALID" ? 400 : code === "DRAFT_NOT_FOUND" ? 404
    : code === "VIDEO_CONFLICT" ? 409 : code === "VIDEO_TOO_LARGE" ? 422 : 503;
  return context.json(failure({ code, message, requestId: context.get("requestId") }), status);
}

app.get("/api/admin/draft-cleanup", async context => {
  context.header("Cache-Control", "no-store");
  if (Object.keys(context.req.query()).length) return context.json(failure({ code: "INVALID_QUERY", message: "지원하지 않는 조회 조건입니다.", requestId: context.get("requestId") }), 400);
  return context.json(success(await listDraftCleanup(context.env.DB)));
});
app.get("/api/admin/quiz-sets/:id/ai-costs", async context => {
  context.header("Cache-Control", "private, no-store");
  const requestId = context.get("requestId");
  if (new URL(context.req.url).search) return context.json(failure({ code: "INVALID_QUERY", message: "지원하지 않는 조회 조건입니다.", requestId }), 400);
  const quizSetId = quizSetIdSchema.safeParse(context.req.param("id"));
  if (!quizSetId.success) return context.json(failure({ code: "QUIZ_NOT_FOUND", message: "퀴즈를 찾지 못했습니다.", requestId }), 404);
  try {
    return context.json(success(await readAdminAiCosts(context.env.DB, quizSetId.data)));
  } catch (error) {
    if (error instanceof AdminAiCostsNotFound) return context.json(failure({ code: "QUIZ_NOT_FOUND", message: "퀴즈를 찾지 못했습니다.", requestId }), 404);
    console.error(JSON.stringify({ level: "error", requestId, code: "AI_COSTS_READ_FAILED" }));
    return context.json(failure({ code: "AI_COSTS_UNAVAILABLE", message: "AI 비용 기록을 확인하지 못했습니다. 다시 시도해 주세요.", requestId }), 503);
  }
});
app.use("/api/admin/sermons/:id/*", async (context, next) => {
  if (await draftIsPurged(context.env.DB, context.req.param("id")!)) {
    context.header("Cache-Control", "no-store");
    return context.json(failure({ code: "DRAFT_EXPIRED", message: "보관 기간이 지난 초안이 정리되었습니다. 새 초안에서 시작해 주세요. 발행된 퀴즈와 비용 기록은 보존됩니다.", requestId: context.get("requestId") }), 410);
  }
  await next();

});

app.get("/api/health", (context) => {
  return context.json(
    success<HealthData>({
      service: "biblequiz-app",
      status: "ok",
      timestamp: new Date().toISOString(),
    }),
  );
});

app.get("/api/health/database", async (context) => {
  const repository = createFoundationRepository(createDatabase(context.env.DB));
  const isReady = await repository.isDatabaseReady();

  if (!isReady) {
    throw new Error("D1 readiness query returned an invalid result.");
  }

  return context.json(
    success<DatabaseHealthData>({
      database: "d1",
      status: "ok",
      timestamp: new Date().toISOString(),
    }),
  );
});

const mutationErrorMessages = {
  INVALID_JSON: "올바른 JSON 요청을 보내 주세요.",
  METHOD_NOT_ALLOWED: "지원하지 않는 요청 방식입니다.",
  ORIGIN_NOT_ALLOWED: "이 페이지에서 다시 시도해 주세요.",
  PAYLOAD_TOO_LARGE: "요청 내용이 너무 큽니다.",
  UNSUPPORTED_MEDIA_TYPE: "JSON 형식으로 요청해 주세요.",
} as const;

// A valid 1 MiB manual source can nearly double when quotes, backslashes, tabs,
// or newlines are JSON escaped. The source validator still enforces the exact
// unescaped UTF-8 and caption character limits.
const MAX_ADMIN_SERMON_INPUT_JSON_BYTES = (2 * 1_048_576) + 4_096;

const submissionValidationMessages = {
  CONTENT_BLOCKED: "입력한 내용을 확인해 주세요.",
  EMPTY_SUBMISSION: "한 칸 이상 입력해 주세요.",
  INVALID_COMMENT: "한줄평 형식을 확인해 주세요.",
  INVALID_GRID_SHAPE: "현재 퀴즈의 답안 칸을 다시 확인해 주세요.",
  INVALID_HANGUL_SYLLABLE: "각 칸에는 완성된 한글 한 글자만 입력해 주세요.",
  INVALID_NAME: "이름 형식을 확인해 주세요.",
  NAME_RESERVED: "다른 이름을 사용해 주세요.",
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function classifyRawCells(body: unknown): "INVALID_GRID_SHAPE" | "INVALID_HANGUL_SYLLABLE" | undefined {
  if (!isRecord(body) || !isRecord(body.cells)) return undefined;
  for (const [id, rawValue] of Object.entries(body.cells)) {
    if (!/^r[0-9]c[0-9]$/u.test(id)) return "INVALID_GRID_SHAPE";
    if (typeof rawValue !== "string" || !isCompleteHangulSyllable(rawValue.normalize("NFC"))) {
      return "INVALID_HANGUL_SYLLABLE";
    }
  }
  return undefined;
}

function submissionResult(
  submission: StoredVisibleSubmission,
  solution: StoredScoringSolution,
) {
  return submissionResultSchema.parse({
    submissionId: submission.id,
    submittedAt: submission.submittedAt,
    correctCells: submission.correctCells,
    totalCells: submission.totalCells,
    correctWords: submission.correctWords,
    totalWords: submission.totalWords,
    scoreBasisPoints: submission.scoreBasisPoints,
    correctnessMask: submission.correctnessMask,
    canRevealAnswer: true,
    solution: solution.solution,
  });
}

function ownSubmissionData(
  submission: StoredSubmission | undefined,
  solution?: StoredScoringSolution,
) {
  if (submission === undefined) {
    return ownSubmissionDataSchema.parse({ submission: null });
  }
  if (submission.status === "deleted") {
    return ownSubmissionDataSchema.parse({
      submission: {
        status: "deleted",
        quizVariantId: submission.quizVariantId,
        quizRevision: submission.quizRevision,
        deletedAt: submission.deletedAt,
      },
    });
  }
  if (solution === undefined) throw new Error("Missing scoring solution");
  return ownSubmissionDataSchema.parse({
    submission: {
      status: "submitted",
      quizVariantId: submission.quizVariantId,
      quizRevision: submission.quizRevision,
      answers: submission.answers,
      result: submissionResult(submission, solution),
    },
  });
}

function submissionDeletionData(submission: StoredDeletedSubmission) {
  return submissionDeletionDataSchema.parse({
    submission: {
      status: "deleted",
      quizVariantId: submission.quizVariantId,
      quizRevision: submission.quizRevision,
      deletedAt: submission.deletedAt,
    },
  });
}

function storedScoreMatches(
  submission: StoredVisibleSubmission,
  score: ReturnType<typeof scoreSubmission>,
): boolean {
  const storedAnswers = Object.entries(submission.answers).sort(([left], [right]) => left.localeCompare(right));
  const rescoredAnswers = Object.entries(score.answers).sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(storedAnswers) === JSON.stringify(rescoredAnswers) &&
    submission.correctnessMask === score.correctnessMask &&
    submission.correctCells === score.correctCells &&
    submission.totalCells === score.totalCells &&
    submission.correctWords === score.correctWords &&
    submission.totalWords === score.totalWords &&
    submission.scoreBasisPoints === score.scoreBasisPoints &&
    submission.isFullyCorrect === score.isFullyCorrect;
}

async function runSubmissionModeration(
  context: AppContext,
  action: "hide" | "unhide" | "delete",
  reason: string,
  submissionId: string,
) {
  const identity = context.get("accessIdentity");
  const result = await createSubmissionModerationService(createDatabase(context.env.DB)).moderate({
    action,
    actorEmail: identity.email,
    changedAt: new Date().toISOString(),
    ids: {
      actionId: crypto.randomUUID(),
      auditId: crypto.randomUUID(),
      ...(action === "delete" ? { deletionMarkerAuditId: crypto.randomUUID() } : {}),
    },
    reason,
    submissionId,
  });
  return result.status === "deleted"
    ? deletedSubmissionAsAdminDataSchema.parse({
        ...result,
        deletedAt: result.deletedAt!,
      })
    : moderatedSubmissionDataSchema.parse(result);
}

function adminSubmissionModerationFailure(
  context: AppContext,
  error: unknown,
) {
  const requestId = context.get("requestId");
  if (error instanceof MutationRequestError) {
    return context.json(failure({
      code: error.code,
      message: mutationErrorMessages[error.code],
      requestId,
    }), error.status);
  }
  if (error instanceof SubmissionModerationNotFound) {
    return context.json(failure({
      code: "SUBMISSION_NOT_FOUND",
      message: "관리할 제출 기록을 찾을 수 없습니다.",
      requestId,
    }), 404);
  }
  if (error instanceof SubmissionModerationInvalidState) {
    return context.json(failure({
      code: "SUBMISSION_MODERATION_INVALID_STATE",
      message: "현재 제출 상태에서는 이 작업을 수행할 수 없습니다.",
      requestId,
    }), 409);
  }
  if (error instanceof SubmissionModerationUnavailable) {
    console.error(JSON.stringify({ level: "error", requestId, code: "SUBMISSION_MODERATION_FAILED" }));
    return context.json(failure({
      code: "SUBMISSION_MODERATION_UNAVAILABLE",
      message: "제출 기록을 변경하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      requestId,
    }), 503);
  }
  throw error;
}

function bibleReferenceResponse(context: AppContext, result: BibleReferenceResult) {
  if (!result.ok) {
    return context.json(failure({
      code: result.error.code,
      message: result.error.message,
      requestId: context.get("requestId"),
    }), 400);
  }
  return context.json(success(adminBibleReferenceDataSchema.parse(result.value)));
}

app.post("/api/admin/bible/parse-reference", async (context) => {
  context.header("Cache-Control", "private, no-store");
  const requestId = context.get("requestId");
  try {
    if ([...new URL(context.req.url).searchParams.keys()].length > 0) {
      return context.json(failure({
        code: "INVALID_BIBLE_REFERENCE_QUERY",
        message: "이 요청에는 검색 조건을 사용할 수 없습니다.",
        requestId,
      }), 400);
    }
    const body = await readSameOriginJson(context.req.raw);
    const parsed = parseBibleReferenceRequestSchema.safeParse(body);
    if (!parsed.success) {
      return context.json(failure({
        code: "INVALID_BIBLE_REFERENCE_REQUEST",
        message: "성경 장절 입력 요청 형식을 확인해 주세요.",
        requestId,
      }), 400);
    }
    return bibleReferenceResponse(context, parseBibleReference(parsed.data.input));
  } catch (error) {
    if (error instanceof MutationRequestError) {
      return context.json(failure({
        code: error.code,
        message: mutationErrorMessages[error.code],
        requestId,
      }), error.status);
    }
    throw error;
  }
});

app.all("/api/admin/bible/parse-reference", (context) => {
  context.header("Cache-Control", "private, no-store");
  return context.json(failure({
    code: "METHOD_NOT_ALLOWED",
    message: mutationErrorMessages.METHOD_NOT_ALLOWED,
    requestId: context.get("requestId"),
  }), 405);
});

app.get("/api/admin/bible/reference-preview", (context) => {
  context.header("Cache-Control", "private, no-store");
  const requestId = context.get("requestId");
  const searchParams = new URL(context.req.url).searchParams;
  const entries = [...searchParams.entries()];
  const parsed = entries.length === 4
    ? bibleReferencePreviewQuerySchema.safeParse(Object.fromEntries(entries))
    : { success: false } as const;
  if (!parsed.success) {
    return context.json(failure({
      code: "INVALID_BIBLE_REFERENCE_QUERY",
      message: "성경 책·장·시작 절·끝 절 검색 조건을 확인해 주세요.",
      requestId,
    }), 400);
  }
  return bibleReferenceResponse(context, createBibleReference({
    bookId: parsed.data.book,
    chapter: parsed.data.chapter,
    verseEnd: parsed.data.verseEnd,
    verseStart: parsed.data.verseStart,
  }));
});

app.all("/api/admin/bible/reference-preview", (context) => {
  context.header("Cache-Control", "private, no-store");
  return context.json(failure({
    code: "METHOD_NOT_ALLOWED",
    message: mutationErrorMessages.METHOD_NOT_ALLOWED,
    requestId: context.get("requestId"),
  }), 405);
});

app.get("/api/admin/sermons/:id/generation/correction", async (context) => {
  context.header("Cache-Control", "private, no-store");
  const requestId = context.get("requestId");
  const sermonId = adminSermonIdSchema.safeParse(context.req.param("id"));
  if (!sermonId.success || new URL(context.req.url).search) return context.json(failure({
    code: "GENERATION_REQUEST_INVALID", message: "설교를 확인해 주세요.", requestId }), 400);
  try {
    const quiz = await context.env.DB.prepare("SELECT id FROM quiz_sets WHERE sermon_id=? AND status IN ('draft','needs_revision','review_ready')")
      .bind(sermonId.data).first<{ id: string }>();
    const latest = await context.env.DB.prepare("SELECT id FROM generation_jobs WHERE sermon_id=? AND request_scope='transcript_correction' ORDER BY created_at DESC,id DESC LIMIT 1")
      .bind(sermonId.data).first<{ id: string }>();
    return context.json(success(adminGenerationAvailabilitySchema.parse({
      enabled: context.env.AI_GENERATION_ENABLED === "true" && !!context.env.CONTENT_WORKFLOW,
      quizSetId: quiz?.id ?? null, latestJobId: latest?.id ?? null,
    })));
  } catch { return context.json(failure({ code: "GENERATION_STATUS_UNAVAILABLE", message: "AI 교정 연결을 확인하지 못했습니다.", requestId }), 503); }
});

app.post("/api/admin/sermons/:id/generation/correction", async (context) => {
  context.header("Cache-Control", "private, no-store");
  const requestId = context.get("requestId");
  try {
    const body = await readSameOriginJson(context.req.raw);
    const command = adminCorrectionGenerationRequestSchema.safeParse(body);
    const sermonId = adminSermonIdSchema.safeParse(context.req.param("id"));
    if (!command.success || !sermonId.success || new URL(context.req.url).search) {
      return context.json(failure({ code: "GENERATION_REQUEST_INVALID", message: "생성 요청을 확인해 주세요.", requestId }), 400);
    }
    if (context.env.AI_GENERATION_ENABLED !== "true" || !context.env.CONTENT_WORKFLOW) {
      return context.json(failure({ code: "GENERATION_DISABLED", message: "AI 실행 연결을 아직 활성화하지 않았습니다.", requestId }), 503);
    }
    const actor = await sha256Bytes(new TextEncoder().encode(context.get("accessIdentity").email));
    const requested = await requestCorrection(context.env.DB, sermonId.data, command.data, actor);
    const dispatch = await sendContentDispatch(context.env.DB, context.env.CONTENT_WORKFLOW, requested.dispatchId);
    return context.json(success(adminGenerationStartDataSchema.parse({ jobId: requested.jobId, dispatch: dispatch.outcome })), 202);
  } catch (error) {
    if (error instanceof MutationRequestError) return context.json(failure({ code: error.code,
      message: mutationErrorMessages[error.code], requestId }), error.status);
    return context.json(failure({ code: "GENERATION_REQUEST_UNAVAILABLE",
      message: "현재 입력이나 저장 상태를 확인하지 못했습니다. 같은 요청의 상태를 확인해 주세요.", requestId }), 409);
  }
});

app.get("/api/admin/sermons/:id/generation/content", async context => {
  context.header("Cache-Control", "private, no-store");
  try {
    const sermonId = adminSermonIdSchema.parse(context.req.param("id"));
    const query = adminContentHistoryQuerySchema.parse(context.req.query());
    const enabled = fullGenerationEnabled(context.env, sermonId, context.req.url);
    const part = query.parts && query.section ? await readContentGenerationParts(context.env.DB, sermonId, enabled, query.section, query.before, query.snapshotId, query.difficulty) : null;
    return context.json(success(part ?? await readContentGenerationView(context.env.DB, sermonId, enabled, query.before, query.section)));
  } catch { return context.json(failure({ code: "GENERATION_STATUS_UNAVAILABLE", message: "생성 자료를 확인하지 못했습니다. 입력과 작업 상태를 확인해 주세요.", requestId: context.get("requestId") }), 409); }
});
app.post("/api/admin/sermons/:id/generation/content", async context => {
  context.header("Cache-Control", "private, no-store");
  try {
    const raw = await readSameOriginJson(context.req.raw);
    const sermonId = adminSermonIdSchema.parse(context.req.param("id")), command = adminContentRequestSchema.parse(raw);
    if (new URL(context.req.url).search) throw new Error("invalid");
    if (!context.env.CONTENT_WORKFLOW || !fullGenerationEnabled(context.env, sermonId, context.req.url)) return context.json(failure({
      code: "GENERATION_DISABLED", message: "AI 실행 연결을 아직 활성화하지 않았습니다.", requestId: context.get("requestId") }), 503);
    const actor = await sha256Bytes(new TextEncoder().encode(context.get("accessIdentity").email));
    const requested = await requestFullGeneration(context.env.DB, sermonId, command, actor);
    const dispatch = await sendContentDispatch(context.env.DB, context.env.CONTENT_WORKFLOW, requested.dispatchId);
    return context.json(success({ jobId: requested.jobId, dispatch: dispatch.outcome }), 202);
  } catch (error) {
    if (error instanceof MutationRequestError) return context.json(failure({ code: error.code, message: mutationErrorMessages[error.code], requestId: context.get("requestId") }), error.status);
    return context.json(failure({ code: "GENERATION_REQUEST_UNAVAILABLE", message: "요청을 확인하지 못했습니다. 같은 작업의 상태를 확인해 주세요.", requestId: context.get("requestId") }), 409);
  }
});
app.post("/api/admin/sermons/:id/generation/regenerate", async context => {
  context.header("Cache-Control", "private, no-store");
  try {
    const raw = await readSameOriginJson(context.req.raw);
    const sermonId = adminSermonIdSchema.parse(context.req.param("id")), command = adminRegenerationRequestSchema.parse(raw);
    if (new URL(context.req.url).search) throw new Error("invalid");
    if (context.env.AI_GENERATION_ENABLED !== "true" || !context.env.CONTENT_WORKFLOW) return context.json(failure({
      code: "GENERATION_DISABLED", message: "AI 실행 연결을 아직 활성화하지 않았습니다.", requestId: context.get("requestId") }), 503);
    const actor = await sha256Bytes(new TextEncoder().encode(context.get("accessIdentity").email));
    const requested = await requestContentRegeneration(context.env.DB, sermonId, command, actor);
    const dispatch = await sendContentDispatch(context.env.DB, context.env.CONTENT_WORKFLOW, requested.dispatchId);
    return context.json(success({ jobId: requested.jobId, dispatch: dispatch.outcome }), 202);
  } catch (error) {
    if (error instanceof MutationRequestError) return context.json(failure({ code: error.code, message: mutationErrorMessages[error.code], requestId: context.get("requestId") }), error.status);
    return context.json(failure({ code: "GENERATION_REQUEST_UNAVAILABLE", message: "개별 재생성 요청을 확인하지 못했습니다. 같은 작업의 상태를 확인해 주세요.", requestId: context.get("requestId") }), 409);
  }
});
app.get("/api/admin/sermons/:id/generation/:jobId/final-check/:requestKey", async context => {
  context.header("Cache-Control", "private, no-store");
  try {
    const sermonId = adminSermonIdSchema.parse(context.req.param("id")), jobId = adminSermonIdSchema.parse(context.req.param("jobId"));
    const requestKey = adminFinalCheckRequestSchema.parse({ requestKey: context.req.param("requestKey") }).requestKey!;
    if (new URL(context.req.url).search || !context.env.CONTENT_WORKFLOW || context.env.CONTENT_FINAL_CHECK_WORKFLOW_ENABLED !== "true") throw new Error("disabled");
    const job = await createGenerationLifecycleStore(context.env.DB).readJob(jobId);
    if (job.outcome !== "present" || job.value.sermon_id !== sermonId || job.value.request_scope !== "full") throw new Error("owner");
    return context.json(success(adminFinalCheckStatusSchema.parse(await readContentFinalCheck(context.env.CONTENT_WORKFLOW, jobId, requestKey))));
  } catch { return context.json(failure({ code: "FINAL_CHECK_UNAVAILABLE", message: "최종 검사 상태를 확인하지 못했습니다. 저장된 자료는 그대로 유지됩니다.", requestId: context.get("requestId") }), 409); }
});
app.get("/api/admin/sermons/:id/generation/:jobId/display-preparation/:requestKey", async context => {
  context.header("Cache-Control", "private, no-store");
  try {
    const sermonId = adminSermonIdSchema.parse(context.req.param("id")), jobId = adminSermonIdSchema.parse(context.req.param("jobId"));
    const requestKey = adminFinalCheckRequestSchema.parse({ requestKey: context.req.param("requestKey") }).requestKey!;
    if (new URL(context.req.url).search || !context.env.CONTENT_WORKFLOW || !displayPreparationEnabled(context.env, sermonId)) throw new Error("disabled");
    const job = await createGenerationLifecycleStore(context.env.DB).readJob(jobId);
    if (job.outcome !== "present" || job.value.sermon_id !== sermonId || job.value.request_scope !== "full") throw new Error("owner");
    return context.json(success(await readDisplayPreparation(context.env.CONTENT_WORKFLOW, jobId, requestKey)));
  } catch { return context.json(failure({ code: "DISPLAY_PREPARATION_UNAVAILABLE", message: "표시 자료 준비 상태를 확인하지 못했습니다. 기존 자료는 그대로 유지됩니다.", requestId: context.get("requestId") }), 409); }
});
app.post("/api/admin/sermons/:id/generation/:jobId/:action", async context => {
  context.header("Cache-Control", "private, no-store");
  try {
    const db = generationReadSession(context.env.DB);
    const raw = await readSameOriginJson(context.req.raw);
    const sermonId = adminSermonIdSchema.parse(context.req.param("id")), jobId = adminSermonIdSchema.parse(context.req.param("jobId"));
    if (new URL(context.req.url).search) throw new Error("invalid");
    const job = await createGenerationLifecycleStore(db).readJob(jobId);
    const action = context.req.param("action");
    if (job.outcome !== "present" || job.value.sermon_id !== sermonId || !(
      job.value.request_scope === "full" && job.value.execution_contract_version === 3 ||
      ["resume", "discard"].includes(action) && job.value.request_scope === "intent" && job.value.execution_contract_version === 2
    )) throw new Error("owner");
    const owner = { jobId, sermonId, quizSetId: job.value.quiz_set_id };
    if (action === "display-prepare") {
      const command = adminFinalCheckRequestSchema.parse(raw);
      if (!context.env.CONTENT_WORKFLOW || !displayPreparationEnabled(context.env, sermonId)) throw new Error("disabled");
      return context.json(success(await queueDisplayPreparation(context.env.CONTENT_WORKFLOW,
        { kind: "display-prepare", ...owner, requestKey: command.requestKey ?? crypto.randomUUID() })), 202);
    }
    if (action === "resume-stored") {
      const actor = await sha256Bytes(new TextEncoder().encode(context.get("accessIdentity").email));
      return context.json(success(await resumeStoredContent(db, owner, raw, actor)));
    }
    if (action === "placement-trial") return context.json(success(await trialContentPlacement(db, owner, raw)));
    if (action === "placement-select") {
      const actor = await sha256Bytes(new TextEncoder().encode(context.get("accessIdentity").email));
      return context.json(success(await selectContentPlacement(db, owner, raw, actor)));
    }
    if (action === "quality") {
      const actor = await sha256Bytes(new TextEncoder().encode(context.get("accessIdentity").email));
      return context.json(success(await saveContentQualityReview(db, owner, raw, actor)));
    }
    if (action === "review") {
      const actor = await sha256Bytes(new TextEncoder().encode(context.get("accessIdentity").email));
      return context.json(success(await executeContentHumanCommand(db, owner, adminContentCommandSchema.parse(raw), actor)));
    }
    if (action === "finish") {
      const command = adminFinalCheckRequestSchema.parse(raw);
      if (context.env.CONTENT_FINAL_CHECK_WORKFLOW_ENABLED === "true") {
        if (!context.env.CONTENT_WORKFLOW) throw new Error("disabled");
        // Synthetic Preview remains scoped to the operator's exact allowlist.
        if (context.env.P571_SYNTHETIC_SERMON_IDS !== undefined && !fullGenerationEnabled(context.env, sermonId, context.req.url)) throw new Error("disabled");
        return context.json(success(await queueContentFinalCheck(context.env.CONTENT_WORKFLOW,
          { kind: "final-check", ...owner, requestKey: command.requestKey ?? crypto.randomUUID() })), 202);
      }
      const result = await finishContentGeneration(db, owner);
      if (result.outcome === "review_ready" && context.env.CONTENT_WORKFLOW) {
        try { await (await context.env.CONTENT_WORKFLOW.get(jobId)).sendEvent({ type: "content-resume", payload: { dispatchId: `dispatch-${jobId}` } }); } catch { /* Durable result remains authoritative. */ }
      }
      return context.json(success(result));
    }
    if (!raw || typeof raw !== "object" || Object.keys(raw).length !== 0) throw new Error("invalid");
    if (action === "discard") return context.json(success(await discardIntentRegeneration(db, owner)));
    if (action === "resume") {
      if (!context.env.CONTENT_WORKFLOW || !fullGenerationEnabled(context.env, sermonId, context.req.url)) throw new Error("disabled");
      const resume = await requestContentResume(db, owner);
      return context.json(success("dispatchId" in resume ? await sendContentDispatch(db, context.env.CONTENT_WORKFLOW, resume.dispatchId) : resume));
    }
    throw new Error("invalid");
  } catch (error) {
    if (error instanceof MutationRequestError) return context.json(failure({ code: error.code, message: mutationErrorMessages[error.code], requestId: context.get("requestId") }), error.status);
    return context.json(failure({ code: "GENERATION_COMMAND_UNAVAILABLE", message: "현재 자료가 변경되었거나 검수가 끝나지 않았습니다. 상태를 다시 확인해 주세요.", requestId: context.get("requestId") }), 409);
  }
});

app.get("/api/admin/published-quizzes", async context => {
  context.header("Cache-Control", "private, no-store");
  try {
    if (new URL(context.req.url).search) throw new Error("invalid query");
    return context.json(success(await listPublishedMetadata(context.env.DB)));
  } catch {
    return context.json(failure({ code: "DISPLAY_TEXT_UNAVAILABLE", message: "발행 목록을 불러오지 못했습니다. 다시 확인해 주세요.", requestId: context.get("requestId") }), 409);
  }
});
app.on(["GET", "PATCH"], "/api/admin/quiz-sets/:id/display-text", async context => {
  context.header("Cache-Control", "private, no-store");
  try {
    const id = quizSetIdSchema.parse(context.req.param("id"));
    if (new URL(context.req.url).search) throw new Error("invalid query");
    if (context.req.method === "GET") return context.json(success(await readPublishedDisplayText(context.env.DB, id)));
    const raw = await readSameOriginJson(context.req.raw);
    return context.json(success(await correctPublishedDisplayText(context.env.DB, id, raw, context.get("accessIdentity").email)));
  } catch (error) {
    if (error instanceof MutationRequestError) return context.json(failure({ code: error.code, message: mutationErrorMessages[error.code], requestId: context.get("requestId") }), error.status);
    if (error instanceof SemanticCorrectionRequired) return context.json(failure({ code: "SEMANTIC_CORRECTION_REQUIRED", message: "단서·요약·정답·격자 변경은 문제 오류 처리에서 진행해 주세요.", requestId: context.get("requestId") }), 409);
    return context.json(failure({ code: "DISPLAY_TEXT_UNAVAILABLE", message: "제목·설교일과 사유를 확인해 주세요. 다른 정정이 저장되었다면 최신 내용을 다시 불러와 주세요. 단서·요약·정답 수정은 문제 오류 처리 범위입니다.", requestId: context.get("requestId") }), 409);
  }
});
app.on(["GET", "PATCH"], "/api/admin/quiz-sets/:id/display-text/wording", async context => {
  context.header("Cache-Control", "private, no-store");
  try {
    if (new URL(context.req.url).search) throw new Error("invalid query");
    const id = quizSetIdSchema.parse(context.req.param("id"));
    if (context.req.method === "GET") return context.json(success(await readPublishedWording(context.env.DB, id)));
    return context.json(success(await correctPublishedWording(context.env.DB, id,
      await readSameOriginJson(context.req.raw, MAX_ADMIN_SERMON_INPUT_JSON_BYTES), context.get("accessIdentity").email)));
  } catch (error) {
    if (error instanceof MutationRequestError) return context.json(failure({ code: error.code, message: mutationErrorMessages[error.code], requestId: context.get("requestId") }), error.status);
    if (error instanceof SemanticCorrectionRequired) return context.json(failure({ code: "SEMANTIC_CORRECTION_REQUIRED", message: "의미·난이도·정답 유도가 바뀌거나 판단이 불확실하면 문제 오류 처리에서 진행해 주세요.", requestId: context.get("requestId") }), 409);
    return context.json(failure({ code: "DISPLAY_TEXT_UNAVAILABLE", message: "문구와 사유를 확인해 주세요. 다른 정정이나 오류 처리가 진행되었다면 최신 내용을 다시 불러와 주세요.", requestId: context.get("requestId") }), 409);
  }
});
app.all("/api/admin/quiz-sets/:id/display-text/wording", context => {
  context.header("Cache-Control", "private, no-store");
  return context.json(failure({ code: "METHOD_NOT_ALLOWED", message: mutationErrorMessages.METHOD_NOT_ALLOWED, requestId: context.get("requestId") }), 405);
});

app.all("/api/admin/published-quizzes", context => {
  context.header("Cache-Control", "private, no-store");
  return context.json(failure({ code: "METHOD_NOT_ALLOWED", message: mutationErrorMessages.METHOD_NOT_ALLOWED, requestId: context.get("requestId") }), 405);
});
app.all("/api/admin/quiz-sets/:id/display-text", context => {
  context.header("Cache-Control", "private, no-store");
  return context.json(failure({ code: "METHOD_NOT_ALLOWED", message: mutationErrorMessages.METHOD_NOT_ALLOWED, requestId: context.get("requestId") }), 405);
});

app.get("/api/admin/quiz-sets/:id/problem-records",async context=>{
 context.header("Cache-Control","private, no-store");
 try {if(new URL(context.req.url).search)throw new Error();return context.json(success(await readProblemRecords(context.env.DB,context.req.param("id"))));}
 catch {return context.json(failure({code:"PROBLEM_RECORDS_UNAVAILABLE",message:"오류 처리 원본을 확인하지 못했습니다.",requestId:context.get("requestId")}),409);}
});
app.all("/api/admin/quiz-sets/:id/problem-records",context=>{context.header("Cache-Control","private, no-store");return context.json(failure({code:"METHOD_NOT_ALLOWED",message:mutationErrorMessages.METHOD_NOT_ALLOWED,requestId:context.get("requestId")}),405);});

app.on(["GET", "POST"], "/api/admin/quiz-sets/:id/problem-corrections", async context => {
  context.header("Cache-Control", "private, no-store");
  try {
    const id = quizSetIdSchema.parse(context.req.param("id"));
    if (new URL(context.req.url).search) throw new Error("invalid query");
    if (context.req.method === "GET") return context.json(success(await readProblemCorrection(context.env.DB,id)));
    return context.json(success(await executeProblemCorrection(context.env.DB,id,await readSameOriginJson(context.req.raw, MAX_ADMIN_SERMON_INPUT_JSON_BYTES),context.get("accessIdentity").email)));
  } catch (error) {
    if (error instanceof WithdrawalEditsExpired) return context.json(failure({ code: "DRAFT_EXPIRED",message: "편집본이 정리되었습니다. 원래 철회 자료에서 새 편집을 시작할 수 있습니다.",requestId: context.get("requestId") }),410);
    if (error instanceof MutationRequestError) return context.json(failure({ code: error.code,message: mutationErrorMessages[error.code],requestId: context.get("requestId") }),error.status);
    return context.json(failure({ code: "PROBLEM_CORRECTION_UNAVAILABLE",message: "현재 저장본·검토·발행 상태를 확인해 주세요. 같은 요청을 재확인하거나 최신 저장본을 불러올 수 있습니다.",requestId: context.get("requestId") }),409);
  }
});
app.all("/api/admin/quiz-sets/:id/problem-corrections", context => {
  context.header("Cache-Control", "private, no-store");
  return context.json(failure({ code: "METHOD_NOT_ALLOWED",message: mutationErrorMessages.METHOD_NOT_ALLOWED,requestId: context.get("requestId") }),405);
});

app.on(["GET", "POST"], "/api/admin/quiz-sets/:id/revision", async context => {
  context.header("Cache-Control", "private, no-store");
  try {
    const id = quizSetIdSchema.parse(context.req.param("id"));
    if (new URL(context.req.url).search) throw new Error("invalid query");
    if (context.req.method === "GET") return context.json(success(await readQuizRevision(context.env.DB,id)));
    return context.json(success(await executeQuizRevision(context.env.DB,id,await readSameOriginJson(context.req.raw, MAX_ADMIN_SERMON_INPUT_JSON_BYTES),context.get("accessIdentity").email)));
  } catch (error) {
    if (error instanceof WithdrawalEditsExpired) return context.json(failure({ code: "DRAFT_EXPIRED",message: "편집본이 정리되었습니다. 원래 철회 자료에서 새 편집을 시작할 수 있습니다.",requestId: context.get("requestId") }),410);
    if (error instanceof MutationRequestError) return context.json(failure({ code: error.code,message: mutationErrorMessages[error.code],requestId: context.get("requestId") }),error.status);
    return context.json(failure({ code: "REVISION_UNAVAILABLE",message: "현재 저장본·검토·발행 상태를 확인해 주세요. 같은 요청을 재확인하거나 최신 저장본을 불러올 수 있습니다.",requestId: context.get("requestId") }),409);
  }
});
app.all("/api/admin/quiz-sets/:id/revision", context => {
  context.header("Cache-Control", "private, no-store");
  return context.json(failure({ code: "METHOD_NOT_ALLOWED",message: mutationErrorMessages.METHOD_NOT_ALLOWED,requestId: context.get("requestId") }),405);
});

app.on(["GET", "POST"], "/api/admin/quiz-sets/:id/withdrawal-edits", async context => {
  context.header("Cache-Control", "private, no-store");
  try {
    const id = quizSetIdSchema.parse(context.req.param("id"));
    if (new URL(context.req.url).search) throw new Error("invalid query");
    if (context.req.method === "GET") return context.json(success(await readWithdrawalEdits(context.env.DB, id)));
    return context.json(success(await saveWithdrawalEdits(context.env.DB, id, await readSameOriginJson(context.req.raw), context.get("accessIdentity").email)));
  } catch (error) {
    if (error instanceof WithdrawalEditsExpired) return context.json(failure({ code: "DRAFT_EXPIRED", message: "보관 기간이 지난 편집본이 정리되었습니다. 원래 철회 자료와 발행 기록은 보존됩니다.", requestId: context.get("requestId") }), 410);
    if (error instanceof MutationRequestError) return context.json(failure({ code: error.code, message: mutationErrorMessages[error.code], requestId: context.get("requestId") }), error.status);
    return context.json(failure({ code: "WITHDRAWAL_EDITS_UNAVAILABLE", message: "편집본 저장 상태를 확인하지 못했습니다. 같은 요청을 재확인하거나 최신 편집본을 불러와 주세요.", requestId: context.get("requestId") }), 409);
  }
});
app.all("/api/admin/quiz-sets/:id/withdrawal-edits", context => {
  context.header("Cache-Control", "private, no-store");
  return context.json(failure({ code: "METHOD_NOT_ALLOWED", message: mutationErrorMessages.METHOD_NOT_ALLOWED, requestId: context.get("requestId") }), 405);
});

app.post("/api/admin/quiz-sets/:id/withdrawal-preview", async context => {
  context.header("Cache-Control", "private, no-store");
  try {
    const id = quizSetIdSchema.parse(context.req.param("id"));
    if (new URL(context.req.url).search) throw new Error("invalid query");
    return context.json(success(await previewWithdrawalEdits(context.env.DB, id, await readSameOriginJson(context.req.raw))));
  } catch (error) {
    if (error instanceof WithdrawalEditsExpired) return context.json(failure({ code: "DRAFT_EXPIRED", message: "보관 기간이 지난 편집본이 정리되었습니다. 원래 철회 자료와 발행 기록은 보존됩니다.", requestId: context.get("requestId") }), 410);
    if (error instanceof MutationRequestError) return context.json(failure({ code: error.code, message: mutationErrorMessages[error.code], requestId: context.get("requestId") }), error.status);
    return context.json(failure({ code: "WITHDRAWAL_PREVIEW_UNAVAILABLE", message: "철회 검수본과 수정할 문제를 다시 확인해 주세요.", requestId: context.get("requestId") }), 409);
  }
});
app.all("/api/admin/quiz-sets/:id/withdrawal-preview", context => {
  context.header("Cache-Control", "private, no-store");
  return context.json(failure({ code: "METHOD_NOT_ALLOWED", message: mutationErrorMessages.METHOD_NOT_ALLOWED, requestId: context.get("requestId") }), 405);
});

app.get("/api/admin/withdrawn-quizzes", async context => {
  context.header("Cache-Control", "private, no-store");
  try {
    if (new URL(context.req.url).search) throw new Error("invalid query");
    return context.json(success(await listWithdrawalReviews(context.env.DB)));
  } catch {
    return context.json(failure({ code: "WITHDRAWAL_UNAVAILABLE", message: "철회한 퀴즈를 불러오지 못했습니다.", requestId: context.get("requestId") }), 409);
  }
});
app.on(["GET", "POST"], "/api/admin/quiz-sets/:id/withdraw-to-review", async context => {
  context.header("Cache-Control", "private, no-store");
  try {
    const id = quizSetIdSchema.parse(context.req.param("id"));
    if (new URL(context.req.url).search) throw new Error("invalid query");
    if (context.req.method === "GET") return context.json(success(await readWithdrawalReview(context.env.DB, id)));
    const raw = await readSameOriginJson(context.req.raw);
    return context.json(success(await withdrawPublishedQuiz(context.env.DB, id, raw, context.get("accessIdentity").email)));
  } catch (error) {
    if (error instanceof MutationRequestError) return context.json(failure({ code: error.code, message: mutationErrorMessages[error.code], requestId: context.get("requestId") }), error.status);
    return context.json(failure({ code: "WITHDRAWAL_UNAVAILABLE", message: "철회를 확인하지 못했습니다. 제출이 있거나 마감되었거나 발행 정보가 바뀌었을 수 있습니다. 최신 상태를 확인해 주세요.", requestId: context.get("requestId") }), 409);
  }
});
app.all("/api/admin/withdrawn-quizzes", context => {
  context.header("Cache-Control", "private, no-store");
  return context.json(failure({ code: "METHOD_NOT_ALLOWED", message: mutationErrorMessages.METHOD_NOT_ALLOWED, requestId: context.get("requestId") }), 405);
});
app.all("/api/admin/quiz-sets/:id/withdraw-to-review", context => {
  context.header("Cache-Control", "private, no-store");
  return context.json(failure({ code: "METHOD_NOT_ALLOWED", message: mutationErrorMessages.METHOD_NOT_ALLOWED, requestId: context.get("requestId") }), 405);
});

app.post("/api/admin/quiz-sets/:id/publish", async context => {
  context.header("Cache-Control", "private, no-store");
  const requestId = context.get("requestId");
  try {
    const quizSetId = quizSetIdSchema.parse(context.req.param("id"));
    if (new URL(context.req.url).search) throw new Error("invalid query");
    const raw = await readSameOriginJson(context.req.raw);
    const actor = await sha256Bytes(new TextEncoder().encode(context.get("accessIdentity").email));
    return context.json(success(await publishReviewedQuiz(context.env.DB, quizSetId, raw, actor)));
  } catch (error) {
    if (error instanceof MutationRequestError) return context.json(failure({ code: error.code,
      message: mutationErrorMessages[error.code], requestId }), error.status);
    return context.json(failure({ code: "PUBLICATION_UNAVAILABLE",
      message: "현재 검수·배치·저장 상태를 확인하지 못했습니다. 발행 상태를 다시 확인해 주세요.", requestId }), 409);
  }
});

app.all("/api/admin/quiz-sets/:id/publish", context => {
  context.header("Cache-Control", "private, no-store");
  return context.json(failure({ code: "METHOD_NOT_ALLOWED", message: mutationErrorMessages.METHOD_NOT_ALLOWED,
    requestId: context.get("requestId") }), 405);
});

app.get("/api/admin/sermons/:id/generation/:jobId", async (context) => {
  context.header("Cache-Control", "private, no-store");
  const requestId = context.get("requestId");
  try {
    const sermonId = adminSermonIdSchema.safeParse(context.req.param("id"));
    const jobId = adminSermonIdSchema.safeParse(context.req.param("jobId"));
    if (!sermonId.success || !jobId.success || new URL(context.req.url).search) {
      return context.json(failure({ code: "GENERATION_NOT_FOUND", message: "생성 작업을 찾을 수 없습니다.", requestId }), 404);
    }
    const store = createGenerationLifecycleStore(context.env.DB), job = await store.readJob(jobId.data);
    if (job.outcome !== "present" || job.value.sermon_id !== sermonId.data) {
      return context.json(failure({ code: "GENERATION_NOT_FOUND", message: "생성 작업을 찾을 수 없습니다.", requestId }), 404);
    }
    const usage = await context.env.DB.prepare(`SELECT model,input_tokens AS inputTokens,output_tokens AS outputTokens,
      reasoning_tokens AS reasoningTokens,cached_input_tokens AS cachedInputTokens,
      estimated_cost_micro_usd AS estimatedCostMicroUsd,pricing_version AS pricingVersion
      FROM ai_usage_observations WHERE job_id=? ORDER BY observed_at`).bind(jobId.data).all();
    const calls = await context.env.DB.prepare("SELECT count(*) AS n FROM ai_provider_calls WHERE generation_job_id=?")
      .bind(jobId.data).first<{ n: number }>();
    const proof = await store.readOutcome(jobId.data, "correction", 1);
    if (!usage.success || !calls) throw new Error("GENERATION_STATUS_UNAVAILABLE");
    const receipt = await context.env.DB.prepare("SELECT state,lease_expires_at FROM generation_step_receipts WHERE generation_job_id=? AND step_key='correction'")
      .bind(jobId.data).first<{ state: string; lease_expires_at: string | null }>();
    const uncertain = proof.outcome === "present" && proof.value.outcome === "uncertain" ||
      receipt && ["claimed", "effect_started"].includes(receipt.state) && receipt.lease_expires_at !== null && receipt.lease_expires_at <= new Date().toISOString();
    return context.json(success(adminGenerationStatusDataSchema.parse({ jobId: jobId.data, status: uncertain && job.value.status === "running" ? "uncertain" : job.value.status,
      stage: job.value.current_step, proposalId: proof.outcome === "present" && proof.value.outcome === "success" ? proof.value.result?.id ?? null : null,
      usage: usage.results, costStatus: calls.n === 0 ? "not_started" : usage.results.length === calls.n ? "observed" : "unknown" })));
  } catch {
    return context.json(failure({ code: "GENERATION_STATUS_UNAVAILABLE", message: "생성 상태를 불러오지 못했습니다.", requestId }), 503);
  }
});

app.post("/api/admin/sermons/:id/input/public-captions", async context => {
  context.header("Cache-Control", "private, no-store");
  try {
    if (new URL(context.req.url).search) throw new PublicVideoError("VIDEO_INVALID");
    const sermonId = adminSermonIdSchema.safeParse(context.req.param("id"));
    if (!sermonId.success) throw new PublicVideoError("VIDEO_INVALID");
    const body = await readSameOriginJson(context.req.raw);
    const provider = createPublicTranscriptProvider(context.env, fetch);
    return context.json(success(await importPublicSermonCaptions(
      context.env.DB, sermonId.data, body, context.get("accessIdentity").email, provider,
    )));
  } catch (error) { return publicVideoErrorResponse(context, error); }
});
app.all("/api/admin/sermons/:id/input/public-captions", context => {
  context.header("Cache-Control", "private, no-store");
  return context.json(failure({ code: "METHOD_NOT_ALLOWED", message: mutationErrorMessages.METHOD_NOT_ALLOWED, requestId: context.get("requestId") }), 405);
});
app.get("/api/admin/sermons/:id/input", async (context) => {
  context.header("Cache-Control", "private, no-store");
  const requestId = context.get("requestId");
  const sermonId = adminSermonIdSchema.safeParse(context.req.param("id"));
  if (!sermonId.success) {
    return context.json(failure({
      code: "SERMON_NOT_FOUND",
      message: "설교를 찾을 수 없습니다.",
      requestId,
    }), 404);
  }
  if ([...new URL(context.req.url).searchParams.keys()].length > 0) {
    return context.json(failure({
      code: "INVALID_ADMIN_QUERY",
      message: "이 요청에는 검색 조건을 사용할 수 없습니다.",
      requestId,
    }), 400);
  }
  try {
    const result = await createSermonInputService(
      createSermonInputStore(context.env.DB),
    ).current(sermonId.data);
    if (result.outcome === "not_found") {
      return context.json(failure({
        code: "SERMON_NOT_FOUND",
        message: "설교를 찾을 수 없습니다.",
        requestId,
      }), 404);
    }
    return context.json(success(adminSermonInputDataSchema.parse({ input: result.input })));
  } catch {
    console.error(JSON.stringify({ level: "error", requestId, code: "SERMON_INPUT_READ_FAILED" }));
    return context.json(failure({
      code: "SERMON_INPUT_UNAVAILABLE",
      message: "설교 입력자료를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
      requestId,
    }), 503);
  }
});

app.post("/api/admin/sermons/:id/input", async (context) => {
  context.header("Cache-Control", "private, no-store");
  const requestId = context.get("requestId");
  try {
    const sermonId = adminSermonIdSchema.safeParse(context.req.param("id"));
    if (!sermonId.success) {
      return context.json(failure({
        code: "SERMON_NOT_FOUND",
        message: "설교를 찾을 수 없습니다.",
        requestId,
      }), 404);
    }
    if ([...new URL(context.req.url).searchParams.keys()].length > 0) {
      return context.json(failure({
        code: "INVALID_ADMIN_QUERY",
        message: "이 요청에는 검색 조건을 사용할 수 없습니다.",
        requestId,
      }), 400);
    }
    const body = await readSameOriginJson(
      context.req.raw,
      MAX_ADMIN_SERMON_INPUT_JSON_BYTES,
    );
    const parsed = adminSermonInputImportRequestSchema.safeParse(body);
    if (!parsed.success) {
      return context.json(failure({
        code: "INVALID_SERMON_INPUT_REQUEST",
        message: "저장할 설교 입력자료를 확인해 주세요.",
        requestId,
      }), 400);
    }
    const store = createSermonInputStore(context.env.DB);
    if (!await store.sermonExists(sermonId.data)) {
      return context.json(failure({
        code: "SERMON_NOT_FOUND",
        message: "설교를 찾을 수 없습니다.",
        requestId,
      }), 404);
    }
    const { expectedVersion, ...manualInput } = parsed.data;
    const prepared = await prepareManualTranscriptSource(manualInput);
    if (prepared.outcome === "failed") {
      return context.json(failure({
        code: prepared.code,
        message: prepared.message,
        requestId,
      }), 422);
    }
    const identity = context.get("accessIdentity");
    const result = await createSermonInputService(store).importPreparedManual(
      sermonId.data,
      expectedVersion,
      prepared.source,
      {
        kind: "human",
        adminId: await sha256Bytes(new TextEncoder().encode(identity.email)),
        now: new Date().toISOString(),
      },
    );
    if (result.outcome === "failed") {
      const status = result.code === "INPUT_CONFLICT" ? 409
        : result.code === "INPUT_SAVE_UNCERTAIN" ? 503
          : result.code === "INPUT_TOO_LARGE" ? 422
            : 400;
      return context.json(failure({
        code: result.code,
        message: result.message,
        requestId,
      }), status);
    }
    // D-031: normal success uses the already validated request and returned
    // metadata. It does not read the stored body back from D1.
    return context.json(success(adminSermonInputDataSchema.parse({
      input: {
        version: result.head.version,
        sourceType: result.head.source_type,
        sourceId: result.head.source_id,
        documentId: result.head.document_id,
        documentSha256: result.head.document_sha256,
        confirmationId: result.head.confirmation_id,
        source: {
          sourceMode: prepared.source.sourceMode,
          manualSourceKind: prepared.source.manualSourceKind,
          sourceCoverage: prepared.source.sourceCoverage,
        },
        content: {
          format: "plain_text",
          text: prepared.source.rawTranscriptText,
        },
      },
    })));
  } catch (error) {
    if (error instanceof MutationRequestError) {
      return context.json(failure({
        code: error.code,
        message: mutationErrorMessages[error.code],
        requestId,
      }), error.status);
    }
    console.error(JSON.stringify({ level: "error", requestId, code: "SERMON_INPUT_SAVE_FAILED" }));
    return context.json(failure({
      code: "SERMON_INPUT_UNAVAILABLE",
      message: "설교 입력자료를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      requestId,
    }), 503);
  }
});

app.patch("/api/admin/sermons/:id/input", async (context) => {
  context.header("Cache-Control", "private, no-store");
  const requestId = context.get("requestId");
  try {
    const sermonId = adminSermonIdSchema.safeParse(context.req.param("id"));
    if (!sermonId.success) {
      return context.json(failure({
        code: "SERMON_NOT_FOUND",
        message: "설교를 찾을 수 없습니다.",
        requestId,
      }), 404);
    }
    if ([...new URL(context.req.url).searchParams.keys()].length > 0) {
      return context.json(failure({
        code: "INVALID_ADMIN_QUERY",
        message: "이 요청에는 검색 조건을 사용할 수 없습니다.",
        requestId,
      }), 400);
    }
    const body = await readSameOriginJson(
      context.req.raw,
      MAX_ADMIN_SERMON_INPUT_JSON_BYTES,
    );
    const parsed = adminSermonInputCommandRequestSchema.safeParse(body);
    if (!parsed.success) {
      return context.json(failure({
        code: "INVALID_SERMON_INPUT_COMMAND",
        message: "설교 입력자료 변경 요청을 확인해 주세요.",
        requestId,
      }), 400);
    }
    const store = createSermonInputStore(context.env.DB);
    if (!await store.sermonExists(sermonId.data)) {
      return context.json(failure({
        code: "SERMON_NOT_FOUND",
        message: "설교를 찾을 수 없습니다.",
        requestId,
      }), 404);
    }
    const identity = context.get("accessIdentity");
    const result = await createSermonInputService(store).execute(
      sermonId.data,
      parsed.data,
      {
        kind: "human",
        adminId: await sha256Bytes(new TextEncoder().encode(identity.email)),
        now: new Date().toISOString(),
      },
    );
    if (result.outcome === "failed") {
      const status = result.code === "INPUT_CONFLICT" || result.code === "INPUT_READ_ONLY" ? 409
        : result.code === "INPUT_SAVE_UNCERTAIN" ? 503
          : result.code === "INPUT_TOO_LARGE" ? 422
            : 400;
      return context.json(failure({
        code: result.code,
        message: result.message,
        requestId,
      }), status);
    }
    // D-031: command success returns only the new selected head. The client
    // may explicitly GET current content; this path never rereads a body.
    return context.json(success(adminSermonInputMutationDataSchema.parse({
      head: {
        eventId: result.head.id,
        version: result.head.version,
        sourceType: result.head.source_type,
        sourceId: result.head.source_id,
        documentId: result.head.document_id,
        documentSha256: result.head.document_sha256,
        confirmationId: result.head.confirmation_id,
      },
    })));
  } catch (error) {
    if (error instanceof MutationRequestError) {
      return context.json(failure({
        code: error.code,
        message: mutationErrorMessages[error.code],
        requestId,
      }), error.status);
    }
    console.error(JSON.stringify({ level: "error", requestId, code: "SERMON_INPUT_COMMAND_FAILED" }));
    return context.json(failure({
      code: "SERMON_INPUT_UNAVAILABLE",
      message: "설교 입력자료를 변경하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      requestId,
    }), 503);
  }
});

app.get("/api/admin/sermons/:id/input/history", async (context) => {
  context.header("Cache-Control", "private, no-store");
  const requestId = context.get("requestId");
  const sermonId = adminSermonIdSchema.safeParse(context.req.param("id"));
  if (!sermonId.success) {
    return context.json(failure({
      code: "SERMON_NOT_FOUND",
      message: "설교를 찾을 수 없습니다.",
      requestId,
    }), 404);
  }
  if ([...new URL(context.req.url).searchParams.keys()].length > 0) {
    return context.json(failure({
      code: "INVALID_ADMIN_QUERY",
      message: "이 요청에는 검색 조건을 사용할 수 없습니다.",
      requestId,
    }), 400);
  }
  try {
    const result = await createSermonInputService(
      createSermonInputStore(context.env.DB),
    ).history(sermonId.data);
    if (result.outcome === "not_found") {
      return context.json(failure({
        code: "SERMON_NOT_FOUND",
        message: "설교를 찾을 수 없습니다.",
        requestId,
      }), 404);
    }
    return context.json(success(adminSermonInputHistoryDataSchema.parse({
      history: result.history,
    })));
  } catch {
    console.error(JSON.stringify({ level: "error", requestId, code: "SERMON_INPUT_HISTORY_READ_FAILED" }));
    return context.json(failure({
      code: "SERMON_INPUT_HISTORY_UNAVAILABLE",
      message: "설교 입력자료 이력을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
      requestId,
    }), 503);
  }
});

app.all("/api/admin/sermons/:id/input/history", (context) => {
  context.header("Cache-Control", "private, no-store");
  return context.json(failure({
    code: "METHOD_NOT_ALLOWED",
    message: mutationErrorMessages.METHOD_NOT_ALLOWED,
    requestId: context.get("requestId"),
  }), 405);
});

app.get("/api/admin/sermons/:id/input/comparison", async (context) => {
  context.header("Cache-Control", "private, no-store");
  const requestId = context.get("requestId");
  const sermonId = adminSermonIdSchema.safeParse(context.req.param("id"));
  if (!sermonId.success) {
    return context.json(failure({
      code: "SERMON_NOT_FOUND",
      message: "설교를 찾을 수 없습니다.",
      requestId,
    }), 404);
  }
  const entries = [...new URL(context.req.url).searchParams.entries()];
  const query = entries.length === 3
    ? adminSermonInputComparisonQuerySchema.safeParse(Object.fromEntries(entries))
    : { success: false } as const;
  if (!query.success) {
    return context.json(failure({
      code: "INVALID_ADMIN_QUERY",
      message: "비교할 두 입력자료를 다시 선택해 주세요.",
      requestId,
    }), 400);
  }
  try {
    const result = await createSermonInputService(
      createSermonInputStore(context.env.DB),
    ).comparison(
      sermonId.data,
      query.data.sourceId,
      query.data.leftDocumentId,
      query.data.rightDocumentId,
    );
    if (result.outcome !== "loaded") {
      return context.json(failure({
        code: "SERMON_INPUT_SELECTION_NOT_FOUND",
        message: "선택한 설교 입력자료를 찾을 수 없습니다.",
        requestId,
      }), 404);
    }
    return context.json(success(adminSermonInputComparisonDataSchema.parse({
      comparison: result.comparison,
    })));
  } catch {
    console.error(JSON.stringify({ level: "error", requestId, code: "SERMON_INPUT_COMPARISON_READ_FAILED" }));
    return context.json(failure({
      code: "SERMON_INPUT_COMPARISON_UNAVAILABLE",
      message: "선택한 설교 입력자료를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
      requestId,
    }), 503);
  }
});

app.all("/api/admin/sermons/:id/input/comparison", (context) => {
  context.header("Cache-Control", "private, no-store");
  return context.json(failure({
    code: "METHOD_NOT_ALLOWED",
    message: mutationErrorMessages.METHOD_NOT_ALLOWED,
    requestId: context.get("requestId"),
  }), 405);
});

app.get("/api/admin/sermons/:id/input/corrections/:proposalId", async (context) => {
  context.header("Cache-Control", "private, no-store");
  const requestId = context.get("requestId");
  const sermonId = adminSermonIdSchema.safeParse(context.req.param("id"));
  const proposalId = adminSermonIdSchema.safeParse(context.req.param("proposalId"));
  if (!sermonId.success || !proposalId.success) {
    return context.json(failure({
      code: "SERMON_INPUT_SELECTION_NOT_FOUND",
      message: "선택한 교정 제안을 찾을 수 없습니다.",
      requestId,
    }), 404);
  }
  if ([...new URL(context.req.url).searchParams.keys()].length > 0) {
    return context.json(failure({
      code: "INVALID_ADMIN_QUERY",
      message: "이 요청에는 검색 조건을 사용할 수 없습니다.",
      requestId,
    }), 400);
  }
  try {
    const result = await createSermonInputService(
      createSermonInputStore(context.env.DB),
    ).correctionDetail(sermonId.data, proposalId.data);
    if (result.outcome !== "loaded") {
      return context.json(failure({
        code: "SERMON_INPUT_SELECTION_NOT_FOUND",
        message: "선택한 교정 제안을 찾을 수 없습니다.",
        requestId,
      }), 404);
    }
    return context.json(success(adminSermonInputCorrectionDataSchema.parse({
      correction: result.correction,
    })));
  } catch {
    console.error(JSON.stringify({ level: "error", requestId, code: "SERMON_INPUT_CORRECTION_READ_FAILED" }));
    return context.json(failure({
      code: "SERMON_INPUT_CORRECTION_UNAVAILABLE",
      message: "선택한 교정 제안을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
      requestId,
    }), 503);
  }
});

app.all("/api/admin/sermons/:id/input/corrections/:proposalId", (context) => {
  context.header("Cache-Control", "private, no-store");
  return context.json(failure({
    code: "METHOD_NOT_ALLOWED",
    message: mutationErrorMessages.METHOD_NOT_ALLOWED,
    requestId: context.get("requestId"),
  }), 405);
});

app.all("/api/admin/sermons/:id/input", (context) => {
  context.header("Cache-Control", "private, no-store");
  return context.json(failure({
    code: "METHOD_NOT_ALLOWED",
    message: mutationErrorMessages.METHOD_NOT_ALLOWED,
    requestId: context.get("requestId"),
  }), 405);
});

app.patch("/api/admin/submissions/:id", async (context) => {
  context.header("Cache-Control", "private, no-store");
  const requestId = context.get("requestId");
  try {
    const submissionId = adminSubmissionIdSchema.safeParse(context.req.param("id"));
    if (!submissionId.success) throw new SubmissionModerationNotFound();
    if ([...new URL(context.req.url).searchParams.keys()].length > 0) {
      return context.json(failure({
        code: "INVALID_ADMIN_QUERY",
        message: "이 요청에는 검색 조건을 사용할 수 없습니다.",
        requestId,
      }), 400);
    }
    const body = await readSameOriginJson(context.req.raw);
    const parsed = moderateSubmissionRequestSchema.safeParse(body);
    if (!parsed.success) {
      return context.json(failure({
        code: "INVALID_SUBMISSION_MODERATION_REQUEST",
        message: "숨김 또는 숨김 해제 요청을 다시 확인해 주세요.",
        requestId,
      }), 400);
    }
    return context.json(success(await runSubmissionModeration(
      context,
      parsed.data.action,
      parsed.data.reason,
      submissionId.data,
    )));
  } catch (error) {
    return adminSubmissionModerationFailure(context, error);
  }
});

app.delete("/api/admin/submissions/:id", async (context) => {
  context.header("Cache-Control", "private, no-store");
  const requestId = context.get("requestId");
  try {
    const submissionId = adminSubmissionIdSchema.safeParse(context.req.param("id"));
    if (!submissionId.success) throw new SubmissionModerationNotFound();
    if ([...new URL(context.req.url).searchParams.keys()].length > 0) {
      return context.json(failure({
        code: "INVALID_ADMIN_QUERY",
        message: "이 요청에는 검색 조건을 사용할 수 없습니다.",
        requestId,
      }), 400);
    }
    const body = await readSameOriginJson(context.req.raw);
    const parsed = deleteSubmissionAsAdminRequestSchema.safeParse(body);
    if (!parsed.success) {
      return context.json(failure({
        code: "INVALID_SUBMISSION_DELETE_REQUEST",
        message: "관리자 삭제 요청을 다시 확인해 주세요.",
        requestId,
      }), 400);
    }
    return context.json(success(await runSubmissionModeration(
      context,
      "delete",
      parsed.data.reason,
      submissionId.data,
    )));
  } catch (error) {
    return adminSubmissionModerationFailure(context, error);
  }
});

app.all("/api/admin/submissions/:id", (context) => {
  context.header("Cache-Control", "private, no-store");
  return context.json(failure({
    code: "METHOD_NOT_ALLOWED",
    message: mutationErrorMessages.METHOD_NOT_ALLOWED,
    requestId: context.get("requestId"),
  }), 405);
});

app.on(["GET", "POST", "PATCH"], "/api/admin/quiz-sets/:id/closes-at", async context => {
  context.header("Cache-Control", "private, no-store");
  try {
    if (new URL(context.req.url).search) throw new Error("invalid query");
    const id = quizSetIdSchema.parse(context.req.param("id"));
    if (context.req.method === "GET") return context.json(success(await readQuizDeadline(context.env.DB, id)));
    const body = await readSameOriginJson(context.req.raw);
    const actor = context.get("accessIdentity").email;
    return context.json(success(await (context.req.method === "POST" ? previewQuizDeadline : changeQuizDeadline)(
      context.env.DB, id, body, actor, context.env.SESSION_PEPPER)));
  } catch (error) {
    if (error instanceof MutationRequestError) return context.json(failure({ code: error.code, message: mutationErrorMessages[error.code], requestId: context.get("requestId") }), error.status);
    return context.json(failure({ code: "DEADLINE_UNAVAILABLE", message: "마감 변경을 확인하지 못했습니다. 제출 수나 접수 상태가 바뀌었거나 마감에 도달했을 수 있습니다. 최신 마감과 변경 영향을 다시 확인해 주세요.", requestId: context.get("requestId") }), 409);
  }
});
app.all("/api/admin/quiz-sets/:id/closes-at", context => {
  context.header("Cache-Control", "private, no-store");
  return context.json(failure({ code: "METHOD_NOT_ALLOWED", message: mutationErrorMessages.METHOD_NOT_ALLOWED, requestId: context.get("requestId") }), 405);
});

app.post("/api/admin/quiz-sets/:id/close-now", async (context) => {
  context.header("Cache-Control", "private, no-store");
  const requestId = context.get("requestId");

  try {
    const identity = context.get("accessIdentity");
    const body = await readSameOriginJson(context.req.raw);
    const quizSetId = quizSetIdSchema.safeParse(context.req.param("id"));
    const query = new URL(context.req.url).searchParams;
    if (!quizSetId.success) {
      return context.json(failure({
        code: "QUIZ_SET_NOT_FOUND",
        message: "마감할 퀴즈를 찾을 수 없습니다.",
        requestId,
      }), 404);
    }
    if ([...query.keys()].length > 0) {
      return context.json(failure({
        code: "INVALID_ADMIN_QUERY",
        message: "이 요청에는 검색 조건을 사용할 수 없습니다.",
        requestId,
      }), 400);
    }
    const parsed = closeQuizSetNowRequestSchema.safeParse(body);
    if (!parsed.success) {
      return context.json(failure({
        code: "INVALID_CLOSE_NOW_REQUEST",
        message: "즉시 마감 요청을 다시 확인해 주세요.",
        requestId,
      }), 400);
    }

    const result = await createQuizFinalizationService(createDatabase(context.env.DB))
      .closeQuizSetNow(quizSetId.data, {
        actorEmail: identity.email,
        auditId: crypto.randomUUID(),
        reason: parsed.data.reason,
      });
    return context.json(success(closeQuizSetNowDataSchema.parse({
      archivedAt: result.archivedAt,
      outcome: result.outcome,
      quizSetId: result.quizSetId,
      snapshots: result.snapshots.map((snapshot) => ({
        quizVariantId: snapshot.quizVariantId,
        winnerCount: snapshot.winnerCount,
        winnerSubmissionCount: snapshot.winnerSubmissionIds.length,
      })),
    })));
  } catch (error) {
    if (error instanceof MutationRequestError) {
      return context.json(failure({
        code: error.code,
        message: mutationErrorMessages[error.code],
        requestId,
      }), error.status);
    }
    if (error instanceof QuizFinalizationNotFound) {
      return context.json(failure({
        code: "QUIZ_SET_NOT_FOUND",
        message: "마감할 퀴즈를 찾을 수 없습니다.",
        requestId,
      }), 404);
    }
    if (error instanceof QuizFinalizationInvalidState) {
      return context.json(failure({
        code: "QUIZ_SET_NOT_PUBLISHED",
        message: "진행 중인 퀴즈만 즉시 마감할 수 있습니다.",
        requestId,
      }), 409);
    }
    console.error(JSON.stringify({ level: "error", requestId, code: "QUIZ_CLOSE_NOW_FAILED" }));
    return context.json(failure({
      code: "QUIZ_CLOSE_NOW_UNAVAILABLE",
      message: "퀴즈를 마감하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      requestId,
    }), 503);
  }
});

app.all("/api/admin/quiz-sets/:id/close-now", (context) => {
  context.header("Cache-Control", "private, no-store");
  return context.json(failure({
    code: "METHOD_NOT_ALLOWED",
    message: mutationErrorMessages.METHOD_NOT_ALLOWED,
    requestId: context.get("requestId"),
  }), 405);
});

app.post("/api/session", async (context) => {
  context.header("Cache-Control", "private, no-store");
  const requestId = context.get("requestId");

  try {
    const body = await readSameOriginJson(context.req.raw);
    if (!sessionRequestSchema.safeParse(body).success) {
      return context.json(failure({
        code: "INVALID_SESSION_REQUEST",
        message: "세션 요청 형식을 확인해 주세요.",
        requestId,
      }), 400);
    }

    const repository = createSubmissionRepository(createDatabase(context.env.DB));
    const limited = await publicRateResponse(context, "session", context.env.PUBLIC_RATE_LIMIT_ENABLED === "true" ? await activeRateActor(context) : undefined);
    if (limited) return limited;
    const session = await createSessionService(repository, context.env.SESSION_PEPPER)
      .establish(getCookie(context, SESSION_COOKIE_BASENAME, "host"));

    if (session.tokenToSet !== null) {
      context.header("Set-Cookie", serializeSessionCookie(session.tokenToSet, session.expiresAt), { append: true });
    }

    return context.json(success(sessionDataSchema.parse({ expiresAt: session.expiresAt })));
  } catch (error) {
    if (error instanceof MutationRequestError) {
      return context.json(failure({
        code: error.code,
        message: mutationErrorMessages[error.code],
        requestId,
      }), error.status);
    }

    const code = error instanceof SessionConfigurationError
      ? "SESSION_CONFIGURATION_ERROR"
      : "SESSION_CREATE_FAILED";
    console.error(JSON.stringify({ level: "error", requestId, code }));
    return context.json(failure({
      code: "SESSION_UNAVAILABLE",
      message: "세션을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      requestId,
    }), 503);
  }
});

app.get("/api/quizzes/:slug/:difficulty/problem-history",async context=>{
 context.header("Cache-Control","private, no-store");
 try {
  const slug=quizSlugSchema.parse(context.req.param("slug")),level=difficultySchema.parse(context.req.param("difficulty"));
  if(new URL(context.req.url).search) throw new Error();
  const token=getCookie(context,SESSION_COOKIE_BASENAME,"host");
  if(!isSessionToken(token)) return context.json(success({items:[]}));
  return context.json(success(await readProblemHistory(context.env.DB,slug,level,await hashSessionToken(token,context.env.SESSION_PEPPER),new Date().toISOString())));
 } catch {return context.json(failure({code:"HISTORY_UNAVAILABLE",message:"당시 제출 기록을 확인하지 못했습니다. 다시 시도해 주세요.",requestId:context.get("requestId")}),503);}
});
app.delete("/api/quizzes/:slug/:difficulty/problem-history/:variantId",async context=>{
 context.header("Cache-Control","private, no-store");
 try {
  submissionDeletionRequestSchema.parse(await readSameOriginJson(context.req.raw));
  if(new URL(context.req.url).search) throw new Error();
  const slug=quizSlugSchema.parse(context.req.param("slug")),level=difficultySchema.parse(context.req.param("difficulty")),variantId=quizSetIdSchema.parse(context.req.param("variantId"));
  const token=getCookie(context,SESSION_COOKIE_BASENAME,"host");if(!isSessionToken(token)) throw new Error();
  const sessionHash=await hashSessionToken(token,context.env.SESSION_PEPPER),now=new Date().toISOString();
  const history=await readProblemHistory(context.env.DB,slug,level,sessionHash,now),own=history.items.find(v=>v.submission.quizVariantId===variantId)?.submission;
  if(!own) throw new Error();
  if(own.status!=="deleted") {const limited=await publicRateResponse(context,`delete/${variantId}`,sessionHash);if(limited) return limited;}
  const result=await createSubmissionRepository(createDatabase(context.env.DB)).deleteOwnSubmission(variantId,own.quizRevision,sessionHash,now,crypto.randomUUID());
  if(result.outcome==="not_found") throw new Error();
  return context.json(success(submissionDeletionData(result.submission)));
 } catch(error) {
  if(error instanceof MutationRequestError) return context.json(failure({code:error.code,message:mutationErrorMessages[error.code],requestId:context.get("requestId")}),error.status);
  return context.json(failure({code:"HISTORY_DELETE_UNAVAILABLE",message:"본인 제출 삭제 상태를 확인하지 못했습니다.",requestId:context.get("requestId")}),409);
 }
});
for (const path of ["/api/quizzes/:slug/:difficulty/problem-history","/api/quizzes/:slug/:difficulty/problem-history/:variantId"]) app.all(path,context=>{
 context.header("Cache-Control","private, no-store");return context.json(failure({code:"METHOD_NOT_ALLOWED",message:mutationErrorMessages.METHOD_NOT_ALLOWED,requestId:context.get("requestId")}),405);
});

app.get("/api/quizzes/:slug/:difficulty/me", async (context) => {
  context.header("Cache-Control", "private, no-store");
  const requestId = context.get("requestId");
  const slug = quizSlugSchema.safeParse(context.req.param("slug"));
  const difficulty = difficultySchema.safeParse(context.req.param("difficulty"));
  const query = new URL(context.req.url).searchParams;

  if (!slug.success || !difficulty.success) {
    return context.json(failure({
      code: "QUIZ_NOT_FOUND",
      message: "요청한 퀴즈를 찾을 수 없습니다.",
      requestId,
    }), 404);
  }
  if ([...query.keys()].length > 0) {
    return context.json(failure({
      code: "INVALID_QUIZ_QUERY",
      message: "이 요청에는 검색 조건을 사용할 수 없습니다.",
      requestId,
    }), 400);
  }

  try {
    const database = createDatabase(context.env.DB);
    const now = new Date();
    const quiz = (await createPublicQuizAccessService(database).read(
      { slug: slug.data },
      difficulty.data,
      now,
    )).quiz;
    if (quiz === null) {
      return context.json(failure({
        code: "QUIZ_NOT_FOUND",
        message: "요청한 퀴즈를 찾을 수 없습니다.",
        requestId,
      }), 404);
    }

    const token = getCookie(context, SESSION_COOKIE_BASENAME, "host");
    if (!isSessionToken(token)) {
      return context.json(success(ownSubmissionData(undefined)));
    }

    const repository = createSubmissionRepository(database);
    const nowIso = now.toISOString();
    const sessionHash = await hashSessionToken(token, context.env.SESSION_PEPPER);
    if (await repository.findActiveSession(sessionHash, nowIso) === undefined) {
      return context.json(success(ownSubmissionData(undefined)));
    }

    const submission = await repository.findSubmission(quiz.variant.id, sessionHash);
    if (submission === undefined) {
      return context.json(success(ownSubmissionData(undefined)));
    }
    if (submission.quizRevision !== quiz.variant.revision) {
      throw new Error("Stored submission revision mismatch");
    }
    if (submission.status === "deleted") {
      return context.json(success(ownSubmissionData(submission)));
    }

    const solution = await repository.findScoringSolution(quiz.variant.id);
    if (solution === undefined) throw new Error("Missing scoring solution");
    const restoredScore = scoreSubmission({
      canonicalCellOrder: solution.canonicalCellOrder,
      grid: quiz.variant.grid,
      solution: solution.solution,
    }, submission.answers);
    if (!storedScoreMatches(submission, restoredScore)) {
      throw new Error("Stored submission score mismatch");
    }
    return context.json(success(ownSubmissionData(submission, solution)));
  } catch (error) {
    if (error instanceof PublicQuizUnavailable) {
      return context.json(failure({
        code: "QUIZ_NOT_FOUND",
        message: "요청한 난이도의 퀴즈를 찾을 수 없습니다.",
        requestId,
      }), 404);
    }
    const code = error instanceof SessionConfigurationError
      ? "SUBMISSION_SESSION_FAILED"
      : "OWN_SUBMISSION_LOOKUP_FAILED";
    console.error(JSON.stringify({ level: "error", requestId, code }));
    return context.json(failure({
      code: "SUBMISSION_LOOKUP_UNAVAILABLE",
      message: "기존 제출 결과를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      requestId,
    }), 503);
  }
});

app.delete("/api/quizzes/:slug/:difficulty/me/submission", async (context) => {
  context.header("Cache-Control", "private, no-store");
  const requestId = context.get("requestId");

  try {
    const body = await readSameOriginJson(context.req.raw);
    const slug = quizSlugSchema.safeParse(context.req.param("slug"));
    const difficulty = difficultySchema.safeParse(context.req.param("difficulty"));
    const query = new URL(context.req.url).searchParams;
    if (!slug.success || !difficulty.success) {
      return context.json(failure({
        code: "QUIZ_NOT_FOUND",
        message: "요청한 퀴즈를 찾을 수 없습니다.",
        requestId,
      }), 404);
    }
    if ([...query.keys()].length > 0) {
      return context.json(failure({
        code: "INVALID_QUIZ_QUERY",
        message: "이 요청에는 검색 조건을 사용할 수 없습니다.",
        requestId,
      }), 400);
    }
    if (!submissionDeletionRequestSchema.safeParse(body).success) {
      return context.json(failure({
        code: "INVALID_SUBMISSION_DELETION_REQUEST",
        message: "삭제 요청 형식을 확인해 주세요.",
        requestId,
      }), 400);
    }

    const token = getCookie(context, SESSION_COOKIE_BASENAME, "host");
    if (!isSessionToken(token)) {
      return context.json(failure({
        code: "SESSION_REQUIRED",
        message: "제출한 브라우저에서 다시 시도해 주세요.",
        requestId,
      }), 401);
    }

    const database = createDatabase(context.env.DB);
    const now = new Date();
    const quiz = (await createPublicQuizAccessService(database).read(
      { slug: slug.data },
      difficulty.data,
      now,
    )).quiz;
    if (quiz === null) {
      return context.json(failure({
        code: "QUIZ_NOT_FOUND",
        message: "요청한 퀴즈를 찾을 수 없습니다.",
        requestId,
      }), 404);
    }

    const repository = createSubmissionRepository(database);
    const sessionHash = await hashSessionToken(token, context.env.SESSION_PEPPER);
    if (context.env.PUBLIC_RATE_LIMIT_ENABLED === "true") {
      if (await repository.findActiveSession(sessionHash,now.toISOString()) !== undefined) {
        const existing = await repository.findSubmission(quiz.variant.id,sessionHash);
        if (existing?.status !== "deleted") { const limited = await publicRateResponse(context, `delete/${quiz.variant.id}`,sessionHash); if(limited) return limited; }
      }
    }
    const deletion = await repository.deleteOwnSubmission(
      quiz.variant.id,
      quiz.variant.revision,
      sessionHash,
      now.toISOString(),
      crypto.randomUUID(),
    );
    if (deletion.outcome === "not_found") {
      return context.json(failure({
        code: "SUBMISSION_NOT_FOUND",
        message: "삭제할 본인 제출을 찾을 수 없습니다.",
        requestId,
      }), 404);
    }
    return context.json(success(submissionDeletionData(deletion.submission)));
  } catch (error) {
    if (error instanceof MutationRequestError) {
      return context.json(failure({
        code: error.code,
        message: mutationErrorMessages[error.code],
        requestId,
      }), error.status);
    }
    if (error instanceof PublicQuizUnavailable) {
      return context.json(failure({
        code: "QUIZ_NOT_FOUND",
        message: "요청한 난이도의 퀴즈를 찾을 수 없습니다.",
        requestId,
      }), 404);
    }
    if (error instanceof SubmissionSessionUnavailable) {
      return context.json(failure({
        code: "SESSION_REQUIRED",
        message: "제출 세션이 만료되었습니다. 제출한 브라우저에서 다시 시도해 주세요.",
        requestId,
      }), 401);
    }
    const code = error instanceof SessionConfigurationError
      ? "SUBMISSION_SESSION_FAILED"
      : "SUBMISSION_DELETION_FAILED";
    console.error(JSON.stringify({ level: "error", requestId, code }));
    return context.json(failure({
      code: "SUBMISSION_DELETION_UNAVAILABLE",
      message: "제출을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      requestId,
    }), 503);
  }
});

app.all("/api/quizzes/:slug/:difficulty/me/submission", (context) => {
  context.header("Cache-Control", "private, no-store");
  return context.json(failure({
    code: "METHOD_NOT_ALLOWED",
    message: mutationErrorMessages.METHOD_NOT_ALLOWED,
    requestId: context.get("requestId"),
  }), 405);
});

app.all("/api/quizzes/:slug/:difficulty/me", (context) => {
  context.header("Cache-Control", "private, no-store");
  return context.json(failure({
    code: "METHOD_NOT_ALLOWED",
    message: mutationErrorMessages.METHOD_NOT_ALLOWED,
    requestId: context.get("requestId"),
  }), 405);
});

app.get("/api/quizzes/:slug/:difficulty/solution", async (context) => {
  context.header("Cache-Control", "private, no-store");
  const requestId = context.get("requestId");
  const slug = quizSlugSchema.safeParse(context.req.param("slug"));
  const difficulty = difficultySchema.safeParse(context.req.param("difficulty"));
  const query = new URL(context.req.url).searchParams;

  if (!slug.success || !difficulty.success) {
    return context.json(failure({
      code: "QUIZ_NOT_FOUND",
      message: "요청한 퀴즈를 찾을 수 없습니다.",
      requestId,
    }), 404);
  }
  if ([...query.keys()].length > 0) {
    return context.json(failure({
      code: "INVALID_QUIZ_QUERY",
      message: "이 요청에는 검색 조건을 사용할 수 없습니다.",
      requestId,
    }), 400);
  }

  try {
    const database = createDatabase(context.env.DB);
    const now = new Date();
    const quiz = (await createPublicQuizAccessService(database).read(
      { slug: slug.data },
      difficulty.data,
      now,
    )).quiz;
    if (quiz === null) {
      return context.json(failure({
        code: "QUIZ_NOT_FOUND",
        message: "요청한 퀴즈를 찾을 수 없습니다.",
        requestId,
      }), 404);
    }

    const repository = createSubmissionRepository(database);
    if (quiz.status === "published") {
      const token = getCookie(context, SESSION_COOKIE_BASENAME, "host");
      if (!isSessionToken(token)) {
        return context.json(failure({
          code: "SUBMISSION_REQUIRED",
          message: "답안을 제출한 후 정답을 볼 수 있습니다.",
          requestId,
        }), 403);
      }
      const sessionHash = await hashSessionToken(token, context.env.SESSION_PEPPER);
      if (await repository.findActiveSession(sessionHash, now.toISOString()) === undefined) {
        return context.json(failure({
          code: "SUBMISSION_REQUIRED",
          message: "답안을 제출한 후 정답을 볼 수 있습니다.",
          requestId,
        }), 403);
      }
      const ownSubmission = await repository.findSubmission(quiz.variant.id, sessionHash);
      if (ownSubmission === undefined || ownSubmission.status === "deleted") {
        return context.json(failure({
          code: "SUBMISSION_REQUIRED",
          message: "답안을 제출한 후 정답을 볼 수 있습니다.",
          requestId,
        }), 403);
      }
      if (ownSubmission.quizRevision !== quiz.variant.revision) {
        throw new Error("Stored submission revision mismatch");
      }
    }

    const scoringSolution = await repository.findScoringSolution(quiz.variant.id);
    if (scoringSolution === undefined) throw new Error("Missing scoring solution");
    validateScoringSource({
      canonicalCellOrder: scoringSolution.canonicalCellOrder,
      grid: quiz.variant.grid,
      solution: scoringSolution.solution,
    });
    const data = quizSolutionDataSchema.parse({
      quizVariantId: quiz.variant.id,
      quizRevision: quiz.variant.revision,
      solution: scoringSolution.solution,
    });
    return context.json(success(data));
  } catch (error) {
    if (error instanceof PublicQuizUnavailable) {
      return context.json(failure({
        code: "QUIZ_NOT_FOUND",
        message: "요청한 난이도의 퀴즈를 찾을 수 없습니다.",
        requestId,
      }), 404);
    }
    const code = error instanceof SessionConfigurationError
      ? "SOLUTION_SESSION_FAILED"
      : "SOLUTION_READ_FAILED";
    console.error(JSON.stringify({ level: "error", requestId, code }));
    return context.json(failure({
      code: "SOLUTION_UNAVAILABLE",
      message: "정답을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
      requestId,
    }), 503);
  }
});

app.all("/api/quizzes/:slug/:difficulty/solution", (context) => {
  context.header("Cache-Control", "private, no-store");
  return context.json(failure({
    code: "METHOD_NOT_ALLOWED",
    message: mutationErrorMessages.METHOD_NOT_ALLOWED,
    requestId: context.get("requestId"),
  }), 405);
});

app.post("/api/quizzes/:slug/:difficulty/practice/check", async (context) => {
  context.header("Cache-Control", "private, no-store");
  const requestId = context.get("requestId");
  const slug = quizSlugSchema.safeParse(context.req.param("slug"));
  const difficulty = difficultySchema.safeParse(context.req.param("difficulty"));
  const query = new URL(context.req.url).searchParams;

  if (!slug.success || !difficulty.success) {
    return context.json(failure({
      code: "QUIZ_NOT_FOUND",
      message: "요청한 퀴즈를 찾을 수 없습니다.",
      requestId,
    }), 404);
  }
  if ([...query.keys()].length > 0) {
    return context.json(failure({
      code: "INVALID_QUIZ_QUERY",
      message: "이 요청에는 검색 조건을 사용할 수 없습니다.",
      requestId,
    }), 400);
  }

  try {
    const body = await readSameOriginJson(context.req.raw);
    const rawCellError = classifyRawCells(body);
    if (rawCellError !== undefined) {
      return context.json(failure({
        code: rawCellError,
        field: "cells",
        message: submissionValidationMessages[rawCellError],
        requestId,
      }), 422);
    }
    const parsed = practiceCheckRequestSchema.safeParse(body);
    if (!parsed.success) {
      return context.json(failure({
        code: "INVALID_PRACTICE_REQUEST",
        message: "채점할 답안 형식을 확인해 주세요.",
        requestId,
      }), 400);
    }

    const database = createDatabase(context.env.DB);
    // Practice must not read participation records or trigger finalization.
    // The public page has already resolved a due set before exposing this action.
    const quiz = (await createPublicQuizRepository(database).read(
      { slug: slug.data },
      difficulty.data,
      new Date(),
      { includeSubmissionCount: false },
    )).quiz;
    if (quiz === null) {
      return context.json(failure({
        code: "QUIZ_NOT_FOUND",
        message: "요청한 퀴즈를 찾을 수 없습니다.",
        requestId,
      }), 404);
    }
    if (quiz.status !== "archived") {
      return context.json(failure({
        code: "PRACTICE_NOT_AVAILABLE",
        message: "마감된 퀴즈에서만 채점하기를 사용할 수 있습니다.",
        requestId,
      }), 409);
    }
    if (parsed.data.revision !== quiz.variant.revision) {
      return context.json(failure({
        code: "REVISION_MISMATCH",
        message: "퀴즈가 변경되었습니다. 화면을 새로고침해 주세요.",
        requestId,
      }), 409);
    }

    const activeCellIds = new Set(quiz.variant.grid.cells.map((cell) => cell.id));
    if (Object.keys(parsed.data.cells).length === 0) {
      return context.json(failure({
        code: "EMPTY_SUBMISSION",
        field: "cells",
        message: submissionValidationMessages.EMPTY_SUBMISSION,
        requestId,
      }), 422);
    }
    if (Object.keys(parsed.data.cells).some((id) => !activeCellIds.has(id))) {
      return context.json(failure({
        code: "INVALID_GRID_SHAPE",
        field: "cells",
        message: submissionValidationMessages.INVALID_GRID_SHAPE,
        requestId,
      }), 422);
    }

    const limited=await publicRateResponse(context,`practice/${quiz.variant.id}`); if(limited) return limited;
    const repository = createSubmissionRepository(database);
    const solution = await repository.findScoringSolution(quiz.variant.id);
    if (solution === undefined) throw new Error("Missing scoring solution");
    const score = scoreSubmission({
      canonicalCellOrder: solution.canonicalCellOrder,
      grid: quiz.variant.grid,
      solution: solution.solution,
    }, parsed.data.cells);
    return context.json(success(practiceCheckDataSchema.parse({
      quizVariantId: quiz.variant.id,
      quizRevision: quiz.variant.revision,
      correctCells: score.correctCells,
      totalCells: score.totalCells,
      correctWords: score.correctWords,
      totalWords: score.totalWords,
      scoreBasisPoints: score.scoreBasisPoints,
      correctnessMask: score.correctnessMask,
      solution: solution.solution,
    })));
  } catch (error) {
    if (error instanceof MutationRequestError) {
      return context.json(failure({
        code: error.code,
        message: mutationErrorMessages[error.code],
        requestId,
      }), error.status);
    }
    if (error instanceof PublicQuizUnavailable) {
      return context.json(failure({
        code: "QUIZ_NOT_FOUND",
        message: "요청한 난이도의 퀴즈를 찾을 수 없습니다.",
        requestId,
      }), 404);
    }
    console.error(JSON.stringify({ level: "error", requestId, code: "PRACTICE_CHECK_FAILED" }));
    return context.json(failure({
      code: "PRACTICE_CHECK_UNAVAILABLE",
      message: "답안을 채점하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      requestId,
    }), 503);
  }
});

app.all("/api/quizzes/:slug/:difficulty/practice/check", (context) => {
  context.header("Cache-Control", "private, no-store");
  return context.json(failure({
    code: "METHOD_NOT_ALLOWED",
    message: mutationErrorMessages.METHOD_NOT_ALLOWED,
    requestId: context.get("requestId"),
  }), 405);
});

app.get("/api/quizzes/:slug/:difficulty/export-data", async (context) => {
  context.header("Cache-Control", "private, no-store");
  const requestId = context.get("requestId");
  const slug = quizSlugSchema.safeParse(context.req.param("slug"));
  const difficulty = difficultySchema.safeParse(context.req.param("difficulty"));
  if (!slug.success || !difficulty.success) return context.json(failure({ code: "QUIZ_NOT_FOUND", message: "퀴즈를 찾을 수 없습니다.", requestId }), 404);
  if (new URL(context.req.url).search) return context.json(failure({ code: "INVALID_QUIZ_QUERY", message: "검색 조건을 사용할 수 없습니다.", requestId }), 400);
  try {
    const quiz = (await createPublicQuizRepository(createDatabase(context.env.DB)).read(
      { slug: slug.data }, difficulty.data, new Date(), { includeSubmissionCount: false },
    )).quiz;
    if (quiz === null) return context.json(failure({ code: "QUIZ_NOT_FOUND", message: "퀴즈를 찾을 수 없습니다.", requestId }), 404);
    return context.json(success(blankExport(quiz)));
  } catch (error) {
    const status = error instanceof PublicQuizUnavailable ? 404 : 503;
    return context.json(failure({ code: "EXPORT_UNAVAILABLE", message: "출력 자료를 불러오지 못했습니다.", requestId }), status);
  }
});
app.all("/api/quizzes/:slug/:difficulty/export-data", context => {
  context.header("Cache-Control", "private, no-store");
  return context.json(failure({ code: "METHOD_NOT_ALLOWED", message: "지원하지 않는 요청입니다.", requestId: context.get("requestId") }), 405);
});

app.on("GET", ["/api/quizzes/:slug/:difficulty/board", "/api/quizzes/:slug/:difficulty/top-n-export"], async (context) => {
  context.header("Cache-Control", "private, no-store");
  const requestId = context.get("requestId");
  const slug = quizSlugSchema.safeParse(context.req.param("slug"));
  const difficulty = difficultySchema.safeParse(context.req.param("difficulty"));
  const query = new URL(context.req.url).searchParams;

  if (!slug.success || !difficulty.success) {
    return context.json(failure({
      code: "QUIZ_NOT_FOUND",
      message: "요청한 퀴즈를 찾을 수 없습니다.",
      requestId,
    }), 404);
  }
  if ([...query.keys()].length > 0) {
    return context.json(failure({
      code: "INVALID_QUIZ_QUERY",
      message: "이 요청에는 검색 조건을 사용할 수 없습니다.",
      requestId,
    }), 400);
  }

  try {
    const database = createDatabase(context.env.DB);
    const now = new Date();
    const quiz = (await createPublicQuizAccessService(database).read(
      { slug: slug.data },
      difficulty.data,
      now,
    )).quiz;
    if (quiz === null) {
      return context.json(failure({
        code: "QUIZ_NOT_FOUND",
        message: "요청한 퀴즈를 찾을 수 없습니다.",
        requestId,
      }), 404);
    }

    if (context.req.path.endsWith("/top-n-export") && quiz.correction?.nonRanked) {
      return context.json(failure({ code: "QUIZ_NOT_FOUND", message: "정정된 비순위 퀴즈는 벽보 출력 대상이 아닙니다.", requestId }), 404);
    }
    const submissionRepository = createSubmissionRepository(database);
    const token = getCookie(context, SESSION_COOKIE_BASENAME, "host");
    let currentSessionHash: string | undefined;
    if (quiz.status === "published") {
      if (!isSessionToken(token)) {
        return context.json(failure({
          code: "SUBMISSION_REQUIRED",
          message: "답안을 제출한 후 참여 현황을 볼 수 있습니다.",
          requestId,
        }), 403);
      }
      currentSessionHash = await hashSessionToken(token, context.env.SESSION_PEPPER);
      if (await submissionRepository.findActiveSession(currentSessionHash, now.toISOString()) === undefined) {
        return context.json(failure({
          code: "SUBMISSION_REQUIRED",
          message: "답안을 제출한 후 참여 현황을 볼 수 있습니다.",
          requestId,
        }), 403);
      }
      const ownSubmission = await submissionRepository.findSubmission(
        quiz.variant.id,
        currentSessionHash,
      );
      if (ownSubmission === undefined || ownSubmission.status === "deleted") {
        return context.json(failure({
          code: "SUBMISSION_REQUIRED",
          message: "답안을 제출한 후 참여 현황을 볼 수 있습니다.",
          requestId,
        }), 403);
      }
      if (ownSubmission.quizRevision !== quiz.variant.revision) {
        throw new ParticipationBoardUnavailable();
      }
    } else if (isSessionToken(token)) {
      try {
        const candidate = await hashSessionToken(token, context.env.SESSION_PEPPER);
        if (await submissionRepository.findActiveSession(candidate, now.toISOString()) !== undefined) {
          currentSessionHash = candidate;
        }
      } catch (error) {
        if (!(error instanceof SessionConfigurationError)) throw error;
        // Archived boards are public. Missing optional session configuration
        // only removes the convenience "mine" marker; it must not block read.
      }
    }

    const scoringSolution = await submissionRepository.findScoringSolution(quiz.variant.id);
    const board = await createParticipationBoardRepository(database).read({
      ...(currentSessionHash === undefined ? {} : { currentSessionHash }),
      grid: quiz.variant.grid,
      quizRevision: quiz.variant.revision,
      quizStatus: quiz.status,
      quizVariantId: quiz.variant.id,
      ...(scoringSolution === undefined ? {} : {
        scoringSource: {
          canonicalCellOrder: scoringSolution.canonicalCellOrder,
          solution: scoringSolution.solution,
        },
      }),
    });
    return context.json(success(context.req.path.endsWith("/top-n-export") ? topNExport(quiz, board, now) : board));
  } catch (error) {
    if (error instanceof PublicQuizUnavailable) {
      return context.json(failure({
        code: "QUIZ_NOT_FOUND",
        message: "요청한 난이도의 퀴즈를 찾을 수 없습니다.",
        requestId,
      }), 404);
    }
    const code = error instanceof SessionConfigurationError
      ? "BOARD_SESSION_FAILED"
      : error instanceof ParticipationBoardUnavailable
        ? "PARTICIPATION_BOARD_INVALID"
        : "PARTICIPATION_BOARD_READ_FAILED";
    console.error(JSON.stringify({ level: "error", requestId, code }));
    return context.json(failure({
      code: "BOARD_UNAVAILABLE",
      message: "참여 현황을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
      requestId,
    }), 503);
  }
});

app.all("/api/quizzes/:slug/:difficulty/:output{board|top-n-export}", (context) => {
  context.header("Cache-Control", "private, no-store");
  return context.json(failure({
    code: "METHOD_NOT_ALLOWED",
    message: mutationErrorMessages.METHOD_NOT_ALLOWED,
    requestId: context.get("requestId"),
  }), 405);
});

app.post("/api/quizzes/:slug/:difficulty/submissions", async (context) => {
  context.header("Cache-Control", "private, no-store");
  const requestId = context.get("requestId");

  try {
    const body = await readSameOriginJson(context.req.raw);
    const slug = quizSlugSchema.safeParse(context.req.param("slug"));
    const difficulty = difficultySchema.safeParse(context.req.param("difficulty"));
    if (!slug.success || !difficulty.success) {
      return context.json(failure({
        code: "QUIZ_NOT_FOUND",
        message: "요청한 퀴즈를 찾을 수 없습니다.",
        requestId,
      }), 404);
    }

    const token = getCookie(context, SESSION_COOKIE_BASENAME, "host");
    if (!isSessionToken(token)) {
      return context.json(failure({
        code: "SESSION_REQUIRED",
        message: "제출 세션을 다시 준비해 주세요.",
        requestId,
      }), 401);
    }

    const database = createDatabase(context.env.DB);
    const repository = createSubmissionRepository(database);
    const now = new Date();
    const nowIso = now.toISOString();
    const sessionHash = await hashSessionToken(token, context.env.SESSION_PEPPER);
    if (await repository.findActiveSession(sessionHash, nowIso) === undefined) {
      return context.json(failure({
        code: "SESSION_REQUIRED",
        message: "제출 세션이 만료되었습니다. 다시 준비해 주세요.",
        requestId,
      }), 401);
    }

    const rawCellError = classifyRawCells(body);
    if (rawCellError !== undefined) {
      return context.json(failure({
        code: rawCellError,
        field: "cells",
        message: submissionValidationMessages[rawCellError],
        requestId,
      }), 422);
    }
    const parsed = submissionRequestSchema.safeParse(body);
    if (!parsed.success) {
      return context.json(failure({
        code: "INVALID_SUBMISSION_REQUEST",
        message: "제출 요청 형식을 확인해 주세요.",
        requestId,
      }), 400);
    }

    const publicData = await createPublicQuizAccessService(database).read(
      { slug: slug.data },
      difficulty.data,
      now,
    );
    const quiz = publicData.quiz;
    if (quiz === null) {
      return context.json(failure({
        code: "QUIZ_NOT_FOUND",
        message: "요청한 퀴즈를 찾을 수 없습니다.",
        requestId,
      }), 404);
    }

    const activeCellIds = new Set(quiz.variant.grid.cells.map((cell) => cell.id));
    if (Object.keys(parsed.data.cells).length === 0) {
      return context.json(failure({
        code: "EMPTY_SUBMISSION",
        field: "cells",
        message: submissionValidationMessages.EMPTY_SUBMISSION,
        requestId,
      }), 422);
    }
    if (Object.keys(parsed.data.cells).some((id) => !activeCellIds.has(id))) {
      return context.json(failure({
        code: "INVALID_GRID_SHAPE",
        field: "cells",
        message: submissionValidationMessages.INVALID_GRID_SHAPE,
        requestId,
      }), 422);
    }

    const requestHash = await hashSubmissionRequest({
      cells: parsed.data.cells,
      comment: parsed.data.comment,
      name: parsed.data.name,
      quizVariantId: quiz.variant.id,
      revision: parsed.data.revision,
    });
    const existing = await repository.findSubmission(quiz.variant.id, sessionHash);
    if (existing !== undefined) {
      if (existing.status === "deleted" || existing.idempotencyKey !== parsed.data.idempotencyKey) {
        return context.json(failure({
          code: "ALREADY_SUBMITTED",
          message: "이미 이 퀴즈를 제출했습니다.",
          requestId,
        }), 409);
      }
      if (existing.requestHash !== requestHash) {
        return context.json(failure({
          code: "IDEMPOTENCY_CONFLICT",
          message: "이전 제출과 다른 내용입니다. 화면을 새로고침해 주세요.",
          requestId,
        }), 409);
      }
      const solution = await repository.findScoringSolution(quiz.variant.id);
      if (solution === undefined) throw new Error("Missing scoring solution");
      return context.json(success(submissionResult(existing, solution)));
    }

    const limited = await publicRateResponse(context, `submissions/${quiz.variant.id}`, sessionHash);
    if (limited) return limited;
    const policy = await createModerationPolicyRepository(database).loadActivePolicy();
    const moderation = moderateSubmissionContent({
      cells: parsed.data.cells,
      comment: parsed.data.comment,
      grid: quiz.variant.grid,
      name: parsed.data.name,
    }, policy);
    if (!moderation.ok) {
      return context.json(failure({
        code: moderation.error.code,
        field: moderation.error.field,
        message: submissionValidationMessages[moderation.error.code],
        requestId,
      }), 422);
    }

    const verification = await createTurnstileVerifier({
      ...(context.env.TURNSTILE_SITEVERIFY_FETCH ? { fetcher: context.env.TURNSTILE_SITEVERIFY_FETCH } : {}),
      expectedAction: "quiz_submission",
      expectedHostname: context.env.TURNSTILE_EXPECTED_HOSTNAME ?? "",
      secret: context.env.TURNSTILE_SECRET,
    }).verify({
      idempotencyKey: parsed.data.idempotencyKey,
      token: parsed.data.turnstileToken,
    });
    if (verification.outcome === "rejected") {
      return context.json(failure({
        code: "TURNSTILE_FAILED",
        message: "사람 확인에 실패했습니다. 다시 시도해 주세요.",
        requestId,
      }), 403);
    }
    if (verification.outcome === "unavailable") {
      return context.json(failure({
        code: "VERIFICATION_UNAVAILABLE",
        message: "사람 확인 서비스를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.",
        requestId,
      }), 503);
    }

    if (parsed.data.revision !== quiz.variant.revision) {
      return context.json(failure({
        code: "REVISION_MISMATCH",
        message: "퀴즈가 변경되었습니다. 새로고침 후 다시 제출해 주세요.",
        requestId,
      }), 409);
    }
    if (quiz.availability === "paused") {
      return context.json(failure({
        code: "SUBMISSIONS_PAUSED",
        message: "현재 제출을 잠시 중지했습니다.",
        requestId,
      }), 409);
    }
    if (quiz.availability !== "open" || !quiz.acceptingSubmissions) {
      return context.json(failure({
        code: "QUIZ_CLOSED",
        message: "현재 제출할 수 없는 퀴즈입니다.",
        requestId,
      }), 409);
    }

    const solution = await repository.findScoringSolution(quiz.variant.id);
    if (solution === undefined) throw new Error("Missing scoring solution");
    const score = scoreSubmission({
      canonicalCellOrder: solution.canonicalCellOrder,
      grid: quiz.variant.grid,
      solution: solution.solution,
    }, parsed.data.cells);
    const savedAt = new Date().toISOString();
    const saved = await repository.saveSubmission({
      id: crypto.randomUUID(),
      quizVariantId: quiz.variant.id,
      quizRevision: quiz.variant.revision,
      sessionHash,
      idempotencyKey: parsed.data.idempotencyKey,
      requestHash,
      displayName: moderation.value.name,
      comment: moderation.value.comment,
      answers: score.answers,
      correctnessMask: score.correctnessMask,
      correctCells: score.correctCells,
      totalCells: score.totalCells,
      correctWords: score.correctWords,
      totalWords: score.totalWords,
      scoreBasisPoints: score.scoreBasisPoints,
      isFullyCorrect: score.isFullyCorrect,
      submittedAt: savedAt,
    }, savedAt);

    if (saved.outcome === "idempotency_conflict") {
      return context.json(failure({
        code: "IDEMPOTENCY_CONFLICT",
        message: "이전 제출과 다른 내용입니다. 화면을 새로고침해 주세요.",
        requestId,
      }), 409);
    }
    if (saved.outcome === "already_submitted") {
      return context.json(failure({
        code: "ALREADY_SUBMITTED",
        message: "이미 이 퀴즈를 제출했습니다.",
        requestId,
      }), 409);
    }
    if (saved.outcome === "closed") {
      return context.json(failure({
        code: "QUIZ_CLOSED",
        message: "현재 제출할 수 없는 퀴즈입니다.",
        requestId,
      }), 409);
    }
    return context.json(success(submissionResult(saved.submission, solution)));
  } catch (error) {
    if (error instanceof MutationRequestError) {
      return context.json(failure({
        code: error.code,
        message: mutationErrorMessages[error.code],
        requestId,
      }), error.status);
    }
    if (error instanceof SessionConfigurationError) {
      console.error(JSON.stringify({ level: "error", requestId, code: "SUBMISSION_SESSION_FAILED" }));
      return context.json(failure({
        code: "SESSION_UNAVAILABLE",
        message: "제출 세션을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        requestId,
      }), 503);
    }
    if (error instanceof PublicQuizUnavailable) {
      return context.json(failure({
        code: "QUIZ_NOT_FOUND",
        message: "요청한 난이도의 퀴즈를 찾을 수 없습니다.",
        requestId,
      }), 404);
    }
    if (error instanceof SubmissionSessionUnavailable) {
      return context.json(failure({
        code: "SESSION_REQUIRED",
        message: "제출 세션이 만료되었습니다. 다시 준비해 주세요.",
        requestId,
      }), 401);
    }
    console.error(JSON.stringify({ level: "error", requestId, code: "SUBMISSION_FAILED" }));
    return context.json(failure({
      code: "VERIFICATION_UNAVAILABLE",
      message: "제출을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      requestId,
    }), 503);
  }
});

app.all("/api/quizzes/:slug/:difficulty/submissions", (context) => {
  context.header("Cache-Control", "private, no-store");
  return context.json(failure({
    code: "METHOD_NOT_ALLOWED",
    message: mutationErrorMessages.METHOD_NOT_ALLOWED,
    requestId: context.get("requestId"),
  }), 405);
});

app.get("/api/quizzes/:slug", async (context) => {
  context.header("Cache-Control", "no-store");
  const requestId = context.get("requestId");
  const query = new URL(context.req.url).searchParams;
  const difficulty = difficultySchema.safeParse(query.get("difficulty") ?? "child");
  const slug = context.req.param("slug");
  if (!difficulty.success || query.getAll("difficulty").length > 1 || [...query.keys()].some((key) => key !== "difficulty")) {
    return context.json(failure({ code: "INVALID_QUIZ_QUERY", message: "어린이용 또는 장년용을 선택해 주세요.", requestId }), 400);
  }
  if (slug !== "latest" && !quizSlugSchema.safeParse(slug).success) {
    return context.json(failure({ code: "QUIZ_NOT_FOUND", message: "요청한 퀴즈를 찾을 수 없습니다.", requestId }), 404);
  }
  try {
    const data = await createPublicQuizAccessService(createDatabase(context.env.DB)).read(
      slug === "latest" ? "latest" : { slug },
      difficulty.data,
    );
    if (!data.quiz && slug !== "latest") return context.json(failure({ code: "QUIZ_NOT_FOUND", message: "요청한 퀴즈를 찾을 수 없습니다.", requestId }), 404);
    return context.json(success(data));
  } catch (error) {
    if (error instanceof PublicQuizUnavailable) return context.json(failure({ code: "QUIZ_NOT_FOUND", message: "요청한 난이도의 퀴즈를 찾을 수 없습니다.", requestId }), 404);
    // Do not log Zod issue paths, JSON contents, SQL or private values from D1.
    console.error(JSON.stringify({ level: "error", requestId, code: "PUBLIC_QUIZ_READ_FAILED" }));
    return context.json(failure({ code: "QUIZ_UNAVAILABLE", message: "퀴즈를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.", requestId }), 503);
  }
});

app.get("/api/archive", async (context) => {
  context.header("Cache-Control", "no-store");
  const requestId = context.get("requestId");
  try {
    const query = parseArchiveQuery(new URL(context.req.url).searchParams);
    const data = await createArchiveRepository(createDatabase(context.env.DB), context.env.ARCHIVE_CURSOR_SECRET).read(query);
    return context.json(success(data));
  } catch (error) {
    if (error instanceof InvalidArchiveFilter) return context.json(failure({ code: "INVALID_ARCHIVE_FILTER", message: "검색 조건을 확인하고 처음부터 다시 조회해 주세요.", requestId }), 400);
    console.error(JSON.stringify({ level: "error", requestId, code: "ARCHIVE_READ_FAILED" }));
    return context.json(failure({ code: "ARCHIVE_UNAVAILABLE", message: "지난 퀴즈를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.", requestId }), 503);
  }
});

app.notFound((context) => {
  const requestId = context.get("requestId") || crypto.randomUUID();

  return context.json(
    failure({
      code: "NOT_FOUND",
      message: "요청한 API를 찾을 수 없습니다.",
      requestId,
    }),
    404,
  );
});

app.onError((error, context) => {
  const requestId = context.get("requestId") || crypto.randomUUID();
  console.error(
    JSON.stringify({
      level: "error",
      requestId,
      message: error instanceof Error ? error.message : "Unknown error",
    }),
  );

  return context.json(
    failure({
      code: "INTERNAL_ERROR",
      message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
      requestId,
    }),
    500,
  );
});

// Build the route table at module initialization, without dispatching a request
// or running middleware. Real requests still match and authenticate normally.
prepareReadSchema(adminContentHistoryQuerySchema);
adminSermonIdSchema.safeParse(""); // Rejected ID initializes only its built-in checks.
app.router.match("GET", "/__initialize_routes__");
