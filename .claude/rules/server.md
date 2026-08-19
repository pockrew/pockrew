---
globs: ["src/server/**", "src/core/store/**", "tools/**"]
description: Server, persistence and tooling rules — server layer, SQLite store, dev tools
---

# Server / persistence rules

- **Hono follows resource-style REST:** routes grouped per resource (`/api/<resource>`); route
  handlers are thin — parse/validate, delegate to a core function, shape the response
  (controller/service split, MVC-style). No business logic inside a route handler.
- **SQLite: no N+1 queries.** Fetch collections with one query (JOIN or `IN (…)` batch), never a
  query per row. Derivations read whole windows, not per-actor loops. `node:sqlite` only inside
  `src/core/store/`.
- Security invariants (spec): bind `127.0.0.1`, token on every endpoint, origin allowlist, port
  from the registry — never hardcoded.
- **No hard-bound ports anywhere.** Every listening port and proxy target is configurable via an
  env var (documented next to its default); the number in code is only the default suggestion.
  A dev or another process may already own that port — bind failures must surface clearly, and
  the daemon keeps auto-picking a free port unless `POCKREW_PORT` pins one.
