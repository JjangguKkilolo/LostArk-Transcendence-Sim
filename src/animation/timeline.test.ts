import assert from "node:assert/strict";
import test from "node:test";

import type { GameEvent } from "../game-core/game.ts";
import { createAnimationCue, createAnimationTimeline } from "./timeline.ts";

test("timeline batches simultaneous tile events and preserves phase order", () => {
  const events: GameEvent[] = [
    {
      type: "SPIRIT_CAST",
      activeIndex: 0,
      spirit: {
        instanceId: "card",
        spiritId: "SHOCKWAVE",
        category: "NORMAL",
        level: 1,
      },
      target: { row: 1, column: 1 },
    },
    hit("a"),
    hit("b"),
    destroyed("a"),
    destroyed("b"),
    {
      type: "TURN_COMPLETED",
      actionCount: 1,
      summonCount: 1,
    },
  ];
  const timeline = createAnimationTimeline(events);

  assert.deepEqual(
    timeline.map(({ phase }) => phase),
    ["CAST", "HIT", "DESTROY", "COMPLETE"],
  );
  assert.equal(timeline[1]?.events.length, 2);
  assert.equal(timeline[2]?.events.length, 2);
  assert.ok(timeline.every(({ durationMs }) => durationMs > 0));
});

test("animation cue targets only event positions and marks failed hits", () => {
  const timeline = createAnimationTimeline([
    hit("a"),
    hit("b", { row: 2, column: 3 }, false),
  ]);
  const frame = timeline[0];
  assert.ok(frame);
  const cue = createAnimationCue(frame, "THUNDER_STRIKE");

  assert.equal(cue.style, "LIGHTNING");
  assert.deepEqual(cue.affectedPositions, [
    { row: 0, column: 0 },
    { row: 2, column: 3 },
  ]);
  assert.deepEqual(cue.failedPositions, [{ row: 2, column: 3 }]);
});

function hit(
  tileId: string,
  position = { row: 0, column: 0 },
  destroyed = true,
): GameEvent {
  return {
    type: "TILE_HIT_ROLLED",
    candidate: {
      tileId,
      position,
      tileKind: "ANCIENT",
      destroyChance: 10_000,
    },
    destroyed,
  };
}

function destroyed(tileId: string): GameEvent {
  return {
    type: "TILE_DESTROYED",
    tile: {
      id: tileId,
      position: { row: 0, column: 0 },
      kind: "ANCIENT",
    },
    cause: "PRIMARY_ATTACK",
  };
}
