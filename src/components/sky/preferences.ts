import { browserStorage } from "../../lib/browser-storage";
import type { SkyTime } from "../../../docs/design/phase-9/sky-v2/world.js";
export const skyTimes = ["dawn", "day", "dusk", "night"] as const;
const sessionKey = "bibleQuiz:sky-session";

/** A manual choice lasts for this tab, including reloads and route changes. */
export function readSkyChoice(): SkyTime | null {
  try {
    const saved = window.sessionStorage.getItem(sessionKey);
    return skyTimes.includes(saved as SkyTime) ? saved as SkyTime : null;
  } catch { return null; }
}
export function saveSkyChoice(time: SkyTime): boolean {
  try { window.sessionStorage.setItem(sessionKey, time); return true; } catch { return false; }
}
export function readSkyFlag(key: string): boolean {
  try { return browserStorage()?.getItem(`bibleQuiz:${key}`) === "true"; } catch { return false; }
}
export function saveSkyPreference(key: string, value: string): boolean {
  try { const storage = browserStorage(); if (!storage) return false; storage.setItem(`bibleQuiz:${key}`, value); return true; } catch { return false; }
}
