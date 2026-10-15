import { browserStorage } from "../../lib/browser-storage";

// Midpoints reproduce the previously approved reflection exactly.
export const defaultMercurySettings = { strength: 50, scale: 50, speed: 50 };
export type MercurySettings = typeof defaultMercurySettings;

export function normalizeMercurySettings(value: unknown): MercurySettings {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const read = (key: keyof MercurySettings) => {
    const number = source[key];
    return typeof number === "number" && Number.isFinite(number)
      ? Math.round(Math.min(100, Math.max(key === "strength" ? 10 : 0, number)))
      : defaultMercurySettings[key];
  };
  return { strength: read("strength"), scale: read("scale"), speed: read("speed") };
}

export function readMercurySettings(): MercurySettings {
  try { return normalizeMercurySettings(JSON.parse(browserStorage()?.getItem("bibleQuiz:mercury-settings") ?? "null")); }
  catch { return { ...defaultMercurySettings }; }
}
