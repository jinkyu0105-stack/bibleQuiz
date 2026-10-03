import { describe, expect, it } from "vitest";

import { nextDeadlineRefresh, remainingTimeLabel } from "./deadline";

describe("quiz deadline", () => {
  const now = "2026-09-01T00:00:00.000Z";

  it.each([
    ["2026-09-03T02:59:01.000Z", "2일 2시간"],
    ["2026-09-01T02:05:00.000Z", "2시간 5분"],
    ["2026-09-01T00:00:01.000Z", "1분"],
    ["2026-09-01T00:00:00.000Z", "마감되었습니다."],
    ["2026-08-31T23:59:59.000Z", "마감되었습니다."],
  ])("formats %s without replacing the exact deadline", (deadline, expected) => {
    expect(remainingTimeLabel(deadline, now)).toBe(expected);
  });

  it("schedules minute-boundary refreshes and stops at the deadline", () => {
    expect(nextDeadlineRefresh("2026-09-01T00:02:00.000Z", Date.parse("2026-09-01T00:00:30.000Z"))).toBe(30_025);
    expect(nextDeadlineRefresh(now, Date.parse(now))).toBeNull();
  });
});
