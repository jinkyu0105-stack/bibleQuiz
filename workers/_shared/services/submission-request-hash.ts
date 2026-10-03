import type { SubmissionRequest } from "../../../shared/api/submission";

interface SubmissionRequestHashInput {
  cells: SubmissionRequest["cells"];
  comment: string | null;
  name: string;
  quizVariantId: string;
  revision: number;
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(
    new Uint8Array(bytes),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Hashes the semantic submission only. The idempotency key identifies the
 * retry and the one-use Turnstile token may legitimately change between
 * retries, so neither belongs in this digest.
 */
export async function hashSubmissionRequest(
  input: SubmissionRequestHashInput,
): Promise<string> {
  const normalizedName = input.name.normalize("NFC").trim();
  const normalizedComment = input.comment?.normalize("NFC").trim() ?? "";
  const canonical = JSON.stringify({
    quizVariantId: input.quizVariantId,
    revision: input.revision,
    name: normalizedName,
    comment: normalizedComment.length === 0 ? null : normalizedComment,
    consent: true,
    cells: Object.fromEntries(
      Object.entries(input.cells).sort(([left], [right]) => left.localeCompare(right)),
    ),
  });
  return bytesToHex(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  ));
}
