import { historyChunkBytes, sameHistoryValue } from "./history-json-codec";

/** Validate and copy D1's JSON BLOB representation in one bounded pass. Never
 * re-read a validated element later (including getter-backed test inputs). */
export function copyHistoryByteArray(value: unknown): Uint8Array | null {
  if (!Array.isArray(value) || value.length > historyChunkBytes) return null;
  const length = value.length;
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    if (!Object.hasOwn(value, i)) return null;
    const byte: unknown = value[i];
    if (typeof byte !== "number" || !Number.isInteger(byte) || byte < 0 || byte > 255) return null;
    bytes[i] = byte;
  }
  return value.length === length ? bytes : null;
}

/** Exact own-attempt proof without expanding expected BLOBs to number arrays.
 * Preserve enumerable-key equality of the old generic comparator as well. */
export function sameHistoryByteArray(actual: unknown, expected: ArrayBuffer): boolean {
  if (!Array.isArray(actual) || actual.length !== expected.byteLength ||
    actual.length > historyChunkBytes || Object.keys(actual).length !== actual.length) return false;
  const bytes = new Uint8Array(expected);
  for (let i = 0; i < bytes.length; i++) {
    // Equality to a byte also rejects non-integers, NaN, strings and coercion.
    if (!Object.hasOwn(actual, i) || actual[i] !== bytes[i]) return false;
  }
  return true;
}

export function sameHistoryStoredRow(actual: unknown, expected: Record<string, unknown>): boolean {
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
  const keys = Object.keys(expected);
  if (Object.keys(actual).length !== keys.length) return false;
  return keys.every((key) => Object.hasOwn(actual, key) &&
    (expected[key] instanceof ArrayBuffer
      ? sameHistoryByteArray(Reflect.get(actual, key), expected[key])
      : sameHistoryValue(Reflect.get(actual, key), expected[key])));
}
