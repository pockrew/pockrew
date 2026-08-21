import { expect, test } from "vitest";

import { parseToken } from "./token";

test("parseToken extracts token from hash", () => {
  expect(parseToken("#token=abc123xyz")).toBe("abc123xyz");
  expect(parseToken("#foo=bar&token=secret_123")).toBe("secret_123");
  expect(parseToken("token=bare_token")).toBe("bare_token");
  expect(parseToken("#token=hello%20world")).toBe("hello world");
  expect(parseToken("#other=value")).toBeNull();
  expect(parseToken("")).toBeNull();
});
