import { defaultFlowSettings, normalizeFlowSettings, flowRenderSettings, restoreFlowSettings } from "../../components/sky/flow-settings";
import { describe, expect, it } from "vitest";
import { defaultMercurySettings, normalizeMercurySettings } from "../../components/sky/mercury-settings";
import { defaultVeilSettings, normalizeVeilSettings } from "../../components/sky/veil-settings";

describe("saved effect settings", () => {
  it("recovers missing and malformed settings without losing the approved defaults", () => {
    for (const value of [null, false, "broken", [], { strength: Infinity, scale: NaN, speed: "40" }]) {
      expect(normalizeMercurySettings(value)).toEqual(defaultMercurySettings);
    }
    expect(normalizeVeilSettings(null)).toEqual(defaultVeilSettings);
  });
  it("bounds restored slider values and preserves zero reflection speed", () => {
    expect(normalizeMercurySettings({ strength: -5, scale: 150, speed: 0 })).toEqual({ strength: 10, scale: 100, speed: 0 });
    expect(normalizeMercurySettings({ strength: 42.7, scale: 61.3, speed: 27 })).toEqual({ strength: 43, scale: 61, speed: 27 });
    expect(normalizeVeilSettings({ width: -1, strength: 200, spread: null })).toEqual({ width: 0, strength: 100, spread: 60, speed: 50 });
  });
});

it("upgrades existing light settings without changing their appearance", () => {
  expect(normalizeVeilSettings({ width: 21, strength: 73, spread: 42 })).toEqual({ width: 21, strength: 73, spread: 42, speed: 50 });
  expect(normalizeVeilSettings({ speed: 0 }).speed).toBe(0);
});
for (const kind of ["silk"] as const) {
  it(`${kind} preserves defaults for invalid storage and clamps valid numbers`, () => {
    for (const value of [null, false, [], "bad", { strength: Infinity, speed: NaN, scale: "50" }]) {
      expect(normalizeFlowSettings(kind, value)).toEqual(defaultFlowSettings[kind]);
    }
    expect(normalizeFlowSettings(kind, { strength: -5, scale: 1000, speed: 0 })).toEqual({ strength: 10, scale: 100, speed: 0 });
    expect(normalizeFlowSettings(kind, { strength: 44.8, scale: 20.1, speed: 500 })).toEqual({ strength: 45, scale: 20, speed: 100 });
  });
}

it("caps silk rendering at the approved brightness, fold size and speed", () => {
  expect(flowRenderSettings({ strength: 100, scale: 0, speed: 100 })).toEqual({ strength: 21, scale: 80, speed: 24 });
  expect(flowRenderSettings({ strength: 10, scale: 100, speed: 0 })).toEqual({ strength: 2.1, scale: 100, speed: 0 });
});
it("converts legacy silk settings once, preserving allowed appearance and clamping outliers", () => {
  expect(restoreFlowSettings("silk", { strength: 21, scale: 80, speed: 24 })).toEqual({ strength: 100, scale: 0, speed: 100 });
  expect(restoreFlowSettings("silk", { strength: 50, scale: 50, speed: 50 })).toEqual({ strength: 100, scale: 0, speed: 100 });
  expect(restoreFlowSettings("silk", { strength: 10.5, scale: 90, speed: 12 })).toEqual({ strength: 50, scale: 50, speed: 50 });
  expect(restoreFlowSettings("silk", { version: 2, strength: 21, scale: 80, speed: 24 })).toEqual({ strength: 21, scale: 80, speed: 24 });
  expect(restoreFlowSettings("silk", { speed: 0 }).speed).toBe(0);
  for (const value of [null, false, [], { strength: Infinity, scale: NaN, speed: "bad" }]) {
    expect(restoreFlowSettings("silk", value)).toEqual(defaultFlowSettings.silk);
  }
});
