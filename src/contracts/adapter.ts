// ❄️ FROZEN — repo owner must approve changes. Stop and propose a diff instead of editing.
// ConfigChange / InstallResult / HealthCheck are not yet confirmed against a real install run.

import type { RawSourceEvent } from "./events.js";

export type AdapterCapabilities = {
  lifecycle: "native" | "derived" | "none";
  toolActivity: "native" | "derived" | "none";
  subagents: "native" | "derived" | "none";
  fileChanges: "native" | "derived" | "none";
  completion: "native" | "derived" | "none";
  approvals: "respond" | "observe" | "none";
  questions: "observe" | "none";
};

/** One planned config change. planInstall() returns these for preview before any write. */
export type ConfigChange = {
  /** Absolute path of the file to be written, e.g. ~/.claude/settings.json. */
  file: string;
  action: "create" | "update" | "remove";
  /** Human-readable, shown in the preview. */
  description: string;
  /** Lets uninstall remove only Pockrew's entries, never another app's config. */
  ownedMarker: string;
};

export type InstallResult = {
  ok: boolean;
  applied: ConfigChange[];
  /** Backup written before the change. Required whenever an update or remove is applied. */
  backupPath?: string;
  message?: string;
};

export type HealthCheck = {
  id: string;
  status: "ok" | "warn" | "fail";
  message: string;
  /** Suggested user action. Pockrew never self-heals config. */
  remedy?: string;
};

export interface AgentAdapter {
  id: "claude" | "codex";
  capabilities: AdapterCapabilities;
  detect(): Promise<{ installed: boolean; version?: string; paths: string[] }>;
  planInstall(): Promise<ConfigChange[]>;
  install(): Promise<InstallResult>;
  uninstall(): Promise<InstallResult>;
  health(): Promise<HealthCheck[]>;
  start(emit: (event: RawSourceEvent) => void): Promise<() => Promise<void>>;
}
