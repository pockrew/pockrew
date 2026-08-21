# Web (`src/web/`)

> Sources: `entry.tsx`, `state.ts`, `lib/*`, `components/**`, `styles.css`, `vite.config.ts`.
> Last verified: 2026-08-21. Style rules: `.claude/rules/react.md` (atomic design, FC<Props>,
> `@/` alias, mobile-first, Hugeicons).

## Component tree

```
WebEntry (entry.tsx — the page IS the world; owns `inspecting` for HUD yield)
├─ World (organism)          camera/pan/zoom, list mirror, owns selectedId
│  ├─ District ×N            plate SVG: roads, links, StationSlot, ActorChip, IdleCluster
│  ├─ ActorInspector         bottom sheet; the ONLY place confidence renders
│  └─ WorldListMirror        visually-hidden a11y region, reads off the same layout
├─ ConnectionBadge, AttentionDrawer (→ AttentionItemCard), DeliveriesHud (→ Warehouse → ReceiptDelivery)
```

## State + server connection (`state.ts`)

Zustand + immer: `{world, connection, connect}`. Token parsed from `location.hash`
(`#token=…` — fragment never reaches server logs); `POST /api/stream-ticket` with
`x-pockrew-token` header → `EventSource(/api/stream?ticket=…)`. Manual reconnect with backoff
[1s, 2s, 5s] and a fresh ticket per attempt (single-use tickets make EventSource's native
reconnect useless); 401/403 ⇒ `unauthorized`, no retry. `reduceStreamData` (exported for
tests): snapshot replaces world + sets `live`; patch applies `apply-patch.ts` replace-by-key
ops in order. `mock/world.ts` is **test-only** M2 leftover (no runtime import) — easy to
mistake for live wiring.

## lib/ one-liners

- `grid.ts` — ⚠️ byte-identical twin of `core/town.ts` placement (layer rule forbids the
  import); `grid.test.ts` pins a literal server-produced cell to catch drift.
- `district-layout.ts` — town on its plate: active vs built (permanent) stations, HQ center,
  roads, `travelFactor` (≤3×), cluster fold rules. `builtStations` fallback gap closes only
  via persisted `stationCells`.
- `world-layout.ts` — towns on the plane (third copy of the grid logic), `nearProjectIds`
  (30min recency window), `mostRelevantProjectId`, camera clamp/focus.
- `world-meta.ts` — every label/icon/colour table as `Record<ContractUnion, …>` so a new
  contract member is a compile error. Hugeicons throughout.
- `world-art.ts` — asset URL tables, `?no-inline` (load-bearing: `<use href>` can't resolve
  into a data: URI). Codex idle art + all walkFrames still null placeholders.
- `travel-state.ts` — pure walk decisions. Trap: `nextTravel`/`settleTravel` MUST return the
  same object on no-op or the 1200ms backstop gets cleared without re-arming. `isArrival`
  kills the "crew parades out of HQ on reload" bug.
- `format-elapsed.ts` — sub-minute shows an absolute clock time on purpose (server suppresses
  `generatedAt`-only patches, so `now` goes stale; "just now" would lie). Looks like a bug;
  is not.
- `attention.ts` — `isOpenAttention` = open|acknowledged; twin of `core/world.ts::needsUser`.
- `use-escape-close.ts` — module-level LIFO overlay stack; Escape closes topmost only.

## Behavior traps (deliberate, do not "fix")

- `World` pans by writing `transform` directly to the plane node during drag (no re-render per
  frame), reconciles on pointerup; `DRAG_SLOP=6`; camera never auto-pans away from keyboard
  focus; `setPointerCapture` wrapped in empty catch.
- `AttentionDrawer` keeps the list mounted when collapsed (aria-live must not be silenced) and
  deliberately omits `aria-expanded` — a linter will want to "fix" both.
- `StationSlot` is fully `aria-hidden` (list mirror announces stations — avoids double
  announcement). All decorative art `alt=""`.
- Reduced motion handled entirely by tokens: `prefers-reduced-motion` zeroes all `--dur-*`.
- `ActorChip` holds `routeFrom` in a ref so fresh closures never restart a walk; `walked` ref
  drops the spawn keyframe after the first walk.
- React Compiler deliberately off in `vite.config.ts` (perf lives in Zustand selectors).
- `layout.roadCells` computed and unused — reserved for a future PNG road-tile renderer.

## CSS tokens (`styles.css`)

Families: `--surface*/--ink*` (dark via `prefers-color-scheme`), `--state-*` (9, precedence
order), `--station-*` (7), `--confidence-*` (3), `--space-1..8`, `--radius-*`,
`--target-min: 40px`, `--z-world|hud|overlay|inspector` (no component invents a z-index),
`--dur-*` + `--ease-move`. Component-local props (`--chip-x/y`, `--district-*`, …) are declared
in TSX and read in module CSS.

## Tests

Beside source, node env, no DOM. Notables: `grid.test.ts` (12 — twin-drift guard),
`district-layout.test.ts` (25), `world-layout.test.ts` (14), `travel-state.test.ts` (12),
`state/apply-patch/format-elapsed/use-escape-close/world-meta/mock` smaller. Full test map:
[testing](testing.md).
