import type { AdminSermonInputCurrent } from "../../../shared/api/admin-sermon-input";

type InputContent = AdminSermonInputCurrent["content"];

export type ManualCorrectionTarget = {
  segmentId: string | null;
  start: number | null;
  duration: number | null;
  from: number;
  to: number;
  contextBefore: string;
  contextAfter: string;
};

function occurrences(text: string, needle: string): number[] {
  const found: number[] = [];
  let from = 0;
  while (from <= text.length - needle.length) {
    const index = text.indexOf(needle, from);
    if (index < 0) break;
    found.push(index);
    from = index + Math.max(1, needle.length);
  }
  return found;
}

export function locateUniqueCorrectionTarget(content: InputContent, originalText: string): ManualCorrectionTarget | null {
  if (originalText.length === 0) return null;
  const matches: Array<{ text: string; index: number; segment?: Extract<InputContent, { format: "timed_segments" }>["segments"][number] }> = [];
  if (content.format === "plain_text") {
    for (const index of occurrences(content.text, originalText)) matches.push({ text: content.text, index });
  } else {
    for (const segment of content.segments) {
      for (const index of occurrences(segment.text, originalText)) matches.push({ text: segment.text, index, segment });
    }
  }
  if (matches.length !== 1) return null;
  const match = matches[0]!;
  const to = match.index + originalText.length;
  return {
    segmentId: match.segment?.segmentId ?? null,
    start: match.segment?.start ?? null,
    duration: match.segment?.duration ?? null,
    from: match.index,
    to,
    contextBefore: match.text.slice(Math.max(0, match.index - 120), match.index),
    contextAfter: match.text.slice(to, to + 120),
  };
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function documentText(content: InputContent): string {
  return content.format === "plain_text" ? content.text : content.segments.map((segment) => segment.text).join("\n");
}

export function documentSha256(content: InputContent): Promise<string> {
  return sha256(documentText(content));
}

export function sourceSha256(content: InputContent): Promise<string> {
  if (content.format === "plain_text") return sha256(content.text);
  return sha256(JSON.stringify(content.segments.map(({ text, start, duration }) => ({ text, start, duration }))));
}
