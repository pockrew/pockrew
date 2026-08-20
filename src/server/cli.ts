// pockrew CLI: start | setup | doctor | uninstall. One command each, no arg lib.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { serve } from "@hono/node-server";

import { claudeSettingsPath, install, MARKER, planInstall, uninstall } from "#adapters/claude/install.js";
import { openStore } from "#core/store/store.js";
import { checkDaemonCoverage, HEARTBEAT_KEY } from "#server/coverage.js";
import { createApp, type ServerState } from "#server/http.js";
import { acquireRegistry, readRegistry, registryPath, releaseRegistry } from "#server/registry.js";

/** Default `~/.pockrew/company.sqlite`, override via POCKREW_DB_PATH (e.g. for tests). */
const dbPath = (): string => process.env["POCKREW_DB_PATH"] ?? join(homedir(), ".pockrew", "company.sqlite");

const shimPath = (): string => {
  // The installed hook must run under plain node with no repo tooling, so it
  // always points at the built dist file — under tsx (dev) import.meta.url is
  // in src/, which holds only .ts sources node cannot execute.
  const resolved = fileURLToPath(new URL("../adapters/claude/shim.js", import.meta.url));
  const distPath = resolved.replace(`${sep}src${sep}`, `${sep}dist${sep}`);
  if (!existsSync(distPath)) {
    throw new Error(`shim not built at ${distPath} — run: pnpm build`);
  }
  return distPath;
};

const backupSuffix = (): string => {
  return new Date().toISOString().replace(/[:.]/g, "-");
};

const cmdStart = async (): Promise<void> => {
  const reg = await acquireRegistry();
  const path = dbPath();
  mkdirSync(dirname(path), { recursive: true });
  const store = openStore(path);
  checkDaemonCoverage(store, Date.now()); // compares against the *previous* heartbeat first
  store.setAppState(HEARTBEAT_KEY, String(Date.now()));
  const heartbeat = setInterval(() => store.setAppState(HEARTBEAT_KEY, String(Date.now())), 30_000);
  heartbeat.unref(); // never keeps the process alive on its own
  const state: ServerState = { token: reg.token, port: reg.port, store, startedAt: Date.now() };
  const app = createApp(state);
  const server = serve({ fetch: app.fetch, port: reg.port, hostname: "127.0.0.1" });
  console.log(`pockrew listening on 127.0.0.1:${reg.port} (registry: ${registryPath()})`);
  let stopping = false;
  const stop = (): void => {
    if (stopping) return; // a second SIGINT/SIGTERM during the drain must not re-run this
    stopping = true;
    clearInterval(heartbeat);
    store.setAppState(HEARTBEAT_KEY, String(Date.now())); // clean-shutdown heartbeat: no false gap next start
    server.close(() => {
      store.close();
      releaseRegistry();
      process.exit(0);
    });
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
};

const cmdSetup = (): void => {
  const changes = planInstall(claudeSettingsPath());
  if (changes.length === 0) {
    console.log("claude: already installed, nothing to do");
    return;
  }
  for (const ch of changes) console.log(`${ch.action}: ${ch.file} — ${ch.description}`);
  const result = install(claudeSettingsPath(), shimPath(), backupSuffix());
  console.log(result.backupPath ? `backup written: ${result.backupPath}` : "no backup needed (new file)");
  console.log("claude: hooks installed. Restart running Claude sessions to pick them up.");
};

const cmdUninstall = (): void => {
  const result = uninstall(claudeSettingsPath(), backupSuffix());
  console.log(result.message ?? `removed pockrew entries (backup: ${result.backupPath})`);
};

const cmdDoctor = async (): Promise<void> => {
  const checks: Array<{ id: string; ok: boolean; message: string }> = [];
  const reg = readRegistry();
  if (!reg)
    checks.push({ id: "registry", ok: false, message: `no registry at ${registryPath()} — run: pockrew start` });
  else {
    checks.push({ id: "registry", ok: true, message: `port ${reg.port}, pid ${reg.pid}` });
    try {
      const res = await fetch(`http://127.0.0.1:${reg.port}/api/health`, {
        headers: { "x-pockrew-token": reg.token },
        signal: AbortSignal.timeout(2000),
      });
      const body = (await res.json()) as { eventsStored?: number; degraded?: boolean };
      const status = body.degraded ? "degraded — see /api/health for repair guidance" : "reachable";
      checks.push({
        id: "daemon",
        ok: res.ok && !body.degraded,
        message: `${status}, ${body.eventsStored ?? 0} events stored`,
      });
    } catch {
      checks.push({ id: "daemon", ok: false, message: "registry exists but daemon unreachable (stale?)" });
    }
  }
  const settingsFile = claudeSettingsPath();
  const settingsRaw = existsSync(settingsFile) ? readFileSync(settingsFile, "utf8") : "";
  const installed = settingsRaw.includes(MARKER);
  checks.push({
    id: "claude-hooks",
    ok: installed,
    message: installed ? "hook shim installed" : "hook shim not installed — run: pockrew setup",
  });
  if (installed) {
    // The command is `node "<path>" # MARKER`; a missing file fails silently by
    // design (the shim never breaks Claude), so doctor must catch it instead.
    let installedShim: string | undefined;
    try {
      const settings = JSON.parse(settingsRaw) as {
        hooks?: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
      };
      for (const entries of Object.values(settings.hooks ?? {})) {
        for (const entry of entries) {
          for (const h of entry.hooks ?? []) {
            if (h.command?.includes(MARKER)) installedShim ??= /node "([^"]+)"/.exec(h.command)?.[1];
          }
        }
      }
    } catch {
      // unreadable settings: fall through with installedShim undefined
    }
    const shimOk = installedShim !== undefined && existsSync(installedShim);
    checks.push({
      id: "claude-shim-file",
      ok: shimOk,
      message: shimOk
        ? `shim exists: ${installedShim}`
        : `installed shim missing at ${installedShim ?? "?"} — run: pnpm build, then pockrew uninstall && pockrew setup`,
    });
  }
  for (const ch of checks) console.log(`${ch.ok ? "ok  " : "FAIL"} ${ch.id}: ${ch.message}`);
  process.exitCode = checks.every((ch) => ch.ok) ? 0 : 1;
};

const cmd = process.argv[2];
switch (cmd) {
  case "start":
    await cmdStart();
    break;
  case "setup":
    cmdSetup();
    break;
  case "doctor":
    await cmdDoctor();
    break;
  case "uninstall":
    cmdUninstall();
    break;
  default:
    console.log("usage: pockrew <start|setup|doctor|uninstall>");
    process.exitCode = cmd ? 1 : 0;
}
