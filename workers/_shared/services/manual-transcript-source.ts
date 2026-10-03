import { strictObject, enum as zEnum, string, literal, type z } from "zod";
import { sha256Bytes } from "../storage/sha256";
import { prepareInputSchema } from "./prepare-input-schema";
import { isWellFormedText } from "./text-well-formed";

// Worker-only, private in-memory contract. No persistence, confirmation, API DTO,
// timestamp extraction, or claim that an administrator's coverage is true.
export const manualTranscriptMaxBytes = 1_048_576;
export const manualTranscriptChecksumFormat = "sha256:utf8-raw-text:v1";

const inputSchema = strictObject({
  sourceMode: zEnum(["manual_paste", "sermon_notes"]),
  manualSourceKind: zEnum([
    "youtube_visible_transcript", "sermon_manuscript", "sermon_summary",
  ]),
  sourceCoverage: zEnum(["full_transcript", "partial_notes"]),
  // Early code-unit bound prevents encoding unbounded input. UTF-8 is checked below.
  rawTranscriptText: string().max(manualTranscriptMaxBytes),
});
export const manualTranscriptSourceSchema = inputSchema.extend({
  checksumFormat: literal(manualTranscriptChecksumFormat),
  rawTranscriptSha256: string().regex(/^[0-9a-f]{64}$/u),
});

prepareInputSchema(inputSchema);
prepareInputSchema(manualTranscriptSourceSchema);

export type PrivateManualTranscriptSource = Readonly<z.infer<typeof manualTranscriptSourceSchema>>;
// Only identities of our own frozen results; never text/hash keyed caching.
// A serialized/copied/client-created object cannot acquire this capability.
const preparedSources = new WeakSet<object>();

const failureMessages = {
  INVALID_MANUAL_SOURCE: "입력 자료의 형식을 확인해 주세요.",
  MANUAL_SOURCE_MISMATCH: "자료 종류·입력 방식·전체/부분 범위가 일치하지 않습니다.",
  MANUAL_TEXT_EMPTY: "입력 자료에 비어 있지 않은 텍스트가 필요합니다.",
  MANUAL_TEXT_TOO_LARGE: "입력 자료는 UTF-8 기준 1MiB 이하여야 합니다.",
  MANUAL_TEXT_INVALID: "입력 자료에 올바르지 않은 문자나 지원하지 않는 제어 문자가 있습니다.",
  MANUAL_CHECKSUM_MISMATCH: "원본 텍스트와 checksum이 일치하지 않습니다.",
  MANUAL_VALIDATION_FAILED: "입력 자료 검증을 완료하지 못했습니다.",
} as const;
type FailureCode = keyof typeof failureMessages;
type Failure = { outcome: "failed"; code: FailureCode; message: string };
export type ManualTranscriptSourceResult =
  | { outcome: "validated"; source: PrivateManualTranscriptSource }
  | Failure;

function failure(code: FailureCode): Failure {
  return { outcome: "failed", code, message: failureMessages[code] };
}

function validateTextAndMetadata(input: z.infer<typeof inputSchema>): Failure | Uint8Array {
  const youtube = input.manualSourceKind === "youtube_visible_transcript";
  if (input.sourceMode !== (youtube ? "manual_paste" : "sermon_notes") ||
    (!youtube && input.sourceCoverage !== "partial_notes")) {
    return failure("MANUAL_SOURCE_MISMATCH");
  }
  const text = input.rawTranscriptText;
  // Reject lone UTF-16 surrogates: TextEncoder would silently replace them.
  // eslint-disable-next-line no-control-regex -- Explicitly reject binary controls; permit tabs and CR/LF.
  if (!isWellFormedText(text) || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(text)) {
    return failure("MANUAL_TEXT_INVALID");
  }
  if (!/[^\s\u200B-\u200D\u2060\uFEFF]/u.test(text)) return failure("MANUAL_TEXT_EMPTY");
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > manualTranscriptMaxBytes) {
    return failure("MANUAL_TEXT_TOO_LARGE");
  }
  return bytes;
}

async function validate(input: unknown, verifyChecksum: boolean): Promise<ManualTranscriptSourceResult> {
  try {
    const parsed = (verifyChecksum ? manualTranscriptSourceSchema : inputSchema).safeParse(input);
    if (!parsed.success) {
      // Do not return Zod issues, input paths/keys, or user-controlled error text.
      if (parsed.error.issues.some((issue) => issue.code === "too_big" && issue.path[0] === "rawTranscriptText")) {
        return failure("MANUAL_TEXT_TOO_LARGE");
      }
      return failure("INVALID_MANUAL_SOURCE");
    }
    const bytes = validateTextAndMetadata(parsed.data);
    if (!(bytes instanceof Uint8Array)) return bytes;
    // Reuse the exact unnormalized bytes already checked against the size limit.
    const rawTranscriptSha256 = await sha256Bytes(bytes);
    if (verifyChecksum && "rawTranscriptSha256" in parsed.data &&
      parsed.data.rawTranscriptSha256 !== rawTranscriptSha256) {
      return failure("MANUAL_CHECKSUM_MISMATCH");
    }
    const source = Object.freeze({
      ...parsed.data,
      checksumFormat: manualTranscriptChecksumFormat,
      rawTranscriptSha256,
    });
    if (!verifyChecksum) preparedSources.add(source);
    return { outcome: "validated", source };
  } catch {
    // Getters/proxies, hashing failures and thrown secret-bearing objects must
    // never become logs, causes or a partially validated private result.
    return failure("MANUAL_VALIDATION_FAILED");
  }
}

/** Calculate an original checksum from an unknown, strict manual input. */
export function prepareManualTranscriptSource(input: unknown): Promise<ManualTranscriptSourceResult> {
  return validate(input, false);
}

/** Recompute, never repair a supplied checksum. This does not authenticate origin. */
export function verifyManualTranscriptSource(input: unknown): Promise<ManualTranscriptSourceResult> {
  return validate(input, true);
}

/** Private one-use handoff from server preparation to the same import operation.
 * Consumed or unrecognized identities use the normal full verification path.
 * This proves only immutable text validation, never ownership or current version.
 */
export function consumePreparedManualSource(input: unknown): input is PrivateManualTranscriptSource {
  if (!input || typeof input !== "object" || !preparedSources.has(input)) return false;
  preparedSources.delete(input);
  return true;
}

/** Explicit safe projection: never serialize the private success result directly. */
export function manualTranscriptDiagnosticForCopy(result: ManualTranscriptSourceResult) {
  if (result.outcome === "validated") return { outcome: "validated" as const };
  // Pick fixed local messages; never forward even a typed result's message.
  return Object.hasOwn(failureMessages, result.code)
    ? failure(result.code)
    : failure("MANUAL_VALIDATION_FAILED");
}
