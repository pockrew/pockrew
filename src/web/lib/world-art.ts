import type { SourceId } from "#contracts/events.js";
import type { Station } from "#contracts/world.js";

// ?no-inline on every asset: all of these are far above Vite's inline threshold already, but
// saying it explicitly keeps the build predictable — world art always ships as cacheable files,
// never as data: URIs bloating the JS bundle.
import plateArt from "@/assets/world/district-plate.png?no-inline";
import bossDeskArt from "@/assets/world/station-boss-desk.png?no-inline";
import hqArt from "@/assets/world/station-hq.png?no-inline";
import labArt from "@/assets/world/station-lab.png?no-inline";
import libraryArt from "@/assets/world/station-library.png?no-inline";
import loungeArt from "@/assets/world/station-lounge.png?no-inline";
import reviewArt from "@/assets/world/station-review.png?no-inline";
import workshopArt from "@/assets/world/station-workshop.png?no-inline";
import warehouseArt from "@/assets/world/warehouse.png?no-inline";
import workerClaudeArt from "@/assets/world/worker-claude.png?no-inline";

/**
 * Where the world's artwork lives. Interim pack; the final art regenerates into the same file
 * names, so swapping the PNGs in `assets/world/` needs no code change here.
 *
 * All of it is decoration: every state, station and confidence still carries its own icon, label
 * and colour (docs/spec.md "Accessibility"), so the art is always `alt=""` and `aria-hidden`.
 */

/** The ground plate a district sits on. */
export const DISTRICT_PLATE_ART = plateArt;

/** Header visual for the warehouse section. */
export const WAREHOUSE_ART = warehouseArt;

/** One building per semantic station. A new station in the contract forces an entry here. */
export const STATION_ART: Record<Station, string> = {
  library: libraryArt,
  workshop: workshopArt,
  lab: labArt,
  review: reviewArt,
  hq: hqArt,
  boss_desk: bossDeskArt,
  lounge: loungeArt,
};

/**
 * Character art per agent source. `null` means "not generated yet": `idle` falls back to the SVG
 * sprite in `assets/sprites.svg`, and a null `walkFrames` means the walk animation is a CSS bob.
 * Dropping the PNGs in and filling these slots is the whole change — no component touched.
 */
export const ACTOR_ART_BY_SOURCE: Record<SourceId, { idle: string | null; walkFrames: string[] | null }> = {
  claude: { idle: workerClaudeArt, walkFrames: null },
  codex: { idle: null, walkFrames: null },
};
