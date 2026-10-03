import { z } from "zod";

import { sessionDataSchema } from "../../../shared/api/session";
import {
  ownSubmissionDataSchema,
  submissionDeletionDataSchema,
  submissionDeletionRequestSchema,
  submissionRequestSchema,
  submissionResultSchema,
  type OwnSubmission,
  type SubmissionDeletionData,
  type SubmissionRequest,
  type SubmissionResult,
} from "../../../shared/api/submission";
import type { Difficulty } from "../../../shared/api/public-quiz";

const SESSION_TIMEOUT_MS = 15_000;
const errorSchema = z.strictObject({
  error: z.strictObject({
    code: z.string().min(1).max(128),
    field: z.enum(["cells", "comment", "name"]).optional(),
    message: z.string().min(1).max(500),
    requestId: z.uuid(),
  }),
});
const sessionResponseSchema = z.strictObject({ data: sessionDataSchema });
const submissionResponseSchema = z.strictObject({ data: submissionResultSchema });
const ownSubmissionResponseSchema = z.strictObject({ data: ownSubmissionDataSchema });
const submissionDeletionResponseSchema = z.strictObject({ data: submissionDeletionDataSchema });

let sessionPreparationPromise: Promise<SessionPreparationResult> | undefined;

export interface PublicClientError {
  code: string;
  field?: "cells" | "comment" | "name";
  message: string;
  requestId?: string;
}

export type SessionPreparationResult =
  | { ok: true; expiresAt: string }
  | { ok: false; error: PublicClientError };

export type SubmissionClientResult =
  | { ok: true; data: SubmissionResult }
  | { ok: false; error: PublicClientError };

export type OwnSubmissionClientResult =
  | { ok: true; data: OwnSubmission | null }
  | { ok: false; error: PublicClientError };

export interface SubmissionDeletionTarget {
  difficulty: Difficulty;
  quizRevision: number;
  quizVariantId: string;
  slug: string;
}

export type SubmissionDeletionClientResult =
  | { ok: true; data: SubmissionDeletionData["submission"] }
  | { ok: false; error: PublicClientError };

function clientError(message: string): PublicClientError {
  return { code: "CLIENT_UNAVAILABLE", message };
}

async function readPublicError(response: Response): Promise<PublicClientError> {
  try {
    const parsed = errorSchema.safeParse(await response.json());
    if (parsed.success) {
      const error = parsed.data.error;
      return {
        code: error.code,
        message: error.message,
        requestId: error.requestId,
        ...(error.field === undefined ? {} : { field: error.field }),
      };
    }
  } catch {
    // The response boundary below intentionally replaces arbitrary upstream text.
  }
  return clientError("요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(SESSION_TIMEOUT_MS);
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
}

async function requestSubmissionSession(): Promise<SessionPreparationResult> {
  try {
    const response = await fetch("/api/session", {
      body: "{}",
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      method: "POST",
      signal: requestSignal(),
    });
    if (!response.ok) return { ok: false, error: await readPublicError(response) };
    const parsed = sessionResponseSchema.safeParse(await response.json());
    return parsed.success
      ? { ok: true, expiresAt: parsed.data.data.expiresAt }
      : { ok: false, error: clientError("제출 세션 응답을 확인하지 못했습니다.") };
  } catch {
    return { ok: false, error: clientError("제출 세션을 준비하지 못했습니다. 연결을 확인해 주세요.") };
  }
}

export function prepareSubmissionSession(): Promise<SessionPreparationResult> {
  // React StrictMode deliberately mounts effects twice in development. Share only
  // the in-flight request so that its cleanup cannot create a second session call;
  // settled failures remain retryable and later panels can refresh the cookie.
  sessionPreparationPromise ??= requestSubmissionSession().finally(() => {
    sessionPreparationPromise = undefined;
  });
  return sessionPreparationPromise;
}

export async function submitQuiz(
  target: { difficulty: Difficulty; slug: string },
  request: SubmissionRequest,
  signal?: AbortSignal,
): Promise<SubmissionClientResult> {
  const validated = submissionRequestSchema.safeParse(request);
  if (!validated.success) {
    return { ok: false, error: clientError("제출할 내용을 다시 확인해 주세요.") };
  }
  try {
    const response = await fetch(
      `/api/quizzes/${encodeURIComponent(target.slug)}/${target.difficulty}/submissions`,
      {
        body: JSON.stringify(validated.data),
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        method: "POST",
        signal: requestSignal(signal),
      },
    );
    if (!response.ok) return { ok: false, error: await readPublicError(response) };
    const parsed = submissionResponseSchema.safeParse(await response.json());
    return parsed.success
      ? { ok: true, data: parsed.data.data }
      : { ok: false, error: clientError("채점 결과를 확인하지 못했습니다. 같은 내용으로 다시 시도해 주세요.") };
  } catch {
    return { ok: false, error: clientError("제출 결과를 받지 못했습니다. 같은 내용으로 다시 시도해 주세요.") };
  }
}

export async function readOwnSubmission(
  target: { difficulty: Difficulty; slug: string },
  signal?: AbortSignal,
): Promise<OwnSubmissionClientResult> {
  try {
    const response = await fetch(
      `/api/quizzes/${encodeURIComponent(target.slug)}/${target.difficulty}/me`,
      {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        method: "GET",
        signal: requestSignal(signal),
      },
    );
    if (!response.ok) return { ok: false, error: await readPublicError(response) };
    const parsed = ownSubmissionResponseSchema.safeParse(await response.json());
    return parsed.success
      ? { ok: true, data: parsed.data.data.submission }
      : { ok: false, error: clientError("기존 제출 결과를 확인하지 못했습니다.") };
  } catch {
    return { ok: false, error: clientError("기존 제출 결과를 확인하지 못했습니다. 연결을 확인해 주세요.") };
  }
}

export async function deleteOwnSubmission(
  target: SubmissionDeletionTarget,
  signal?: AbortSignal,
): Promise<SubmissionDeletionClientResult> {
  const request = submissionDeletionRequestSchema.safeParse({});
  if (!request.success) {
    return { ok: false, error: clientError("삭제 요청을 준비하지 못했습니다. 제출 결과를 유지합니다.") };
  }
  try {
    const response = await fetch(
      `/api/quizzes/${encodeURIComponent(target.slug)}/${target.difficulty}/me/submission`,
      {
        body: JSON.stringify(request.data),
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        method: "DELETE",
        signal: requestSignal(signal),
      },
    );
    if (!response.ok) return { ok: false, error: await readPublicError(response) };
    const parsed = submissionDeletionResponseSchema.safeParse(await response.json());
    if (
      !parsed.success ||
      parsed.data.data.submission.quizVariantId !== target.quizVariantId ||
      parsed.data.data.submission.quizRevision !== target.quizRevision
    ) {
      return { ok: false, error: clientError("삭제 결과를 확인하지 못했습니다. 제출 결과를 유지합니다.") };
    }
    return { ok: true, data: parsed.data.data.submission };
  } catch {
    return { ok: false, error: clientError("제출을 삭제하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.") };
  }
}

export function generateUuidV7(timestamp = Date.now()): string {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > 0xffff_ffff_ffff) {
    throw new RangeError("Invalid UUIDv7 timestamp");
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let remaining = timestamp;
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function submissionFingerprint(input: {
  cells: Readonly<Record<string, string>>;
  comment: string;
  consent: boolean;
  name: string;
  revision: number;
}): string {
  return JSON.stringify({
    revision: input.revision,
    name: input.name.normalize("NFC").trim(),
    comment: input.comment.normalize("NFC").trim(),
    consent: input.consent,
    cells: Object.fromEntries(
      Object.entries(input.cells).sort(([left], [right]) => left.localeCompare(right)),
    ),
  });
}
