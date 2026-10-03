import { z } from "zod";
import { parseBibleReference } from "./bible-reference";

/** Same accepted forms as the accountless transcript adapter; never fetches URLs. */
export function parseYouTubeVideoId(value: string): string | null {
  const valid = /^[A-Za-z0-9_-]{11}$/u;
  if (valid.test(value.trim())) return value.trim();
  let url: URL;
  try { url = new URL(value.trim()); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  let id: string | null = null;
  if (url.hostname === "youtu.be") id = /^\/([A-Za-z0-9_-]{11})$/u.exec(url.pathname)?.[1] ?? null;
  else if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname)) {
    if (url.pathname === "/watch" && url.searchParams.getAll("v").length === 1) id = url.searchParams.get("v");
    else id = /^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{11})$/u.exec(url.pathname)?.[1] ?? null;
  }
  return id && valid.test(id) ? id : null;
}

export function suggestSermonDate(title: string, now = new Date(), publishedAt?: string) {
  const published = publishedAt && Number.isFinite(Date.parse(publishedAt)) ? new Date(publishedAt) : null;
  const prefix = /^(\d{8}|\d{6})(?!\d)/u.exec(title.trim())?.[1];
  const digits = prefix?.length === 6 ? `20${prefix}` : prefix;
  const candidate = digits ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}` : null;
  if (candidate && z.iso.date().safeParse(candidate).success) return {
    date: candidate, reason: "제목 앞 날짜", distant: published !== null && Math.abs(Date.parse(candidate) - published.getTime()) > 31 * 86400000,
  };
  const kst = new Date((published ?? now).getTime() + 9 * 3600000);
  kst.setUTCDate(kst.getUTCDate() - kst.getUTCDay());
  return { date: kst.toISOString().slice(0, 10), reason: published ? "게시일 기준 최근 일요일" : "작업 생성일 기준 최근 일요일", distant: false };
}

/** Extract explicit title metadata only; never infers a passage or calls AI. */
export function extractSermonTitleMetadata(videoTitle: string) {
  const original = videoTitle.trim();
  let title = original;
  let referenceInput: string | null = null;
  const suffix = /(?:\(([^()]*)\)|\[([^\]]*)\]|(?:\s+[-|·]\s+|\s+)([가-힣]+\s*\d+\s*(?::|장)[^()[\]]*))$/u.exec(title);
  const candidate = suffix?.[1] ?? suffix?.[2] ?? suffix?.[3];
  if (suffix && candidate) {
    const parsed = parseBibleReference(candidate);
    // Multiple explicit passages need a person's choice, not the last passage.
    const before = title.slice(0, suffix.index);
    const otherPassages = [...before.matchAll(/[가-힣]+\s*\d+\s*:\s*\d+(?:\s*[-~–—]\s*\d+)?|[가-힣]+\s*\d+\s*장\s*\d+\s*절(?:\s*[-~–—]\s*\d+\s*절?)?/gu)];
    if (parsed.ok && !otherPassages.some(match => parseBibleReference(match[0]).ok)) {
      referenceInput = parsed.value.canonicalLabel;
      title = before.trim().replace(/\s*[-|·]\s*$/u, "").trim();
    }
  }
  const prefix = /^(\d{8}|\d{6})(?!\d)\s*[-|·]?\s*/u.exec(title);
  const digits = prefix?.[1];
  const fullDate = digits?.length === 6 ? `20${digits}` : digits;
  if (prefix && fullDate && z.iso.date().safeParse(`${fullDate.slice(0, 4)}-${fullDate.slice(4, 6)}-${fullDate.slice(6, 8)}`).success) {
    title = title.slice(prefix[0].length);
  }
  title = title.replace(/^(?:주일예배|주일 예배|주일설교|주일 설교|수요예배|수요 예배|금요예배|금요 예배)\s*[-|·]\s*/u, "").trim();
  return { title: title || original, referenceInput };
}
