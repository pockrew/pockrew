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

import type { ActorView, ProjectView, WorldState } from "#contracts/world.js";

import { ActorInspector } from "@/components/organisms/actor-inspector";
import { District } from "@/components/organisms/district";
import { isResting } from "@/lib/district-layout";
import {
  clampCamera,
  focusCamera,
  layoutDistricts,
  nearProjectIds,
  type Camera,
  type DistrictPlacement,
} from "@/lib/world-layout";

import styles from "./styles.module.css";

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
  projects: ProjectView[];
  actors: ActorView[];
  hiddenCount: number;
}> = ({ projects, actors, hiddenCount }) => (
  <div className="visually-hidden" role="region" aria-label="World overview">
    <ul>
      {projects.map((project) => {
        const own = actors.filter((a) => a.projectId === project.id);
        return (
          <li key={project.id}>
            {project.displayName}: {own.length} agents, {own.filter(isResting).length} resting,{" "}
            {project.openAttentionCount} needing you, {project.verifiedReceiptCount} verified deliveries
          </li>
        );
      })}
    </ul>
    <p>
      {hiddenCount === 0
        ? "No older projects hidden."
        : `${hiddenCount} older ${hiddenCount === 1 ? "project" : "projects"} hidden — no agent active there recently. Their deliveries stay in the warehouse.`}
    </p>
  </div>
);

/**
 * The world as one plane you drag across, Clash-of-Clans style: districts sit at computed
 * coordinates, the viewport is a camera, and clicking a base travels to it. The camera only ever
 * moves on a user gesture or towards the element that just took focus — nothing in a snapshot pans
 * it (docs/spec.md "Accessibility": "never auto-pan away from keyboard focus").
 */
export const World: FC<{ world: WorldState }> = ({ world }) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const planeRef = useRef<HTMLDivElement>(null);
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
  const [camera, setCamera] = useState({ x: 0, y: 0, smooth: false });
  const [idleExpanded, setIdleExpanded] = useState<Record<string, boolean>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Only districts with something alive or recent take a spot; the rest stay in data only.
  const near = useMemo(() => nearProjectIds(world), [world]);
  const projects = useMemo(() => world.projects.filter((p) => near.has(p.id)), [world.projects, near]);
  const plane = useMemo(() => layoutDistricts(projects), [projects]);
  const panBy = useCallback(
    (dx: number, dy: number) => {
      const el = viewportRef.current;
      const w = el?.clientWidth ?? 0;
      const h = el?.clientHeight ?? 0;
      setCamera((cam) => ({ ...clampCamera(cam.x + dx, cam.y + dy, plane, w, h), smooth: false }));
    },
    [plane],
  );
  const byId = new Map(world.actors.map((a) => [a.id, a]));
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
      event.currentTarget.setPointerCapture(event.pointerId);
      pannedRef.current = true;
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
    setSelectedId(actor.id);
  };

  const handleToggleIdle = (projectId: string) => {
    setIdleExpanded((current) => ({ ...current, [projectId]: !current[projectId] }));
  };

  const handleCloseInspector = () => setSelectedId(null);

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
          {projects.map((project, index) => {
            // layoutDistricts places one district per visible project, in order.
            const placement = plane.placements[index]!;
            return (
              <District
                key={project.id}
                project={project}
                actors={world.actors.filter((a) => a.projectId === project.id)}
                byId={byId}
                placement={placement}
                idleExpanded={idleExpanded[project.id] ?? false}
                {...(selectedId ? { selectedActorId: selectedId } : {})}
                onEnter={() => handleEnterDistrict(placement)}
                onFocusEnter={() => handleFocusDistrict(placement)}
                onToggleIdle={() => handleToggleIdle(project.id)}
                onSelectActor={handleSelectActor}
              />
            );
          })}
        </div>
      </div>
      {selected ? (
        <ActorInspector
          actor={selected}
          {...(selectedParent ? { parent: selectedParent } : {})}
          {...(selectedActivity ? { activity: selectedActivity } : {})}
          receipts={world.recentReceipts.filter((r) => r.actorId === selected.id)}
          attention={world.attention.filter(
            (i) => i.actorIds.includes(selected.id) && (i.status === "open" || i.status === "acknowledged"),
          )}
          projectName={projectNames.get(selected.projectId) ?? selected.projectId}
          now={world.generatedAt}
          onClose={handleCloseInspector}
        />
      ) : null}
      <WorldListMirror
        projects={projects}
        actors={world.actors}
        hiddenCount={world.projects.length - projects.length}
      />
    </div>
  );
};
