import assert from "node:assert/strict";
import test from "node:test";

import { positionKey } from "./board.ts";
import type { RandomSource } from "./random.ts";
import {
  resolveSpecialTileTurn,
  validateSpecialTileInvariant,
} from "./special-tiles.ts";
import type { SpiritCard } from "./spirits.ts";
import type { BoardState, SpecialTileId, Tile } from "./types.ts";
import {
  drawSpecialTileId,
  SPECIAL_TILE_DEFINITIONS,
  SPECIAL_TILE_TOTAL_WEIGHT,
} from "../game-data/special-tiles.ts";
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

test("special tile weights preserve the documented 200-slot pool", () => {
  assert.equal(SPECIAL_TILE_TOTAL_WEIGHT, 200);
  assert.deepEqual(
    SPECIAL_TILE_DEFINITIONS.map(({ id, weight }) => [id, weight]),
    [
      ["SPIRIT_REROLL", 47],
      ["SPIRIT_SHUFFLE", 34],
      ["SPIRIT_SAVE_CHANCE", 23],
      ["SPIRIT_UPGRADE", 32],
      ["SPIRIT_COPY", 32],
      ["SPIRIT_MYSTIC", 32],
    ],
  );
  assert.equal(drawSpecialTileId(new SequenceRandom([0])), "SPIRIT_REROLL");
  assert.equal(drawSpecialTileId(new SequenceRandom([46])), "SPIRIT_REROLL");
  assert.equal(drawSpecialTileId(new SequenceRandom([47])), "SPIRIT_SHUFFLE");
  assert.equal(drawSpecialTileId(new SequenceRandom([199])), "SPIRIT_MYSTIC");
});

test("a destroyed reroll tile applies its effect and assigns a new special", () => {
  const definition = getBoardDefinition("SHOULDERS", 1);
  const source = tile("source", 0, 0, "SPIRIT_REROLL");
  const remaining = tile("remaining", 0, 1);
  const board = boardWith([remaining]);
  const result = resolveSpecialTileTurn(
    definition,
    board,
    [source],
    card("HELLFIRE", 2, "used"),
    card("PURIFY", 1, "other"),
    new SequenceRandom([0, 0]),
  );

  assert.equal(result.appliedEffect?.rerollDelta, 1);
  assert.equal(result.appliedEffect?.summonDelta, 0);
  assert.equal(result.events[0]?.type, "SPECIAL_TILE_ACTIVATED");
  assert.equal(result.events.at(-1)?.type, "NEW_SPECIAL_ASSIGNED");
  assert.equal(result.board.tiles[0]?.specialEffect, "SPIRIT_REROLL");
});

test("blessing, upgrade, copy, and mystery return queue-ready changes", () => {
  const definition = getBoardDefinition("SHOULDERS", 1);
  const used = card("HELLFIRE", 2, "used");
  const other = card("PURIFY", 1, "other");

  const blessing = resolveForEffect(
    definition,
    "SPIRIT_SAVE_CHANCE",
    used,
    other,
    [0, 0],
  );
  assert.equal(blessing.appliedEffect?.summonDelta, -1);

  const upgrade = resolveForEffect(
    definition,
    "SPIRIT_UPGRADE",
    used,
    other,
    [0, 0],
  );
  assert.equal(upgrade.appliedEffect?.otherSpirit.level, 2);

  const copy = resolveForEffect(
    definition,
    "SPIRIT_COPY",
    used,
    other,
    [0, 0],
  );
  assert.deepEqual(copy.appliedEffect?.otherSpirit, {
    instanceId: "other",
    spiritId: "HELLFIRE",
    category: "NORMAL",
    level: 2,
  });

  const mystery = resolveForEffect(
    definition,
    "SPIRIT_MYSTIC",
    used,
    other,
    [1, 0, 0],
  );
  assert.deepEqual(mystery.appliedEffect?.otherSpirit, {
    instanceId: "other",
    spiritId: "WORLD_TREE_RESONANCE",
    category: "MYSTERY",
    level: 1,
  });
});

test("shuffle relocates tiles together with empty cells", () => {
  const definition = getBoardDefinition("SHOULDERS", 1);
  const source = tile("source", 0, 0, "SPIRIT_SHUFFLE");
  const remaining = tile("remaining", 0, 1);
  const result = resolveSpecialTileTurn(
    definition,
    boardWith([remaining]),
    [source],
    card("HELLFIRE", 1, "used"),
    card("PURIFY", 1, "other"),
    new SequenceRandom([...Array(35).fill(0), 0, 0]),
  );
  const shuffleEvent = result.events.find(
    ({ type }) => type === "BOARD_SHUFFLED",
  );

  assert.ok(shuffleEvent?.type === "BOARD_SHUFFLED");
  assert.ok(shuffleEvent.movements.length > 0);
  assert.notEqual(
    positionKey(result.board.tiles[0]?.position ?? { row: 0, column: 1 }),
    "0,1",
  );
});

test("old specials expire and invalid multiple specials are rejected", () => {
  const definition = getBoardDefinition("SHOULDERS", 1);
  const old = tile("old", 0, 0, "SPIRIT_COPY");
  const normal = tile("normal", 0, 1);
  const result = resolveSpecialTileTurn(
    definition,
    boardWith([old, normal]),
    [],
    card("HELLFIRE", 1, "used"),
    card("PURIFY", 1, "other"),
    new SequenceRandom([1, 199]),
  );

  assert.ok(
    result.events.some(({ type }) => type === "OLD_SPECIAL_CLEARED"),
  );
  assert.equal(
    result.board.tiles.filter(
      ({ specialEffect }) => specialEffect !== undefined,
    ).length,
    1,
  );

  const invalid = boardWith([
    tile("one", 0, 0, "SPIRIT_COPY"),
    tile("two", 0, 1, "SPIRIT_REROLL"),
  ]);
  assert.throws(
    () => validateSpecialTileInvariant(invalid),
    /more than one active special tile/,
  );
});

function resolveForEffect(
  definition: ReturnType<typeof getBoardDefinition>,
  effect: SpecialTileId,
  used: SpiritCard,
  other: SpiritCard,
  randomValues: readonly number[],
) {
  return resolveSpecialTileTurn(
    definition,
    boardWith([tile("remaining", 0, 1)]),
    [tile("source", 0, 0, effect)],
    used,
    other,
    new SequenceRandom(randomValues),
  );
}

function boardWith(tiles: readonly Tile[]): BoardState {
  return {
    definitionId: { equipmentPart: "SHOULDERS", stage: 1 },
    size: 6,
    tiles,
  };
}

function tile(
  id: string,
  row: number,
  column: number,
  specialEffect?: SpecialTileId,
): Tile {
  return {
    id,
    position: { row, column },
    kind: "ANCIENT",
    ...(specialEffect === undefined ? {} : { specialEffect }),
  };
}

function card(
  spiritId: "HELLFIRE" | "PURIFY",
  level: 1 | 2 | 3,
  instanceId: string,
): SpiritCard {
  return {
    instanceId,
    spiritId,
    category: "NORMAL",
    level,
  };
}
