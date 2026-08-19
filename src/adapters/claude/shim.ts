// Hook shim installed into ~/.claude/settings.json. Reads the hook payload from
// stdin, reads the server registry fresh each invocation (the port is never
// hardcoded — spec: security), POSTs to the daemon. Always exits 0 fast and
// silent: a down or broken Pockrew must never break the user's Claude session.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const main = async (): Promise<void> => {
  const body = readFileSync(0, "utf8");
  const reg = JSON.parse(readFileSync(join(homedir(), ".pockrew", "server.json"), "utf8")) as {
    port: number;
    token: string;
  };
  await fetch(`http://127.0.0.1:${reg.port}/event`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-pockrew-token": reg.token },
    body,
    signal: AbortSignal.timeout(1500),
  });
};

main()
  .catch(() => {})
  .finally(() => process.exit(0));
