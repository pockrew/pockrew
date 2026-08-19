import { appendFileSync, mkdirSync } from "node:fs";

import { Hono } from "hono";
import { serve } from "@hono/node-server";

mkdirSync("tests/fixtures/raw", { recursive: true });
const app = new Hono();
app.post("/event", async (c) => {
  const body = await c.req.json();
  appendFileSync(
    "tests/fixtures/raw/hooks.jsonl",
    JSON.stringify({
      receivedAt: Date.now(),
      hook: c.req.header("x-hook-name") ?? "unknown",
      body,
    }) + "\n",
  );
  return c.json({ ok: true });
});
// 7777 is a suggestion only — override with CAPTURE_PORT (rules/server.md)
const port = Number(process.env["CAPTURE_PORT"] ?? 7777);
serve({ fetch: app.fetch, port });
console.log(`capture listening on :${port} → tests/fixtures/raw/hooks.jsonl`);
