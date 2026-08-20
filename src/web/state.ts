import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

import type { StreamMessage } from "#contracts/stream.js";
import type { WorldState } from "#contracts/world.js";

import { applyPatchOps } from "@/lib/apply-patch";
import type { ConnectionStatus } from "@/lib/world-meta";

type WorldStore = {
  world: WorldState | null;
  connection: ConnectionStatus;
  /** Parses the token from location.hash and opens the SSE stream. Returns a disposer to call on unmount. */
  connect: () => () => void;
};

/** Capped backoff: single-use tickets mean EventSource's own reconnect can never succeed. */
const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000];

const parseToken = (hash: string): string | null => {
  const match = /(?:^|[#&])token=([^&]+)/.exec(hash);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
};

/** Thrown by fetchTicket so callers can tell an auth rejection (don't retry) from a transient failure (do). */
class TicketError extends Error {
  constructor(readonly status: number) {
    super(`stream-ticket request failed: ${status}`);
  }
}

const fetchTicket = async (token: string): Promise<string> => {
  const res = await fetch("/api/stream-ticket", {
    method: "POST",
    headers: { "x-pockrew-token": token },
  });
  if (!res.ok) throw new TicketError(res.status);
  const body = (await res.json()) as { ticket: string };
  return body.ticket;
};

/**
 * Applies one raw SSE `data:` payload onto the store slice, exactly as the EventSource `onmessage`
 * handler does. Exported so message-boundary behaviour (snapshot then patch) is testable without a
 * real EventSource. Returns whether the message was a snapshot, so the caller can reset backoff.
 */
export const reduceStreamData = (
  draftState: { world: WorldState | null; connection: ConnectionStatus },
  raw: string,
): boolean => {
  const msg = JSON.parse(raw) as StreamMessage;
  if (msg.type === "snapshot") {
    draftState.world = msg.world;
    draftState.connection = "live";
    return true;
  }
  if (draftState.world) applyPatchOps(draftState.world, msg.ops);
  return false;
};

export const useWorldStore = create<WorldStore>()(
  immer((set) => {
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let disposed = false;

    const scheduleReconnect = (token: string) => {
      if (disposed) return;
      set((state) => {
        state.connection = "reconnecting";
      });
      const delay = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)]!;
      attempt += 1;
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => void openStream(token), delay);
    };

    const openStream = async (token: string): Promise<void> => {
      let ticket: string;
      try {
        ticket = await fetchTicket(token);
      } catch (err) {
        if (disposed) return;
        if (err instanceof TicketError && (err.status === 401 || err.status === 403)) {
          set((state) => {
            state.connection = "unauthorized";
          });
          return; // not retryable: the token itself was rejected
        }
        scheduleReconnect(token);
        return;
      }
      if (disposed) return;

      source?.close();
      const es = new EventSource(`/api/stream?ticket=${encodeURIComponent(ticket)}`);
      source = es;

      es.onmessage = (event: MessageEvent<string>) => {
        if (disposed) return;
        let isSnapshot = false;
        set((state) => {
          isSnapshot = reduceStreamData(state, event.data);
        });
        if (isSnapshot) attempt = 0;
      };

      es.onerror = () => {
        es.close();
        if (source === es) source = null;
        if (disposed) return;
        scheduleReconnect(token);
      };
    };

    return {
      world: null,
      connection: "connecting",
      connect: () => {
        disposed = false;
        attempt = 0;
        const token = parseToken(location.hash);
        if (!token) {
          set((state) => {
            state.connection = "no-token";
          });
          return () => {
            disposed = true;
          };
        }
        void openStream(token);
        return () => {
          disposed = true;
          clearTimeout(reconnectTimer);
          source?.close();
          source = null;
        };
      },
    };
  }),
);
