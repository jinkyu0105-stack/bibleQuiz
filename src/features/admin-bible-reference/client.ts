import { z } from "zod";

import {
  adminBibleReferenceSuccessSchema,
  parseBibleReferenceRequestSchema,
  type BibleReferencePreviewQuery,
} from "../../../shared/api/admin-bible-reference";
import type { NormalizedBibleReference } from "../../../shared/bible-reference";

const REQUEST_TIMEOUT_MS = 15_000;

const errorResponseSchema = z.strictObject({
  error: z.strictObject({
    code: z.string().min(1).max(128),
    message: z.string().min(1).max(500),
    requestId: z.uuid(),
  }),
});

export interface AdminBibleReferenceClientError {
  code: string;
  message: string;
  requestId?: string;
}

export type AdminBibleReferenceClientResult =
  | { ok: true; data: NormalizedBibleReference }
  | { ok: false; error: AdminBibleReferenceClientError };

function unavailable(message: string): AdminBibleReferenceClientResult {
  return { ok: false, error: { code: "CLIENT_UNAVAILABLE", message } };
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
}

async function readError(response: Response): Promise<AdminBibleReferenceClientResult> {
  try {
    const parsed = errorResponseSchema.safeParse(await response.json());
    if (parsed.success) {
      return { ok: false, error: parsed.data.error };
    }
  } catch {
    // Do not surface arbitrary upstream text in the administrator UI.
  }
  return unavailable("성경 장절을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
}

async function readSuccess(response: Response): Promise<AdminBibleReferenceClientResult> {
  try {
    const parsed = adminBibleReferenceSuccessSchema.safeParse(await response.json());
    return parsed.success
      ? { ok: true, data: parsed.data.data }
      : unavailable("성경 장절 응답을 확인하지 못했습니다.");
  } catch {
    return unavailable("성경 장절 응답을 확인하지 못했습니다.");
  }
}

export async function parseAdminBibleReference(
  input: string,
  signal?: AbortSignal,
): Promise<AdminBibleReferenceClientResult> {
  const request = parseBibleReferenceRequestSchema.safeParse({ input });
  if (!request.success) return unavailable("성경 장절 입력을 다시 확인해 주세요.");

  try {
    const response = await fetch("/api/admin/bible/parse-reference", {
      body: JSON.stringify(request.data),
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      method: "POST",
      signal: requestSignal(signal),
    });
    return response.ok ? readSuccess(response) : readError(response);
  } catch {
    return unavailable("성경 장절을 확인하지 못했습니다. 연결을 확인해 주세요.");
  }
}

export async function previewAdminBibleReference(
  selection: BibleReferencePreviewQuery,
  signal?: AbortSignal,
): Promise<AdminBibleReferenceClientResult> {
  const parameters = new URLSearchParams({
    book: selection.book,
    chapter: String(selection.chapter),
    verseEnd: String(selection.verseEnd),
    verseStart: String(selection.verseStart),
  });

  try {
    const response = await fetch(`/api/admin/bible/reference-preview?${parameters.toString()}`, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      method: "GET",
      signal: requestSignal(signal),
    });
    return response.ok ? readSuccess(response) : readError(response);
  } catch {
    return unavailable("선택한 성경 장절을 확인하지 못했습니다. 연결을 확인해 주세요.");
  }
}
