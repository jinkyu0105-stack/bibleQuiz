const DEFAULT_MAX_JSON_BYTES = 16 * 1024;
const MUTATION_METHODS = new Set(["DELETE", "PATCH", "POST", "PUT"]);

export type MutationRequestErrorCode =
  | "INVALID_JSON"
  | "METHOD_NOT_ALLOWED"
  | "ORIGIN_NOT_ALLOWED"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE";

export class MutationRequestError extends Error {
  constructor(
    readonly code: MutationRequestErrorCode,
    readonly status: 400 | 403 | 405 | 413 | 415,
  ) {
    super(code);
  }
}

function assertMutationHeaders(request: Request, maxBytes: number): void {
  if (!MUTATION_METHODS.has(request.method)) {
    throw new MutationRequestError("METHOD_NOT_ALLOWED", 405);
  }

  const contentLength = request.headers.get("Content-Length");
  if (contentLength !== null && /^\d+$/u.test(contentLength) && Number(contentLength) > maxBytes) {
    throw new MutationRequestError("PAYLOAD_TOO_LARGE", 413);
  }

  if (request.headers.get("Origin") !== new URL(request.url).origin) {
    throw new MutationRequestError("ORIGIN_NOT_ALLOWED", 403);
  }

  const contentType = request.headers.get("Content-Type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    throw new MutationRequestError("UNSUPPORTED_MEDIA_TYPE", 415);
  }
}

async function readCappedBody(request: Request, maxBytes: number): Promise<Uint8Array> {
  if (request.body === null) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new MutationRequestError("PAYLOAD_TOO_LARGE", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function readSameOriginJson(
  request: Request,
  maxBytes = DEFAULT_MAX_JSON_BYTES,
): Promise<unknown> {
  assertMutationHeaders(request, maxBytes);
  const bytes = await readCappedBody(request, maxBytes);

  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof MutationRequestError) throw error;
    throw new MutationRequestError("INVALID_JSON", 400);
  }
}

export const MAX_MUTATION_JSON_BYTES = DEFAULT_MAX_JSON_BYTES;
