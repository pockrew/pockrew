// Owner-only server registry at ~/.pockrew/server.json: free port, token, pid.
// The hook shim reads this fresh on every invocation, so ports are never
// hardcoded. Single-instance via pid liveness; stale files are cleaned safely.
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";

export type Registry = { port: number; token: string; pid: number; startedAt: number };

export const registryDir = (): string => {
  return join(homedir(), ".pockrew");
};

export const registryPath = (): string => {
  return join(registryDir(), "server.json");
};

export const readRegistry = (file: string = registryPath()): Registry | null => {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Registry;
  } catch {
    return null;
  }
};

const pidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * Pick the listening port: POCKREW_PORT pins one (fail loud if taken), otherwise
 * the OS assigns a free one. Ports are never hard-bound (rules/server.md).
 */
export const freePort = async (preferred?: number): Promise<number> => {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(preferred ?? 0, "127.0.0.1", () => {
      const address = srv.address();
      if (address === null || typeof address === "string") {
        srv.close();
        reject(new Error("could not allocate a port"));
        return;
      }
      const port = address.port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
};

/** Acquire the single-instance registry or throw if a live instance owns it. */
export const acquireRegistry = async (file: string = registryPath()): Promise<Registry> => {
  const existing = readRegistry(file);
  if (existing && pidAlive(existing.pid)) {
    throw new Error(`another pockrew instance is running (pid ${existing.pid}, port ${existing.port})`);
  }
  if (existing) rmSync(file, { force: true }); // stale registry: safe cleanup
  const pinned = process.env["POCKREW_PORT"] ? Number(process.env["POCKREW_PORT"]) : undefined;
  const port = await freePort(pinned).catch((err: unknown) => {
    throw pinned ? new Error(`POCKREW_PORT=${pinned} is not available: ${String(err)}`) : err;
  });
  const reg: Registry = {
    port,
    token: randomBytes(32).toString("hex"),
    pid: process.pid,
    startedAt: Date.now(),
  };
  mkdirSync(registryDir(), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(reg, null, 2) + "\n", { mode: 0o600 });
  chmodSync(file, 0o600);
  return reg;
};

export const releaseRegistry = (file: string = registryPath()): void => {
  const existing = readRegistry(file);
  if (existing && existing.pid === process.pid) rmSync(file, { force: true });
};
