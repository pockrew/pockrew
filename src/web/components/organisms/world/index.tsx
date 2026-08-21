import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FC,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import type { UserIntent } from "#contracts/intents.js";
import type { ActorView, ProjectView, WorldState } from "#contracts/world.js";

import { ActorInspector } from "@/components/organisms/actor-inspector";
import { CrewRoster } from "@/components/organisms/crew-roster";
import { District } from "@/components/organisms/district";
import { isOpenAttention } from "@/lib/attention";
import { isResting, layoutDistrict, type DistrictLayout } from "@/lib/district-layout";
import {
  clampCamera,
  focusCamera,
  layoutDistricts,
  mostRelevantProjectId,
  nearProjectIds,
  widestTown,
  type Camera,
  type DistrictPlacement,
} from "@/lib/world-layout";

import styles from "./styles.module.css";

/** One town: its project, the actors standing in it, and the layout both the canvas and the mirror read. */
type Town = { project: ProjectView; actors: ActorView[]; layout: DistrictLayout };

/** One arrow-key press of travel. */
const PAN_STEP = 96;
/** Pointer slack before a press becomes a pan — below it, the gesture is still a click. */
const DRAG_SLOP = 6;

const ARROW_PAN: Record<string, readonly [number, number]> = {
  ArrowLeft: [-PAN_STEP, 0],
  ArrowRight: [PAN_STEP, 0],
  ArrowUp: [0, -PAN_STEP],
  ArrowDown: [0, PAN_STEP],
};

/**
 * Overview of the plane for keyboard and screen readers (docs/spec.md "Accessibility": "the canvas
 * has a list mirror"). Per-actor detail is not repeated here: every chip is a real button with a
 * full accessible name, so duplicating it would announce each agent twice. What the canvas cannot
 * say in words lives here instead — which bases exist, how crowded they are, how many actors a
 * district has folded away, and how many stale projects are off the plane entirely.
 */
const WorldListMirror: FC<{
  towns: Town[];
  hiddenCount: number;
  openAttention: number;
  deliveries: number;
}> = ({ towns, hiddenCount, openAttention, deliveries }) => (
  <div className="visually-hidden" role="region" aria-label="World overview">
    <p>
      {openAttention} open attention {openAttention === 1 ? "item" : "items"} in the tracker, {deliveries} recent{" "}
      {deliveries === 1 ? "delivery" : "deliveries"} in the warehouse.
    </p>
    <ul>
      {towns.map(({ project, actors, layout }) => (
        <li key={project.id}>
          {project.displayName}: {actors.length} agents, {actors.filter(isResting).length} resting,{" "}
          {project.openAttentionCount} needing you, {project.verifiedReceiptCount} verified deliveries. Stations built:{" "}
          {/* Read straight off the layout the canvas renders, so the two can never drift apart. */}
          {layout.stations.map((s) => s.label).join(", ")}
        </li>
      ))}
    </ul>
    <p>
      {hiddenCount === 0
        ? "No older projects hidden."
        : `${hiddenCount} older ${hiddenCount === 1 ? "project" : "projects"} hidden — no agent active there recently. Their deliveries stay in the warehouse.`}
    </p>
  </div>
);

/** Deep-focus request (attention tracker → this actor): `at` distinguishes repeat clicks. */
export type FocusRequest = { actorId: string; at: number };

/**
 * The world as one plane you drag across, Clash-of-Clans style: districts sit at computed
 * coordinates, the viewport is a camera, and clicking a base travels to it. The camera only ever
 * moves on a user gesture or towards the element that just took focus — nothing in a snapshot pans
 * it (docs/spec.md "Accessibility": "never auto-pan away from keyboard focus"). The one exception
 * is `focusRequest`: an explicit user click in the attention tracker, which is a gesture too.
 */
export const World: FC<{
  world: WorldState;
  onInspect?: (open: boolean) => void;
  focusRequest?: FocusRequest | null;
  onIntent?: (intent: UserIntent) => void;
}> = ({ world, onInspect, focusRequest, onIntent }) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const planeRef = useRef<HTMLDivElement>(null);
  /** The one-shot camera placement on the first snapshot. */
  const openedRef = useRef(false);
  /**
   * When this tab started watching. A character whose `startedAt` is later than this really did turn
   * up in front of the user and gets the walk out of HQ; the crew that was already there on the first
   * snapshot must never be animated in, or every reload would parade the whole town.
   */
  const watchingSinceRef = useRef(world.generatedAt);
  /** Set by every user camera move. Once true, nothing in the data may place the camera. */
  const movedRef = useRef(false);
  const dragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    camX: number;
    camY: number;
    next?: Camera;
  } | null>(null);
  /** True while the press that is ending turned into a pan, so its click is swallowed once. */
  const pannedRef = useRef(false);
  /** The `at` of the last deep-focus request already handled. */
  const handledFocusRef = useRef(0);
  const [camera, setCamera] = useState({ x: 0, y: 0, smooth: false });
  /** The folded crowd whose roster drawer is open, if any. */
  const [crew, setCrew] = useState<{ projectId: string; key: string } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Only districts with something alive or recent take a spot; the rest stay in data only.
  const near = useMemo(() => nearProjectIds(world), [world]);
  const projects = useMemo(() => world.projects.filter((p) => near.has(p.id)), [world.projects, near]);
  // One layout per town, built here so the plane can pace its grid by the widest one and the list
  // mirror can announce exactly what the canvas draws.
  const towns = useMemo<Town[]>(
    () =>
      projects.map((project) => {
        const own = world.actors.filter((a) => a.projectId === project.id);
        return {
          project,
          actors: own,
          layout: layoutDistrict({
            project,
            actors: own,
            activities: world.activities.filter((a) => a.projectId === project.id),
            now: world.generatedAt,
          }),
        };
      }),
    [projects, world.actors, world.activities, world.generatedAt],
  );
  const plane = useMemo(
    () => layoutDistricts(projects, widestTown(towns.map((t) => t.layout.side))),
    [projects, towns],
  );
  const panBy = useCallback(
    (dx: number, dy: number) => {
      // A zero step is the resize re-clamp, not a gesture; only real travel counts as the user
      // taking the camera.
      if (dx !== 0 || dy !== 0) movedRef.current = true;
      const el = viewportRef.current;
      const w = el?.clientWidth ?? 0;
      const h = el?.clientHeight ?? 0;
      setCamera((cam) => ({ ...clampCamera(cam.x + dx, cam.y + dy, plane, w, h), smooth: false }));
    },
    [plane],
  );
  const byId = new Map(world.actors.map((a) => [a.id, a]));
  const activityById = new Map(world.activities.map((a) => [a.id, a]));
  const projectNames = new Map(world.projects.map((p) => [p.id, p.displayName]));
  const selected = selectedId === null ? undefined : byId.get(selectedId);
  const selectedParent = selected?.parentActorId ? byId.get(selected.parentActorId) : undefined;
  const selectedActivity = selected?.currentActivityId
    ? world.activities.find((a) => a.id === selected.currentActivityId)
    : undefined;

  /** A click that ended a pan is swallowed once — the flag must not outlive its own gesture. */
  const consumePan = () => {
    if (!pannedRef.current) return false;
    pannedRef.current = false;
    return true;
  };

  const travelTo = (placement: DistrictPlacement) => {
    movedRef.current = true;
    const el = viewportRef.current;
    setCamera({
      ...focusCamera(placement, plane, el?.clientWidth ?? 0, el?.clientHeight ?? 0),
      smooth: true,
    });
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current) return; // a second finger mid-drag must not restart the gesture
    if (event.pointerType === "mouse" && event.button !== 0) return;
    pannedRef.current = false;
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      camX: camera.x,
      camY: camera.y,
    };
    if (selectedId !== null) setSelectedId(null); // pressing the plane dismisses the inspector
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!pannedRef.current && Math.abs(dx) < DRAG_SLOP && Math.abs(dy) < DRAG_SLOP) return;
    if (!pannedRef.current) {
      // Captured only once the press became a pan: a plain click still reaches the chip or
      // nameplate underneath, while a fast drag that leaves the viewport keeps panning.
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // The pointer was already released before this move was dispatched. Panning still works
        // without capture, so a lost capture must never abort the gesture.
      }
      pannedRef.current = true;
      movedRef.current = true;
    }
    const el = viewportRef.current;
    const next = clampCamera(drag.camX - dx, drag.camY - dy, plane, el?.clientWidth ?? 0, el?.clientHeight ?? 0);
    drag.next = next;
    // Written straight to the node: a pan must not re-render every chip on every frame.
    // React reconciles the same value from state on pointerup.
    if (planeRef.current) {
      planeRef.current.style.transitionDuration = "0ms";
      planeRef.current.style.transform = `translate(${-next.x}px, ${-next.y}px)`;
    }
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (drag.next) setCamera({ ...drag.next, smooth: false });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = ARROW_PAN[event.key];
    if (!step) return;
    event.preventDefault();
    panBy(step[0], step[1]);
  };

  /** Pointer route into a base: ignored when the click was the tail of a pan. */
  const handleEnterDistrict = (placement: DistrictPlacement) => {
    if (consumePan()) return;
    travelTo(placement);
  };

  /**
   * Focus route into a base. Never consults the pan flag — a keyboard focus must always bring the
   * camera to what it just focused. Skipped only while a pointer is down, because a mouse press
   * focuses the nameplate before the drag it is about to start.
   */
  const handleFocusDistrict = (placement: DistrictPlacement) => {
    if (dragRef.current) return;
    travelTo(placement);
  };

  const handleSelectActor = (actor: ActorView) => {
    if (consumePan()) return;
    setCrew(null);
    setSelectedId(actor.id);
  };

  const handleOpenCrew = (projectId: string, key: string) => {
    if (consumePan()) return;
    setSelectedId(null); // the roster and the inspector share the same panel spot
    setCrew({ projectId, key });
  };

  const handleCloseInspector = () => setSelectedId(null);
  const handleCloseCrew = () => setCrew(null);

  // The open roster's live cluster — re-found every render so it tracks patches; a crowd that
  // dissolved (actors moved on) simply closes the drawer.
  const openCrew = crew
    ? towns.find((t) => t.project.id === crew.projectId)?.layout.clusters.find((c) => c.key === crew.key)
    : undefined;

  useEffect(() => {
    onInspect?.(selectedId !== null || openCrew !== undefined);
  }, [selectedId, openCrew, onInspect]);

  useEffect(() => {
    // Deep-focus from the attention tracker: travel to the actor's district and open its
    // inspector. Guarded by `at` so world patches re-running this effect never re-pan — only a
    // fresh click does (docs/spec.md: the camera moves on user gestures only, and this is one).
    if (!focusRequest || focusRequest.at === handledFocusRef.current) return;
    handledFocusRef.current = focusRequest.at;
    const actor = byId.get(focusRequest.actorId);
    if (!actor) return; // the actor left the world between the click and this frame
    const index = projects.findIndex((p) => p.id === actor.projectId);
    const placement = plane.placements[index];
    if (placement) travelTo(placement);
    setSelectedId(actor.id);
    // The `at` guard is the real dependency gate: byId/projects/plane/travelTo are rebuilt every
    // render, so listing them would be equivalent to no list — the guard keeps re-runs no-ops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest]);

  useEffect(() => {
    // First snapshot only: start the camera on the district that most wants the user. Later
    // patches never move it, and focus is never taken — only the camera moves.
    if (openedRef.current) return;
    // Armed on the first snapshot even when it placed no district: a world whose bases are all
    // stale must not arm late and then pan on a later data event (docs/spec.md: no surprise
    // auto-pan). And once the user has taken the camera, the opening shot is simply skipped.
    openedRef.current = true;
    if (movedRef.current || projects.length === 0) return;
    const target = mostRelevantProjectId(
      world,
      projects.map((p) => p.id),
    );
    const index = projects.findIndex((p) => p.id === target);
    const placement = plane.placements[index === -1 ? 0 : index];
    if (!placement) return;
    const el = viewportRef.current;
    setCamera({ ...focusCamera(placement, plane, el?.clientWidth ?? 0, el?.clientHeight ?? 0), smooth: false });
  }, [projects, plane, world]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    // Registered by hand and non-passive: a trackpad pan must move the world, not the page.
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      panBy(event.deltaX, event.deltaY);
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    // A smaller viewport can leave the camera past the plane edge; re-clamp on resize.
    const observer = new ResizeObserver(() => panBy(0, 0));
    observer.observe(el);
    return () => {
      el.removeEventListener("wheel", handleWheel);
      observer.disconnect();
    };
  }, [panBy]);

  return (
    <div className={styles.world}>
      <div
        ref={viewportRef}
        className={styles.viewport}
        role="group"
        aria-label="World map — drag to travel, arrow keys to pan"
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onKeyDown={handleKeyDown}
      >
        <div
          ref={planeRef}
          className={styles.plane}
          style={
            {
              width: `${plane.width}px`,
              height: `${plane.height}px`,
              transform: `translate(${-camera.x}px, ${-camera.y}px)`,
              transitionDuration: camera.smooth ? undefined : "0ms",
            } as CSSProperties
          }
        >
          {towns.map(({ project, actors, layout }, index) => {
            // layoutDistricts places one district per visible project, in order.
            const placement = plane.placements[index]!;
            return (
              <District
                key={project.id}
                project={project}
                layout={layout}
                actorCount={actors.length}
                byId={byId}
                activityById={activityById}
                placement={placement}
                spawnedSince={watchingSinceRef.current}
                {...(selectedId ? { selectedActorId: selectedId } : {})}
                onEnter={() => handleEnterDistrict(placement)}
                onFocusEnter={() => handleFocusDistrict(placement)}
                onOpenCrew={(cluster) => handleOpenCrew(project.id, cluster.key)}
                onSelectActor={handleSelectActor}
              />
            );
          })}
        </div>
      </div>
      {openCrew && !selected ? (
        <CrewRoster
          title={openCrew.label}
          actors={openCrew.actors}
          onSelect={handleSelectActor}
          onClose={handleCloseCrew}
        />
      ) : null}
      {selected ? (
        <ActorInspector
          actor={selected}
          {...(selectedParent ? { parent: selectedParent } : {})}
          {...(selectedActivity ? { activity: selectedActivity } : {})}
          receipts={world.recentReceipts.filter((r) => r.actorId === selected.id)}
          attention={world.attention.filter((i) => i.actorIds.includes(selected.id) && isOpenAttention(i))}
          projectName={projectNames.get(selected.projectId) ?? selected.projectId}
          now={world.generatedAt}
          onClose={handleCloseInspector}
          {...(onIntent ? { onIntent } : {})}
        />
      ) : null}
      <WorldListMirror
        towns={towns}
        hiddenCount={world.projects.length - projects.length}
        openAttention={world.attention.filter(isOpenAttention).length}
        deliveries={world.recentReceipts.length}
      />
    </div>
  );
};
