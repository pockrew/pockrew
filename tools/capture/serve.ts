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
serve({ fetch: app.fetch, port: 7777 });
console.log("capture listening on :7777 → tests/fixtures/raw/hooks.jsonl");
