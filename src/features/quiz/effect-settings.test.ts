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
    expect(normalizeVeilSettings({ width: -1, strength: 200, spread: null })).toEqual({ width: 0, strength: 100, spread: 60 });
  });
});
