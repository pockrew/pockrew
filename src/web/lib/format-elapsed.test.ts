import { expect, test } from "vitest";

import { formatElapsed } from "./format-elapsed";

const NOW = 1_786_784_400_000;
const CLOCK_TIME = /^\d{1,2}:\d{2}\s?(AM|PM)?$/i;

test("under a minute renders an absolute clock time, never a relative claim of currency", () => {
  expect(formatElapsed(NOW - 30_000, NOW)).toMatch(CLOCK_TIME);
});

test("minutes and hours round down to whole units", () => {
  expect(formatElapsed(NOW - 8 * 60_000, NOW)).toBe("8m ago");
  expect(formatElapsed(NOW - 90 * 60_000, NOW)).toBe("1h ago");
});

test("days after 24 hours", () => {
  expect(formatElapsed(NOW - 25 * 60 * 60_000, NOW)).toBe("1d ago");
});

test("a future timestamp (clock skew) renders an absolute time, never negative", () => {
  expect(formatElapsed(NOW + 5_000, NOW)).toMatch(CLOCK_TIME);
});
