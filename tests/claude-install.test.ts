import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { install, MARKER, planInstall, uninstall } from "#adapters/claude/install.js";

const SHIM = "/opt/pockrew/shim.js";

/** A settings file with someone else's config that must survive untouched. */
const foreignSettings = (): Record<string, unknown> => {
  return {
    model: "opus",
    permissions: { allow: ["Bash(npm *)"] },
    hooks: {
      UserPromptSubmit: [{ hooks: [{ type: "command", command: "other-app prompt-hook" }] }],
    },
  };
};

const tempSettingsFile = (content?: Record<string, unknown>): string => {
  const file = join(mkdtempSync(join(tmpdir(), "pockrew-test-")), "settings.json");
  if (content) writeFileSync(file, JSON.stringify(content, null, 2));
  return file;
};

describe("claude adapter setup safety", () => {
  it("installs into an existing settings file, preserving unknown keys and other hooks", () => {
    const file = tempSettingsFile(foreignSettings());
    const result = install(file, SHIM, "t1");
    expect(result.ok).toBe(true);
    expect(result.backupPath).toBeDefined();
    const after = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    expect(after["model"]).toBe("opus");
    expect(after["permissions"]).toEqual({ allow: ["Bash(npm *)"] });
    const hooks = after["hooks"] as Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    expect(hooks["UserPromptSubmit"]?.some((e) => e.hooks[0]?.command === "other-app prompt-hook")).toBe(true);
    expect(hooks["UserPromptSubmit"]?.some((e) => e.hooks[0]?.command.includes(MARKER))).toBe(true);
    expect(hooks["PermissionRequest"]?.[0]?.hooks[0]?.command).toContain(MARKER);
  });

  it("is idempotent: installing twice adds nothing and plans nothing", () => {
    const file = tempSettingsFile(foreignSettings());
    install(file, SHIM, "t1");
    const once = readFileSync(file, "utf8");
    expect(planInstall(file)).toEqual([]);
    const second = install(file, SHIM, "t2");
    expect(second.applied).toEqual([]);
    expect(readFileSync(file, "utf8")).toBe(once);
  });

  it("uninstall removes only pockrew entries and leaves foreign config intact", () => {
    const file = tempSettingsFile(foreignSettings());
    install(file, SHIM, "t1");
    const result = uninstall(file, "t3");
    expect(result.ok).toBe(true);
    const after = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    const raw = JSON.stringify(after);
    expect(raw).not.toContain(MARKER);
    expect(raw).toContain("other-app prompt-hook");
    expect(after["model"]).toBe("opus");
  });

  it("creates a fresh settings file when none exists, and uninstall on empty is a no-op", () => {
    const file = tempSettingsFile();
    expect(uninstall(file, "t0").message).toBe("nothing installed");
    const result = install(file, SHIM, "t1");
    expect(result.ok).toBe(true);
    expect(result.backupPath).toBeUndefined();
    expect(readFileSync(file, "utf8")).toContain(MARKER);
  });
});
