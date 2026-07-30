import assert from "node:assert/strict";
import test from "node:test";

import {
  createBoardSetup,
  createPlayablePositions,
  validateBoardDefinition,
} from "./board.ts";
import { SeededRandom } from "./random.ts";
import type { BoardDefinition } from "./types.ts";
import {
  BOARD_DEFINITIONS,
  getBoardDefinition,
} from "../game-data/boards.ts";

const EXPECTED_PLAYABLE_COUNTS = {
  WEAPON: [24, 25, 40],
  HELMET: [32, 37, 52],
  SHOULDERS: [36, 49, 64],
  CHEST: [24, 25, 40],
  PANTS: [36, 49, 64],
  GLOVES: [32, 37, 52],
} as const;

test("all 42 classic board definitions are valid and unique", () => {
  assert.equal(BOARD_DEFINITIONS.length, 42);

  const ids = new Set<string>();
  for (const definition of BOARD_DEFINITIONS) {
    validateBoardDefinition(definition);
    ids.add(`${definition.id.equipmentPart}:${definition.id.stage}`);
  }

  assert.equal(ids.size, 42);
});

test("each shape creates the documented playable cell count", () => {
  for (const definition of BOARD_DEFINITIONS) {
    const sizeIndex = definition.size === 6 ? 0 : definition.size === 7 ? 1 : 2;
    const expected =
      EXPECTED_PLAYABLE_COUNTS[definition.id.equipmentPart][sizeIndex];

    assert.equal(
      createPlayablePositions(definition).length,
      expected,
      `${definition.id.equipmentPart} stage ${definition.id.stage}`,
    );
  }
});

test("grace normalizes deterministic distorted tiles and adds rerolls", () => {
  const definition = getBoardDefinition("WEAPON", 1);
  const first = createBoardSetup(definition, 3, new SeededRandom(7));
  const second = createBoardSetup(definition, 3, new SeededRandom(7));

  assert.deepEqual(first, second);
  assert.equal(first.rerollsRemaining, 5);
  assert.equal(first.normalizedDistortedPositions.length, 3);
  assert.equal(
    first.board.tiles.filter((tile) => tile.kind === "DISTORTED").length,
    1,
  );
});

test("grace cannot normalize more distorted tiles than the board has", () => {
  const definition = getBoardDefinition("HELMET", 1);
  const setup = createBoardSetup(definition, 10, new SeededRandom(1));

  assert.equal(setup.normalizedDistortedPositions.length, 0);
  assert.equal(setup.rerollsRemaining, 12);
  assert.equal(
    setup.board.tiles.filter((tile) => tile.kind === "DISTORTED").length,
    0,
  );
});

test("invalid grace levels and board data are rejected", () => {
  const definition = getBoardDefinition("WEAPON", 1);
  assert.throws(
    () => createBoardSetup(definition, 11, new SeededRandom(1)),
    RangeError,
  );

  const invalid: BoardDefinition = {
    ...definition,
    distortedPositions: [
      { row: 1, column: 2 },
      { row: 1, column: 2 },
    ],
  };

  assert.throws(() => validateBoardDefinition(invalid), /duplicated/);
});
