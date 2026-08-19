import { useEffect, type FC } from "react";

import { AttentionDrawer } from "./components/organisms/attention-drawer";
import { World } from "./components/organisms/world";
import { useWorldStore } from "./state";

export const WebEntry: FC = () => {
  const world = useWorldStore((s) => s.world);
  const connect = useWorldStore((s) => s.connect);
  useEffect(() => {
    connect();
  }, [connect]);
  if (!world) return <p className="app-connecting">Connecting…</p>;
  return (
    <div className="app">
      <main className="app-main">
        <World world={world} />
      </main>
      <AttentionDrawer items={world.attention} actors={world.actors} />
    </div>
  );
};
