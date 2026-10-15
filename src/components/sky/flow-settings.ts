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
// Map controller percentages to the original shader's approved visual range.
export function flowRenderSettings(settings: FlowSettings): FlowSettings {
  return { strength: settings.strength * .21, scale: 80 + settings.scale * .2, speed: settings.speed * .24 };
}

export function restoreFlowSettings(kind: FlowKind, value: unknown): FlowSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...defaultFlowSettings[kind] };
  const source = value as Record<string, unknown>;
  if (source.version === 2) return normalizeFlowSettings(kind, source);
  const convert = (key: keyof FlowSettings, map: (value: number) => number) =>
    typeof source[key] === "number" && Number.isFinite(source[key]) ? map(source[key]) : undefined;
  return normalizeFlowSettings(kind, {
    strength: convert("strength", value => value / .21),
    scale: convert("scale", value => (value - 80) / .2),
    speed: convert("speed", value => value / .24),
  });
}

export function readFlowSettings(kind: FlowKind): FlowSettings {
  try { return restoreFlowSettings(kind, JSON.parse(browserStorage()?.getItem(`bibleQuiz:${kind}-settings`) ?? "null")); }
  catch { return { ...defaultFlowSettings[kind] }; }
}
