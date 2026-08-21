import {
  AlertCircleIcon,
  AlertDiamondIcon,
  BrainIcon,
  CheckmarkBadge01Icon,
  CircleQuestionMarkIcon,
  Coffee01Icon,
  DoorClosedIcon,
  EyeIcon,
  Fire02Icon,
  HammerIcon,
  HandIcon,
  HourglassIcon,
  Key01Icon,
  Loading03Icon,
  MessageQuestionIcon,
  PackageDelivered01Icon,
  PartyIcon,
  QuestionIcon,
  RefreshIcon,
  Rocket01Icon,
  Satellite01Icon,
  ShieldBanIcon,
  WifiConnected01Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";

import type { AttentionType } from "#contracts/attention.js";
import type { Confidence, SourceId } from "#contracts/events.js";
import type { ReceiptKind } from "#contracts/receipts.js";
import type { ActivityCategory, ActorState, Station } from "#contracts/world.js";

/** How recent a signal has to be to still count as part of the world. */
export const RECENT_WINDOW_MS = 30 * 60_000;

/**
 * Station names. Positions are NOT here: a district only builds the stations it has a signal for,
 * and where each one stands is seeded per district in lib/district-layout.
 */
export const STATION_LABEL: Record<Station, string> = {
  hq: "HQ",
  library: "Library",
  workshop: "Workshop",
  lab: "Lab",
  review: "Review",
  boss_desk: "Boss desk",
  lounge: "Lounge",
};

/** Placement order. HQ first: it is the anchor every town starts with and roads lead to it. */
export const STATION_ORDER: Station[] = ["hq", "library", "workshop", "lab", "review", "boss_desk", "lounge"];

/** Activity category to station (docs/spec.md "World mapping"). */
export const STATION_BY_CATEGORY: Record<ActivityCategory, Station> = {
  research: "library",
  code: "workshop",
  terminal: "lab",
  review: "review",
  coordination: "hq",
};

/** State is always icon + label + colour, never colour alone. */
export const STATE_META: Record<ActorState, { icon: IconSvgElement; label: string }> = {
  starting: { icon: Rocket01Icon, label: "starting" },
  thinking: { icon: BrainIcon, label: "thinking" },
  working: { icon: HammerIcon, label: "working" },
  waiting_user: { icon: HandIcon, label: "needs you" },
  blocked: { icon: Fire02Icon, label: "blocked" },
  completed: { icon: PartyIcon, label: "completed" },
  idle: { icon: Coffee01Icon, label: "idle" },
  ended: { icon: DoorClosedIcon, label: "ended" },
  unknown: { icon: QuestionIcon, label: "unknown" },
};

export const ATTENTION_META: Record<AttentionType, { icon: IconSvgElement; label: string }> = {
  approval: { icon: HandIcon, label: "approval" },
  question: { icon: MessageQuestionIcon, label: "question" },
  error: { icon: AlertCircleIcon, label: "error" },
  stalled: { icon: HourglassIcon, label: "stalled" },
  conflict: { icon: AlertDiamondIcon, label: "conflict" },
  ready_review: { icon: PackageDelivered01Icon, label: "ready for review" },
  coverage_gap: { icon: Satellite01Icon, label: "coverage gap" },
};

/** Confidence is always icon + label + colour, never colour alone (docs/spec.md "Confidence"). */
export const CONFIDENCE_META: Record<Confidence, { icon: IconSvgElement; label: string }> = {
  verified: { icon: CheckmarkBadge01Icon, label: "verified" },
  observed: { icon: EyeIcon, label: "observed" },
  inferred: { icon: CircleQuestionMarkIcon, label: "inferred" },
};

/** Human label per receipt kind, for the warehouse delivery list. */
export const RECEIPT_KIND_LABEL: Record<ReceiptKind, string> = {
  task_completed: "Task completed",
  subagent_returned: "Subagent returned",
  turn_completed: "Turn completed",
  test_passed: "Test passed",
  test_failed: "Test failed",
  build_passed: "Build passed",
  build_failed: "Build failed",
  commit_created: "Commit created",
  failure_recovered: "Failure recovered",
  review_ready: "Review ready",
};

/** SSE connection lifecycle, surfaced next to the world so a stale view is never mistaken for live. */
export type ConnectionStatus = "connecting" | "live" | "reconnecting" | "no-token" | "unauthorized";

export const CONNECTION_META: Record<ConnectionStatus, { icon: IconSvgElement; label: string }> = {
  connecting: { icon: Loading03Icon, label: "connecting…" },
  live: { icon: WifiConnected01Icon, label: "live" },
  reconnecting: { icon: RefreshIcon, label: "reconnecting…" },
  "no-token": { icon: Key01Icon, label: "no stream token" },
  unauthorized: { icon: ShieldBanIcon, label: "token rejected" },
};

/** Character sprite mapping per agent source. Adding a source to the contract
 *  forces a sprite entry here via the Record key. */
export type ActorSpriteId = "sprite-claude" | "sprite-codex";

export const ACTOR_SPRITE_BY_SOURCE: Record<SourceId, ActorSpriteId> = {
  claude: "sprite-claude",
  codex: "sprite-codex",
};
