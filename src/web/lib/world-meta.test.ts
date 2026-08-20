import { expect, test } from "vitest";

import { ACTOR_SPRITE_BY_SOURCE } from "./world-meta";

test("each source maps to its own sprite", () => {
  expect(ACTOR_SPRITE_BY_SOURCE.claude).toBe("sprite-claude");
  expect(ACTOR_SPRITE_BY_SOURCE.codex).toBe("sprite-codex");
});
