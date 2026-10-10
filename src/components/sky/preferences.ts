import { browserStorage } from "../../lib/browser-storage";
import type { SkyTime } from "../../../docs/design/phase-9/sky-v2/world.js";
export type SkyChoice = SkyTime | "system";
export const skyTimes = ["dawn", "day", "dusk", "night"] as const;

export function readSkyChoice(): SkyChoice {
  try {
    const storage = browserStorage();
    const saved = storage?.getItem("bibleQuiz:sky");
    if (saved === "system" || skyTimes.includes(saved as SkyTime)) return saved as SkyChoice;
    const legacy = storage?.getItem("bibleQuiz:theme");
    return legacy === "dark" ? "night" : legacy === "light" ? "day" : "system";
  } catch { return "system"; }
}
export function readSkyFlag(key: string): boolean {
  try { return browserStorage()?.getItem(`bibleQuiz:${key}`) === "true"; } catch { return false; }
}
export function saveSkyPreference(key: string, value: string): boolean {
  try { const storage = browserStorage(); if (!storage) return false; storage.setItem(`bibleQuiz:${key}`, value); return true; } catch { return false; }
}
