import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { acquireRegistry, freePort, readRegistry, releaseRegistry } from "#server/registry.js";

const tempRegistryFile = (): string => {
  return join(mkdtempSync(join(tmpdir(), "pockrew-reg-")), "server.json");
};

describe("server registry", () => {
  it("acquires with a free port, a 64-hex token and 0600 mode", async () => {
    const file = tempRegistryFile();
    const reg = await acquireRegistry(file);
    expect(reg.port).toBeGreaterThan(0);
    expect(reg.token).toMatch(/^[0-9a-f]{64}$/);
    expect(reg.pid).toBe(process.pid);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    releaseRegistry(file);
    expect(existsSync(file)).toBe(false);
  });

  it("refuses a second live instance", async () => {
    const file = tempRegistryFile();
    await acquireRegistry(file); // our own live pid
    await expect(acquireRegistry(file)).rejects.toThrow(/another pockrew instance/);
    releaseRegistry(file);
  });

  it("cleans up a stale registry from a dead pid", async () => {
    const file = tempRegistryFile();
    writeFileSync(file, JSON.stringify({ port: 1, token: "x", pid: 999999999, startedAt: 0 }));
    const reg = await acquireRegistry(file);
    expect(reg.pid).toBe(process.pid);
    releaseRegistry(file);
  });

  it("honors a preferred port when free and rejects when taken", async () => {
    const free = await freePort();
    expect(await freePort(free)).toBe(free);
    const { createServer } = await import("node:net");
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(free, "127.0.0.1", resolve));
    await expect(freePort(free)).rejects.toThrow();
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
  });

  it("returns null for a corrupt registry file instead of throwing", () => {
    const file = tempRegistryFile();
    writeFileSync(file, "{corrupt");
    expect(readRegistry(file)).toBeNull();
  });
});
