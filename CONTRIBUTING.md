# Contributing to Pockrew

Pockrew is at the scaffold stage: contracts and guardrails exist, the ingestion pipeline does not.
Small, well-scoped pull requests are welcome. Large ones are likely to be rejected on architecture
grounds before anyone reads the code, so open an issue first for anything beyond a fix.

## Before you write anything

Read [`AGENTS.md`](AGENTS.md). It is short and it is the rule set every change is measured against —
whether a human or an agent wrote it. [`docs/architect.md`](docs/architect.md) explains why the rules
are shaped that way; [`docs/spec.md`](docs/spec.md) is what the product must be true about.

Three rules cause most rejected pull requests:

- **`src/contracts/` is frozen.** Propose the diff in an issue; do not include it in a pull request.
- **Never fake a signal.** No event, receipt, or relationship without real evidence behind it. A
  `verified` label needs an exit code, a git hash, or an explicit completion event. This is the one
  thing the project cannot compromise on.
- **No new dependencies**, including dev dependencies, without agreement in an issue first.

## Setup

```bash
corepack enable
pnpm install
git config core.hooksPath .githooks   # runs pnpm check before each commit
```

Node 24.18.0 exactly (`.nvmrc`), pnpm 11.22.0. SQLite comes from Node's built-in `node:sqlite`, so
there is nothing to compile.

## Before you open a pull request

```bash
pnpm check   # tsc for both projects, oxlint, dependency-cruiser, pure-zone guards, prettier
pnpm test
pnpm build
```

All three must pass. CI runs the same three and will not be merged red.

If `pnpm check` fails on a boundary rule, the fix is the code, never the rule. Two options in
`.dependency-cruiser.cjs` are load-bearing — `parser: "tsc"` and `conditionNames` starting with
`development` — and a pull request that removes either will be closed. Both exist because without
them the boundary rules pass while enforcing nothing.

Logic that can break needs one test that fails when it breaks. Pipeline logic needs a test against a
real fixture in `tests/fixtures/`; if no fixture covers your case, capture one with `pnpm capture`
rather than guessing a payload shape.

## Commits

Small, English, prefixed by zone: `core:`, `adapter/claude:`, `web:`, `server:`, `chore:`.

## Contributor License Agreement

Pockrew is source-available under FSL-1.1-MIT, and there are plans for a paid closed-source surface
on the same code. Shipping your contribution under those terms needs a license from you broad enough
to sublicense, so a one-time CLA is required before the first merge.

Read [`CLA.md`](CLA.md) and add this to the description of your first pull request:

```
I have read and agree to the Contributor License Agreement in CLA.md.
Signed: <your full legal name> <your email>
```

You keep the copyright to your work. One signature covers everything you contribute afterwards.

## Reporting a security issue

Do not open a public issue. Pockrew runs a local server that holds an auth token and can observe
agent activity, so a vulnerability there is worth handling quietly. Use GitHub's private security
advisory on this repository.
