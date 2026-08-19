import { expect, test } from "vitest";

import { mockWorld } from "./world";

test("mock world is referentially consistent", () => {
  const projectIds = new Set(mockWorld.projects.map((p) => p.id));
  const actorIds = new Set(mockWorld.actors.map((a) => a.id));
  const attentionIds = new Set(mockWorld.attention.map((a) => a.id));

  for (const actor of mockWorld.actors) {
    expect(projectIds.has(actor.projectId)).toBe(true);
    if (actor.parentActorId) expect(actorIds.has(actor.parentActorId)).toBe(true);
    for (const id of actor.attentionIds) expect(attentionIds.has(id)).toBe(true);
  }
  for (const project of mockWorld.projects) {
    for (const id of project.actorIds) expect(actorIds.has(id)).toBe(true);
  }
  for (const activity of mockWorld.activities) {
    expect(actorIds.has(activity.actorId)).toBe(true);
    expect(projectIds.has(activity.projectId)).toBe(true);
  }
  for (const item of [...mockWorld.attention, ...mockWorld.recentReceipts]) {
    expect(projectIds.has(item.projectId)).toBe(true);
  }

  // The fixture must exercise the states the renderer has to handle.
  const states = new Set(mockWorld.actors.map((a) => a.state));
  for (const s of ["working", "thinking", "waiting_user", "blocked", "completed", "idle"]) {
    expect(states.has(s as never)).toBe(true);
  }
  expect(mockWorld.actors.some((a) => a.parentActorId)).toBe(true);
});
