---
globs: ["src/web/**"]
description: React/web rules — apply only inside src/web
---

# React / web rules

- **Atomic design** (no UI lib): `src/web/components/{atoms,molecules,organisms}/…`; page-level
  composition at `src/web/entry.tsx` (`WebEntry`); shared display constants in `src/web/lib/`.
- **Typing:** every component is `const X: FC<Props> = …` (`FC<PropsWithChildren>` when children).
- **Naming:** handlers created inside a component are `handleXxx`; event/handler props are
  `onXxx` (`onResolve={handleResolve}`).
- **Component layout:** hooks at the top, `useEffect` blocks last — immediately before the
  return/render part. Nothing between the effects and the JSX.
- **State:** Zustand store; add the `immer` middleware once updates go beyond whole-object
  replace (SSE patch-apply, M3 — the `immer` dep is pre-approved for that moment, not before).
  React Context only shares **readonly** values (theme, config) — never mutable state. Local
  state beyond a few fields becomes one state object updated via immer, not stacked `useState`.
- **Imports:** cross-folder uses the `@/…` alias (→ `src/web/`), e.g.
  `@/components/atoms/actor-chip`; same-folder stays relative (`./styles.module.css`). Never
  `../../../…`. Contracts come from `#contracts/*.js` — web imports nothing else cross-layer.
- **Mobile-first CSS:** base styles target small screens; widen with `min-width` media queries.
- **Icons: Hugeicons** (`@hugeicons/react`, free set) — pre-approved to replace the emoji
  placeholders at M3; verify the free-set license is MIT-compatible at adoption. No other icon lib.
- Status is always **icon + label + colour**, never colour alone; durations via `--dur-*` tokens
  (zeroed under `prefers-reduced-motion`); interactive targets ≥ 40×40 CSS px.
