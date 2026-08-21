import { useEffect, useState, type FC } from "react";

import { ConnectionBadge } from "./components/molecules/connection-badge";
import { AttentionDrawer } from "./components/organisms/attention-drawer";
import { DeliveriesHud } from "./components/organisms/deliveries-hud";
import { World } from "./components/organisms/world";
import { useWorldStore } from "./state";

/**
 * The page is the world. Everything else — connection chip, attention tracker, deliveries
 * inbox, and the inspector the world itself summons — floats over it as fixed HUD pieces, each
 * positioned from the `--hud-*` / `--z-*` tokens in styles.css.
 */
export const WebEntry: FC = () => {
  const world = useWorldStore((s) => s.world);
  const connection = useWorldStore((s) => s.connection);
  const connect = useWorldStore((s) => s.connect);
  /** The inspector and the deliveries sheet share the bottom of a phone screen; only one may hold it. */
  const [inspecting, setInspecting] = useState(false);
  useEffect(() => {
    const dispose = connect();
    return dispose;
  }, [connect]);
  if (connection === "no-token") {
    return (
      <div className="app-connecting">
        <ConnectionBadge status={connection} />
        <p>No stream token in the URL — open Pockrew from the desktop app link, not a bare address.</p>
      </div>
    );
  }
  if (!world) {
    return (
      <div className="app-connecting">
        <ConnectionBadge status={connection} />
      </div>
    );
  }
  const projectNames = new Map(world.projects.map((p) => [p.id, p.displayName]));
  return (
    <div className="app">
      <World world={world} onInspect={setInspecting} />
      <ConnectionBadge status={connection} />
      <AttentionDrawer items={world.attention} actors={world.actors} />
      <DeliveriesHud
        receipts={world.recentReceipts}
        projectNames={projectNames}
        now={world.generatedAt}
        yieldTo={inspecting}
      />
    </div>
  );
};
