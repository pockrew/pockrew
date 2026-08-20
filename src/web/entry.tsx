import { useEffect, type FC } from "react";

import { ConnectionBadge } from "./components/molecules/connection-badge";
import { AttentionDrawer } from "./components/organisms/attention-drawer";
import { Warehouse } from "./components/organisms/warehouse";
import { World } from "./components/organisms/world";
import { useWorldStore } from "./state";

export const WebEntry: FC = () => {
  const world = useWorldStore((s) => s.world);
  const connection = useWorldStore((s) => s.connection);
  const connect = useWorldStore((s) => s.connect);
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
      <main className="app-main">
        <ConnectionBadge status={connection} />
        {/* The map owns its own pan gesture, so the warehouse lives beside it, not on the plane. */}
        <World world={world} />
        <Warehouse receipts={world.recentReceipts} projectNames={projectNames} now={world.generatedAt} />
      </main>
      <AttentionDrawer items={world.attention} actors={world.actors} />
    </div>
  );
};
