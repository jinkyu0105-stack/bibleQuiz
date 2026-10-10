import { describe, expect, it } from "vitest";
import { seoulSkyTime, seoulSolarTimes } from "../../components/sky/solar-time";

describe("Seoul sky time", () => {
  // Independent USNO reference retrieved 2026-10-10, coordinates 37.5665,126.978, tz=9.
  // https://aa.usno.navy.mil/api/rstt/oneday?date=2026-06-21&coords=37.5665,126.978&tz=9
  // A UI approximation: allow four minutes, not an astronomical precision guarantee.
  it.each([
    ["2026-06-21", { dawn: 280, sunrise: 311, noon: 754, sunset: 1197, night: 1228 }],
    ["2026-12-21", { dawn: 434, sunrise: 463, noon: 750, sunset: 1037, night: 1066 }],
  ])("matches independent summer/winter reference for %s", (day, reference) => {
    const times = seoulSolarTimes(new Date(`${day}T12:00:00+09:00`));
    for (const key of ["dawn", "sunrise", "noon", "sunset", "night"] as const) {
      expect(Math.abs(times[key] - reference[key])).toBeLessThan(4);
    }
    expect(times.day).toBeGreaterThan(times.sunrise);
    expect(times.dusk).toBeLessThan(times.sunset);
    expect(times.day).toBeLessThan(times.noon);
    expect(times.dusk).toBeGreaterThan(times.noon);
  });

  it("uses Korean time and seasonal daylight instead of fixed clock hours", () => {
    expect(seoulSkyTime(new Date("2026-06-20T21:00:00Z"))).toBe("day"); // 06:00 KST
    expect(seoulSkyTime(new Date("2026-12-20T21:00:00Z"))).toBe("night");
    expect(seoulSkyTime(new Date("2026-06-21T10:30:00Z"))).toBe("dusk"); // 19:30 KST
    expect(seoulSkyTime(new Date("2026-12-21T10:30:00Z"))).toBe("night");
    expect(seoulSkyTime(new Date("2026-12-20T22:30:00Z"))).toBe("dawn");
    expect(seoulSkyTime(new Date("2026-12-21T03:30:00Z"))).toBe("day");
  });

  it.each(["2026-01-01", "2026-06-21", "2026-12-21", "2028-02-29"])("transitions once across each boundary, including leap day %s", day => {
    const midnight = new Date(`${day}T00:00:00+09:00`).getTime();
    const times = seoulSolarTimes(new Date(midnight));
    for (const [key, before, after] of [["dawn", "night", "dawn"], ["day", "dawn", "day"], ["dusk", "day", "dusk"], ["night", "dusk", "night"]] as const) {
      expect(seoulSkyTime(new Date(midnight + (times[key] - 1) * 60_000))).toBe(before);
      expect(seoulSkyTime(new Date(midnight + (times[key] + 1) * 60_000))).toBe(after);
    }
    const lastSecond = new Date(midnight + 86_399_000);
    expect(seoulSolarTimes(lastSecond)).toEqual(times);
    expect(seoulSkyTime(lastSecond)).toBe("night");
  });
});
