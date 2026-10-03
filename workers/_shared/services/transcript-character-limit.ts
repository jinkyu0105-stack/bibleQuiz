export const transcriptMaxCharacters = 30_000;

/** D-033: code points, including unchanged whitespace and one LF between segments.
 * This is a new-write policy, not a persisted-document validity check.
 * Existing Unicode, byte and segment checks remain separate.
 */
export function withinTranscriptCharacterLimit(body: string | readonly { readonly text: string }[]): boolean {
  const parts = typeof body === "string" ? [{ text: body }] : body;
  const separators = Math.max(0, parts.length - 1);
  let units = separators;
  for (const part of parts) units += part.text.length;
  // Most captions are BMP text: no scanning or full-text copy is needed.
  if (units <= transcriptMaxCharacters) return true;
  if (units > transcriptMaxCharacters * 2) return false;
  let count = separators;
  for (const part of parts) {
    for (const character of part.text) {
      void character;
      if (++count > transcriptMaxCharacters) return false;
    }
  }
  return count <= transcriptMaxCharacters;
}
