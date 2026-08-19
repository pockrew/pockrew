# Pockrew

Your AI agent crew, in your pocket — local-first supervisor for Claude Code & Codex.

Pockrew tails what your coding agents actually do (hooks, JSONL transcripts), normalizes it into
one canonical event stream, and renders a live world you can glance at: who is working, who needs
you, what shipped. Everything stays on your machine.

**Status:** scaffold. Contracts and guardrails are in place; the ingestion pipeline starts at M0.

## Setup

Requires Node 24.18.0 (see `.nvmrc`) and pnpm 11.22.0 via `corepack enable`. SQLite comes from
Node's built-in `node:sqlite` — nothing to compile.

```bash
pnpm install
git config core.hooksPath .githooks   # once, enables the pre-commit `pnpm check`
```

| Command        |                                                                 |
| -------------- | --------------------------------------------------------------- |
| `pnpm dev`     | server (tsx watch) + web (vite) in parallel                     |
| `pnpm check`   | tsc + oxlint + dependency-cruiser + pure-zone guards + prettier |
| `pnpm test`    | vitest                                                          |
| `pnpm build`   | tsc + vite build                                                |
| `pnpm capture` | M0 hook capture on :7777 → `tests/fixtures/raw/hooks.jsonl`     |

Run `pnpm check` before every commit. Red means fix, not skip.

## Architecture

Data flows one way: `adapters → core → server → web`. The web app sends `UserIntent`s back; it
never mutates state directly. The SQLite events table is the source of truth — all state rebuilds
from it. Pure zones (`core/reduce|receipts|attention|conflicts|reports`) do no IO and take a
clock as a parameter.

Import across layers with the `#contracts/…`, `#core/…`, `#adapters/…`, `#server/…` subpath
aliases declared in `package.json` `imports`. They resolve to `src/` under the `development`
condition and to `dist/` at runtime, so nothing has to rewrite specifiers after `tsc`.

Boundaries are machine-enforced by `.dependency-cruiser.cjs` and `tools/guards.mjs`. Two options
there are load-bearing: `parser: "tsc"` (the default parser emits no edge for `import type`, so
every rule would pass blindly) and `conditionNames` starting with `development` (otherwise aliases
resolve into `dist/` and the path rules stop matching). Do not raise TypeScript past the range
dependency-cruiser supports.

See `docs/spec.md` and `docs/architect.md`. Agent working rules: `AGENTS.md` / `CLAUDE.md`.

## Planned CLI

Not published yet — there is no `cli.ts` to point a `bin` at, so `package.json` is `private` and
declares no binary. Once the server lands:

```bash
npx pockrew@latest        # start local server + open app
npx pockrew setup         # detect + preview + install adapters
npx pockrew doctor        # read-only diagnostics
npx pockrew uninstall     # remove only owned config entries
```

Docs will always say `@latest`, because npx caches old versions.

## Known limitation: Pockrew only sees what it is running for

Pockrew is a daemon in the terminal you started it in. While it is not running, **permission
requests are lost permanently** — they arrive over hooks only, with no transcript to backfill from.
Activity is recoverable; it gets backfilled from JSONL on the next start.

On startup Pockrew records the gap since its last event, and the Shift Report states the blind
window explicitly. It will never report "nothing happened" when the truth is "I was not running".
Keep the terminal (or a tmux session) alive while you rely on notifications; a user-level service
mode is planned for v0.2.

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) first — a one-time [CLA](CLA.md) is required before the
first merge, and `src/contracts/` is frozen. Security issues go through a private GitHub advisory,
not a public issue.

## License

Source-available under the [Functional Source License 1.1 with an MIT future
license](LICENSE.md): use, modify, and self-host freely; do not ship a competing product. Every
release converts to MIT two years after publication. This is not an OSI-approved open-source
license. Third-party obligations: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
