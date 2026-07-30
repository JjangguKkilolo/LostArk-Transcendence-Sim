import assert from "node:assert/strict";
import test from "node:test";

import {
  applyAction,
  assertGameState,
  createGame,
  getLegalActions,
  type GameState,
} from "./game.ts";
import type { RandomSource } from "./random.ts";
import type { SpiritCard, SpiritQueueState } from "./spirits.ts";
import {
  RULES_VERSION,
  SCHEMA_VERSION,
  type BoardState,
  type SpecialTileId,
} from "./types.ts";
import { getBoardDefinition } from "../game-data/boards.ts";

class SequenceRandom implements RandomSource {
  #values: number[];
  consumed = 0;

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
    this.consumed += 1;
    return value;
  }
}

test("createGame composes board setup and the initial spirit queue", () => {
  const definition = getBoardDefinition("SHOULDERS", 1);
  const result = createGame(
    definition,
    0,
    new SequenceRandom([0, 23, 44, 62, 92]),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.board.tiles.length, 36);
  assert.equal(result.state.spiritQueue.active.length, 2);
  assert.equal(result.state.spiritQueue.preview.length, 3);
  assert.equal(result.state.spiritQueue.rerollsRemaining, 2);
  assert.equal(result.state.status, "PLAYING");
  assert.equal(result.events[0]?.type, "BOARD_CREATED");
  assert.equal(result.events.at(-1)?.type, "GAME_READY");
});

test("getLegalActions and reroll share the authoritative queue state", () => {
  const definition = getBoardDefinition("SHOULDERS", 1);
  const state = gameState(
    fullSquareBoard(),
    queue(card("SHOCKWAVE", 2, "a"), card("PURIFY", 1, "b")),
  );
  const legal = getLegalActions(definition, state);

  assert.equal(
    legal.filter(({ type }) => type === "REROLL_SPIRIT").length,
    2,
  );
  const result = applyAction(
    definition,
    state,
    { type: "REROLL_SPIRIT", activeIndex: 0 },
    new SequenceRandom([122]),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.actionCount, 1);
  assert.equal(result.state.summonCount, 0);
  assert.equal(result.state.spiritQueue.rerollsRemaining, 1);
  assert.equal(state.actionCount, 0);
});

test("a spirit action resolves attack, special lifecycle, and queue advance", () => {
  const definition = getBoardDefinition("SHOULDERS", 1);
  const state = gameState(
    fullSquareBoard(),
    queue(card("SHOCKWAVE", 2, "a"), card("PURIFY", 1, "b")),
  );
  const result = applyAction(
    definition,
    state,
    {
      type: "USE_SPIRIT",
      activeIndex: 0,
      target: { row: 2, column: 2 },
    },
    new SequenceRandom([0, 0, 23]),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.board.tiles.length, 27);
  assert.equal(
    result.state.board.tiles.filter(
      ({ specialEffect }) => specialEffect !== undefined,
    ).length,
    1,
  );
  assert.equal(result.state.actionCount, 1);
  assert.equal(result.state.summonCount, 1);
  assert.equal(result.state.spiritQueue.active[0]?.spiritId, "HELLFIRE");
  assert.equal(result.events[0]?.type, "ACTION_ACCEPTED");
  assert.equal(result.events[1]?.type, "SPIRIT_CAST");
  assert.equal(result.events.at(-1)?.type, "TURN_COMPLETED");
});

test("blessing refunds the summon and clearing assigns a grade", () => {
  const definition = getBoardDefinition("SHOULDERS", 1);
  const board: BoardState = {
    definitionId: { equipmentPart: "SHOULDERS", stage: 1 },
    size: 6,
    tiles: [
      {
        id: "last",
        position: { row: 2, column: 2 },
        kind: "ANCIENT",
        specialEffect: "SPIRIT_SAVE_CHANCE",
      },
    ],
  };
  const state = gameState(
    board,
    queue(
      mysteryCard("OUTBURST", "a"),
      card("PURIFY", 1, "b"),
    ),
  );
  const result = applyAction(
    definition,
    state,
    {
      type: "USE_SPIRIT",
      activeIndex: 0,
      target: { row: 2, column: 2 },
    },
    new SequenceRandom([23]),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.status, "CLEARED");
  assert.equal(result.state.summonCount, 0);
  assert.equal(result.state.clearGrade, 3);
  assert.equal(result.events.at(-1)?.type, "GAME_CLEARED");
});

test("an illegal action fails without consuming gameplay randomness", () => {
  const definition = getBoardDefinition("SHOULDERS", 1);
  const board: BoardState = {
    definitionId: { equipmentPart: "SHOULDERS", stage: 1 },
    size: 6,
    tiles: [
      {
        id: "only",
        position: { row: 0, column: 0 },
        kind: "ANCIENT",
      },
    ],
  };
  const state = gameState(
    board,
    queue(card("LIGHTNING", 1, "a"), card("PURIFY", 1, "b")),
  );
  const random = new SequenceRandom([]);
  const result = applyAction(
    definition,
    state,
    {
      type: "USE_SPIRIT",
      activeIndex: 0,
      target: { row: 2, column: 2 },
    },
    random,
  );

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "ILLEGAL_TARGET",
      message: "Spirit target is not legal.",
    },
  });
  assert.equal(random.consumed, 0);
});

test("assertGameState rejects contradictory completion state", () => {
  const definition = getBoardDefinition("SHOULDERS", 1);
  const state = {
    ...gameState(
      fullSquareBoard(),
      queue(card("SHOCKWAVE", 2, "a"), card("PURIFY", 1, "b")),
    ),
    status: "CLEARED",
    clearGrade: 3,
  } as const;

  assert.throws(
    () => assertGameState(definition, state),
    /cannot contain ancient tiles/,
  );
});

function gameState(
  board: BoardState,
  spiritQueue: SpiritQueueState,
): GameState {
  return {
    schemaVersion: SCHEMA_VERSION,
    rulesVersion: RULES_VERSION,
    board,
    spiritQueue,
    actionCount: 0,
    summonCount: 0,
    graceLevel: 0,
    status: "PLAYING",
  };
}

function queue(
  left: SpiritCard,
  right: SpiritCard,
): SpiritQueueState {
  return {
    active: [left, right],
    preview: [
      card("HELLFIRE", 1, "p0"),
      card("GREAT_EXPLOSION", 1, "p1"),
      card("LIGHTNING", 1, "p2"),
    ],
    rerollsRemaining: 2,
    nextCardSerial: 10,
  };
}

function fullSquareBoard(): BoardState {
  const tiles = [];
  for (let row = 0; row < 6; row += 1) {
    for (let column = 0; column < 6; column += 1) {
      tiles.push({
        id: `tile:${row},${column}`,
        position: { row, column },
        kind: "ANCIENT" as const,
      });
    }
  }
  return {
    definitionId: { equipmentPart: "SHOULDERS", stage: 1 },
    size: 6,
    tiles,
  };
}

function card(
  spiritId:
    | "GREAT_EXPLOSION"
    | "HELLFIRE"
    | "LIGHTNING"
    | "PURIFY"
    | "SHOCKWAVE",
  level: 1 | 2 | 3,
  instanceId: string,
): SpiritCard {
  return { instanceId, spiritId, category: "NORMAL", level };
}

function mysteryCard(
  spiritId: "OUTBURST",
  instanceId: string,
): SpiritCard {
  return {
    instanceId,
    spiritId,
    category: "MYSTERY",
    level: 1,
  };
}
