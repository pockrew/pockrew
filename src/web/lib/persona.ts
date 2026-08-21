import { hash } from "./grid";

/**
 * Cosmetic persona names, one per actor, stable across reloads (seeded by actor id — never
 * Math.random, a unit must keep its name). Pure renderer skin, the way "Town/Corp" naming is:
 * the real identity (prompt, agent_type, source, session id) stays in `displayName`, the
 * accessible name and the inspector. Two pools so a helper reads as a helper.
 */
const WORKERS = [
  "Bolt",
  "Crank",
  "Dyno",
  "Ember",
  "Flux",
  "Gears",
  "Gizmo",
  "Jolt",
  "Koda",
  "Lumen",
  "Milo",
  "Nimbus",
  "Orbit",
  "Piston",
  "Quill",
  "Rivet",
  "Rune",
  "Sable",
  "Servo",
  "Sprocket",
  "Tinker",
  "Turbo",
  "Vega",
  "Wisp",
  "Wrench",
  "Zephyr",
];

const HELPERS = [
  "Beep",
  "Blip",
  "Dash",
  "Doodle",
  "Echo",
  "Fetch",
  "Mote",
  "Nudge",
  "Patch",
  "Ping",
  "Pip",
  "Scamp",
  "Scout",
  "Skip",
  "Sprout",
  "Zip",
];

export const personaFor = (actorId: string, isSubagent: boolean): string => {
  const pool = isSubagent ? HELPERS : WORKERS;
  return pool[hash(`persona:${actorId}`) % pool.length]!;
};
