## What this changes

<!-- One or two sentences. Link the issue if there is one. -->

## Why

<!-- What was broken or missing. For anything beyond a fix, link the issue where the approach was
     agreed, since large unsolicited changes usually get closed on architecture grounds. -->

## Checklist

- [ ] `pnpm check`, `pnpm test`, and `pnpm build` all pass locally
- [ ] Stayed inside one zone (`src/adapters|core|server`, or `src/web`)
- [ ] No change to `src/contracts/` — it is frozen; propose contract diffs in an issue instead
- [ ] No new dependency, or it was agreed in an issue first
- [ ] No guardrail was loosened to get green — not `.dependency-cruiser.cjs`, `.oxlintrc.json`,
      `tools/guards.mjs`, or a tsconfig
- [ ] Every event, receipt, and confidence label is backed by a real signal; nothing invented
- [ ] Logic that can break has one test that fails when it breaks; pipeline logic tests against a
      real fixture in `tests/fixtures/`
- [ ] Pure zones untouched, or still pure: no IO, no node builtins, no `Date.now()`

## CLA

First pull request? Add the sign-off line from [`CLA.md`](../CLA.md):

```
I have read and agree to the Contributor License Agreement in CLA.md.
Signed: <your full legal name> <your email>
```
