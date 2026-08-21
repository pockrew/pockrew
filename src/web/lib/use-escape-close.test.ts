import { expect, test } from "vitest";

import { isTopmost, popOverlay, pushOverlay } from "./use-escape-close";

test("only the last opened overlay answers Escape, and closing it hands over to the one below", () => {
  const tracker = () => {};
  const deliveries = () => {};
  const inspector = () => {};

  pushOverlay(tracker);
  expect(isTopmost(tracker)).toBe(true);

  pushOverlay(deliveries);
  pushOverlay(inspector);
  expect(isTopmost(inspector)).toBe(true);
  expect(isTopmost(deliveries)).toBe(false);
  expect(isTopmost(tracker)).toBe(false);

  // An overlay can close out of order (a click on its own button, not Escape).
  popOverlay(deliveries);
  expect(isTopmost(inspector)).toBe(true);

  popOverlay(inspector);
  expect(isTopmost(tracker)).toBe(true);

  popOverlay(tracker);
  expect(isTopmost(tracker)).toBe(false);
});
