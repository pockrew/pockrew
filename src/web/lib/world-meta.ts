import type { AttentionType } from "#contracts/attention.js";
import type { ActorState, Station } from "#contracts/world.js";

/** Fixed stage coordinates per station; actors translate to these. */
export const STATIONS: Array<{ id: Station; label: string; x: number; y: number }> = [
  { id: "library", label: "Library", x: 8, y: 8 },
  { id: "workshop", label: "Workshop", x: 212, y: 8 },
  { id: "lab", label: "Lab", x: 416, y: 8 },
  { id: "review", label: "Review", x: 8, y: 148 },
  { id: "hq", label: "HQ", x: 212, y: 148 },
  { id: "boss_desk", label: "Boss desk", x: 416, y: 148 },
  { id: "lounge", label: "Lounge", x: 212, y: 288 },
];

export const STATION_POS = new Map(STATIONS.map((s) => [s.id, s]));

/** State is always icon + label + colour, never colour alone. */
export const STATE_META: Record<ActorState, { icon: string; label: string }> = {
  starting: { icon: "✦", label: "starting" },
  thinking: { icon: "💭", label: "thinking" },
  working: { icon: "🔨", label: "working" },
  waiting_user: { icon: "✋", label: "needs you" },
  blocked: { icon: "🔥", label: "blocked" },
  completed: { icon: "🎉", label: "completed" },
  idle: { icon: "☕", label: "idle" },
  ended: { icon: "🚪", label: "ended" },
  unknown: { icon: "❓", label: "unknown" },
};

export const ATTENTION_META: Record<AttentionType, { icon: string; label: string }> = {
  approval: { icon: "✋", label: "approval" },
  question: { icon: "❓", label: "question" },
  error: { icon: "🔥", label: "error" },
  stalled: { icon: "⏳", label: "stalled" },
  conflict: { icon: "⚠️", label: "conflict" },
  ready_review: { icon: "📦", label: "ready for review" },
  coverage_gap: { icon: "📡", label: "coverage gap" },
};
