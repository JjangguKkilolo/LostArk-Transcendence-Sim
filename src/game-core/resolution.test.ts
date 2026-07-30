import assert from "node:assert/strict";
import test from "node:test";

import {
  createElzowinAttackPlan,
  createFixedAttackPlan,
  createLightningAttackPlan,
} from "./attacks.ts";
import { createBoardSetup, positionKey } from "./board.ts";
import type { RandomSource } from "./random.ts";
import { SeededRandom } from "./random.ts";
import { resolveAttackPlan } from "./resolution.ts";
import type { SpiritCard } from "./spirits.ts";
import { getBoardDefinition } from "../game-data/boards.ts";

class SequenceRandom implements RandomSource {
  #values: number[];

  constructor(values: readonly number[]) {
    this.#values = [...values];
  }

  nextUint32(): number {
    return this.#take();
  }

  nextFloat(): number {
    return this.#take() / 0x1_0000_0000;
  }

  nextInt(maxExclusive: number): number {
    const value = this.#take();
    if (value < 0 || value >= maxExclusive) {
      throw new Error("Sequence value is outside the requested range.");
    }
    return value;
  }

  #take(): number {
    const value = this.#values.shift();
    if (value === undefined) {
      throw new Error("SequenceRandom has no values left.");
    }
    return value;
  }
}

test("a distorted hit survives and restores three ancient tiles", () => {
  const definition = getBoardDefinition("WEAPON", 1);
  const fullBoard = createBoardSetup(definition, 0, new SeededRandom(1)).board;
  const board = {
    ...fullBoard,
    tiles: fullBoard.tiles.filter(({ position }) =>
      !["1,4", "2,4", "3,2"].includes(positionKey(position)),
    ),
  };
  const plan = createFixedAttackPlan(
    definition,
    board,
    normalCard("THUNDER_STRIKE", 2),
    { row: 1, column: 3 },
  );
  const result = resolveAttackPlan(
    definition,
    board,
    plan,
    new SequenceRandom([0, 0, 0]),
  );

  assert.equal(
    result.events.filter(({ type }) => type === "DISTORTED_HIT").length,
    1,
  );
  const restoration = result.events.find(
    ({ type }) => type === "TILES_RESTORED",
  );
  assert.ok(restoration?.type === "TILES_RESTORED");
  assert.equal(restoration.requestedCount, 3);
  assert.equal(restoration.tiles.length, 3);
  assert.ok(
    result.board.tiles.some(
      ({ position, kind }) =>
        positionKey(position) === "1,2" && kind === "DISTORTED",
    ),
  );
});

test("Elzowin destroys distorted tiles without restoration", () => {
  const definition = getBoardDefinition("WEAPON", 1);
  const board = createBoardSetup(definition, 0, new SeededRandom(1)).board;
  const plan = createElzowinAttackPlan(
    definition,
    board,
    normalCard("PURIFY", 3),
    { row: 2, column: 2 },
  );
  const result = resolveAttackPlan(
    definition,
    board,
    plan,
    new SequenceRandom([]),
  );

  assert.equal(
    result.events.filter(({ type }) => type === "DISTORTED_HIT").length,
    0,
  );
  assert.equal(
    result.events.filter(({ type }) => type === "TILES_RESTORED").length,
    0,
  );
  assert.ok(
    !result.board.tiles.some(
      ({ position }) => positionKey(position) === "2,2",
    ),
  );
});

test("lightning applies its primary hit before its follow-up", () => {
  const definition = getBoardDefinition("SHOULDERS", 1);
  const board = createBoardSetup(definition, 0, new SeededRandom(1)).board;
  const spirit = normalCard("LIGHTNING", 1);
  const plan = createLightningAttackPlan(
    definition,
    board,
    spirit,
    { row: 2, column: 2 },
  );
  const result = resolveAttackPlan(
    definition,
    board,
    plan,
    new SequenceRandom([0, 0]),
  );

  assert.equal(result.board.tiles.length, board.tiles.length);
  assert.ok(
    result.events.some(
      (event) =>
        event.type === "TILE_DESTROYED" &&
        event.cause === "PRIMARY_ATTACK",
    ),
  );
  assert.ok(
    result.events.some(
      (event) =>
        event.type === "TILES_RESTORED" &&
        event.cause === "LIGHTNING_FOLLOW_UP",
    ),
  );
});

test("resolution rejects a stale attack plan before consuming randomness", () => {
  const definition = getBoardDefinition("SHOULDERS", 1);
  const board = createBoardSetup(definition, 0, new SeededRandom(1)).board;
  const plan = createFixedAttackPlan(
    definition,
    board,
    normalCard("THUNDER_STRIKE", 1),
    { row: 2, column: 2 },
  );
  const changedBoard = {
    ...board,
    tiles: board.tiles.filter(
      ({ position }) => positionKey(position) !== "2,2",
    ),
  };

  assert.throws(
    () =>
      resolveAttackPlan(
        definition,
        changedBoard,
        plan,
        new SequenceRandom([]),
      ),
    /does not match the current board snapshot/,
  );
});

function normalCard(
  spiritId: "LIGHTNING" | "PURIFY" | "SHOCKWAVE" | "THUNDER_STRIKE",
  level: 1 | 2 | 3,
): SpiritCard {
  return {
    instanceId: `card:${spiritId}:${level}`,
    spiritId,
    category: "NORMAL",
    level,
  };
}
