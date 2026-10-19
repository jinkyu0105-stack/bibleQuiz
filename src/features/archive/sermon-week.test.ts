import { describe, expect, it } from "vitest";
import { sermonWeekLabel } from "./sermon-week";

describe("month weeks from the stored sermon date", () => {
  it.each([
    ["2026-10-04", "10월 첫째 주"], ["2026-09-27", "9월 넷째 주"],
    ["2026-11-01", "11월 첫째 주"], ["2026-11-29", "11월 다섯째 주"],
    ["2026-12-07", "12월 첫째 주"], ["2026-12-08", "12월 둘째 주"],
    ["2024-02-29", "2월 다섯째 주"], ["2027-01-01", "1월 첫째 주"],
  ])("%s is %s regardless of timezone", (date, label) => {
    expect(sermonWeekLabel(date)).toBe(label);
  });
});
