// Safe setup for the Claude adapter: parse config (never string-replace), backup
// before writing, atomic temp+rename, idempotent, preserve unknown keys and other
// apps' hooks. Uninstall removes only entries carrying MARKER. (spec: setup safety)
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { ConfigChange, InstallResult } from "#contracts/adapter.js";

export const MARKER = "pockrew-hook-v1";

/** Hooks Pockrew listens to. Every name verified against a real fixture or documented fallback (data-notes). */
const HOOK_EVENTS = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "Notification",
  "Stop",
  "SubagentStart",
  "SubagentStop",
  "TaskCompleted",
  "PermissionRequest",
] as const;

type HookEntry = { matcher?: string; hooks: Array<{ type: string; command?: string; [k: string]: unknown }> };
type Settings = { hooks?: Record<string, HookEntry[]>; [k: string]: unknown };

export const claudeSettingsPath = (): string => {
  return join(homedir(), ".claude", "settings.json");
};

export const shimCommand = (shimPath: string): string => {
  // MARKER in the command string is what uninstall matches on.
  return `node "${shimPath}" # ${MARKER}`;
};

const readSettings = (file: string): Settings => {
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, "utf8")) as Settings;
};

const atomicWrite = (file: string, settings: Settings): void => {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.pockrew-tmp`;
  writeFileSync(tmp, JSON.stringify(settings, null, 2) + "\n");
  renameSync(tmp, file);
};

const hasMarker = (entry: HookEntry): boolean => {
  return entry.hooks.some((h) => typeof h.command === "string" && h.command.includes(MARKER));
};

export const planInstall = (file: string): ConfigChange[] => {
  const settings = readSettings(file);
  const missing = HOOK_EVENTS.filter((ev) => !(settings.hooks?.[ev] ?? []).some(hasMarker));
  if (missing.length === 0) return [];
  return [
    {
      file,
      action: existsSync(file) ? "update" : "create",
      description: `Add Pockrew hook shim to: ${missing.join(", ")}`,
      ownedMarker: MARKER,
    },
  ];
};

export const install = (file: string, shimPath: string, backupSuffix: string): InstallResult => {
  const changes = planInstall(file);
  if (changes.length === 0) return { ok: true, applied: [], message: "already installed" };
  let backupPath: string | undefined;
  if (existsSync(file)) {
    backupPath = `${file}.backup-${backupSuffix}`;
    copyFileSync(file, backupPath);
  }
  const settings = readSettings(file);
  settings.hooks ??= {};
  for (const ev of HOOK_EVENTS) {
    const entries = (settings.hooks[ev] ??= []);
    if (!entries.some(hasMarker)) {
      entries.push({ hooks: [{ type: "command", command: shimCommand(shimPath), async: true }] });
    }
  }
  atomicWrite(file, settings);
  return { ok: true, applied: changes, ...(backupPath !== undefined ? { backupPath } : {}) };
};

export const uninstall = (file: string, backupSuffix: string): InstallResult => {
  if (!existsSync(file)) return { ok: true, applied: [], message: "nothing installed" };
  const settings = readSettings(file);
  if (!settings.hooks) return { ok: true, applied: [], message: "nothing installed" };
  let removed = false;
  for (const ev of Object.keys(settings.hooks)) {
    const entries = settings.hooks[ev];
    if (!entries) continue;
    const kept = entries.filter((e) => !hasMarker(e));
    if (kept.length !== entries.length) removed = true;
    if (kept.length === 0) delete settings.hooks[ev];
    else settings.hooks[ev] = kept;
  }
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  if (!removed) return { ok: true, applied: [], message: "nothing installed" };
  const backupPath = `${file}.backup-${backupSuffix}`;
  copyFileSync(file, backupPath);
  atomicWrite(file, settings);
  return {
    ok: true,
    applied: [{ file, action: "update", description: "Remove Pockrew hook entries", ownedMarker: MARKER }],
    backupPath,
  };
};
