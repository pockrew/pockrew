import { expect, test } from "vitest";

import { RETURN_THRESHOLD_MS, shouldOpenOnReturn } from "./use-return-detection";

const BASE_TIME = 1_700_000_000_000;

test("shouldOpenOnReturn returns false when not hidden", () => {
  expect(shouldOpenOnReturn(null, BASE_TIME)).toBe(false);
});

test("shouldOpenOnReturn returns false when hidden less than threshold", () => {
  const hiddenAt = BASE_TIME;
  const now = BASE_TIME + RETURN_THRESHOLD_MS - 1;
  expect(shouldOpenOnReturn(hiddenAt, now)).toBe(false);
});

test("shouldOpenOnReturn returns true when hidden exactly threshold duration", () => {
  const hiddenAt = BASE_TIME;
  const now = BASE_TIME + RETURN_THRESHOLD_MS;
  expect(shouldOpenOnReturn(hiddenAt, now)).toBe(true);
});

test("shouldOpenOnReturn returns true when hidden longer than threshold duration", () => {
  const hiddenAt = BASE_TIME;
  const now = BASE_TIME + 20 * 60_000;
  expect(shouldOpenOnReturn(hiddenAt, now)).toBe(true);
});
