import { browserStorage } from "../../lib/browser-storage";

export const defaultVeilSettings = { width: 65, strength: 55, spread: 60, speed: 50 };
export type VeilSettings = typeof defaultVeilSettings;

export function normalizeVeilSettings(value: unknown): VeilSettings {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const read = (key: keyof VeilSettings) => {
    const number = source[key];
    return typeof number === "number" && Number.isFinite(number)
      ? Math.round(Math.min(100, Math.max(key === "strength" ? 10 : 0, number)))
      : defaultVeilSettings[key];
  };
  return { width: read("width"), strength: read("strength"), spread: read("spread"), speed: read("speed") };
}

export function readVeilSettings(): VeilSettings {
  try { return normalizeVeilSettings(JSON.parse(browserStorage()?.getItem("bibleQuiz:veil-settings") ?? "null")); }
  catch { return { ...defaultVeilSettings }; }
}
