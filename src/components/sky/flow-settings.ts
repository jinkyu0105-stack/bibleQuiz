import { browserStorage } from "../../lib/browser-storage";

export type FlowKind = "silk";
export type FlowSettings = { strength: number; scale: number; speed: number };
export const defaultFlowSettings: Record<FlowKind, FlowSettings> = {
  silk: { strength: 50, scale: 50, speed: 50 },
};

export function normalizeFlowSettings(kind: FlowKind, value: unknown): FlowSettings {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const read = (key: keyof FlowSettings) => {
    const number = source[key];
    return typeof number === "number" && Number.isFinite(number)
      ? Math.round(Math.min(100, Math.max(key === "strength" ? 10 : 0, number)))
      : defaultFlowSettings[kind][key];
  };
  return { strength: read("strength"), scale: read("scale"), speed: read("speed") };
}
export function readFlowSettings(kind: FlowKind): FlowSettings {
  try { return normalizeFlowSettings(kind, JSON.parse(browserStorage()?.getItem(`bibleQuiz:${kind}-settings`) ?? "null")); }
  catch { return { ...defaultFlowSettings[kind] }; }
}
