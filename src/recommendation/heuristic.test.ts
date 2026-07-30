import assert from "node:assert/strict";
import test from "node:test";

import type { GameState } from "../game-core/game.ts";
import type { RandomSource } from "../game-core/random.ts";
import type { SpiritCard } from "../game-core/spirits.ts";
import {
  RULES_VERSION,
  SCHEMA_VERSION,
  type BoardState,
} from "../game-core/types.ts";
import { getBoardDefinition } from "../game-data/boards.ts";
import {
  HeuristicAiRecommender,
  rankHeuristicActions,
} from "./heuristic.ts";

class CountingRandom implements RandomSource {
  consumed = 0;

  nextUint32(): number {
    this.consumed += 1;
    return 0;
  }

  nextFloat(): number {
    this.consumed += 1;
    return 0;
  }

  nextInt(_maxExclusive: number): number {
    this.consumed += 1;
    return 0;
  }
}

test("heuristic ranks guaranteed high-coverage attacks first", () => {
  const definition = getBoardDefinition("SHOULDERS", 1);
  const ranked = rankHeuristicActions(
    definition,
    stateWith(
      fullSquareBoard(),
      card("SHOCKWAVE", 2, "left"),
      card("PURIFY", 1, "right"),
    ),
  );
  const best = ranked[0];

  assert.equal(best?.rank, 1);
  assert.equal(best?.action.type, "USE_SPIRIT");
  if (best?.action.type !== "USE_SPIRIT") return;
  assert.equal(best.action.activeIndex, 0);
  assert.deepEqual(best.action.target, { row: 1, column: 1 });
  assert.equal(best.metrics.expectedPrimaryDestruction, 9);
  assert.equal(best.metrics.expectedRemainingAncient, 27);
  assert.ok(
    ranked
      .filter(({ action }) => action.type === "REROLL_SPIRIT")
      .every(({ score }) => score < best.score),
  );
});

test("distorted hits include restoration and risk penalties", () => {
  const definition = getBoardDefinition("WEAPON", 1);
  const board: BoardState = {
    definitionId: { equipmentPart: "WEAPON", stage: 1 },
    size: 6,
    tiles: [
      ancient("normal", 1, 3),
      {
        id: "distorted",
        position: { row: 1, column: 2 },
        kind: "DISTORTED",
      },
    ],
  };
  const ranked = rankHeuristicActions(
    definition,
    stateWith(
      board,
      card("THUNDER_STRIKE", 2, "left"),
      card("PURIFY", 3, "right"),
    ),
  );
  const risky = ranked.find(
    ({ action }) =>
      action.type === "USE_SPIRIT" &&
      action.activeIndex === 0 &&
      action.target.row === 1 &&
      action.target.column === 3,
  );

  assert.equal(risky?.metrics.expectedDistortedHits, 1);
  assert.equal(risky?.metrics.expectedRestoration, 3);
  assert.ok((risky?.score ?? 0) < (ranked[0]?.score ?? 0));
});

test("special tile hit chance is exposed for UI explanations", () => {
  const definition = getBoardDefinition("SHOULDERS", 1);
  const board: BoardState = {
    ...fullSquareBoard(),
    tiles: fullSquareBoard().tiles.map((tile) =>
      tile.id === "tile:2,2"
        ? { ...tile, specialEffect: "SPIRIT_REROLL" }
        : tile,
    ),
  };
  const ranked = rankHeuristicActions(
    definition,
    stateWith(
      board,
      card("SHOCKWAVE", 2, "left"),
      card("PURIFY", 1, "right"),
    ),
  );
  const centered = ranked.find(
    ({ action }) =>
      action.type === "USE_SPIRIT" &&
      action.activeIndex === 0 &&
      action.target.row === 2 &&
      action.target.column === 2,
  );

  assert.equal(centered?.metrics.specialActivationProbability, 1);
  assert.ok(
    centered?.explanation.some((line) => line.includes("100.0%")),
  );
});

test("heuristic recommender is deterministic and does not consume simulation random", async () => {
  const definition = getBoardDefinition("SHOULDERS", 1);
  const state = stateWith(
    fullSquareBoard(),
    card("SHOCKWAVE", 2, "left"),
    card("PURIFY", 1, "right"),
  );
  const random = new CountingRandom();
  const recommender = new HeuristicAiRecommender();
  const first = await recommender.recommend(definition, state, random);
  const second = await recommender.recommend(definition, state, random);

  assert.deepEqual(first, second);
  assert.equal(first.strategy, "IMMEDIATE_EXPECTED_VALUE");
  assert.equal(random.consumed, 0);
});

function stateWith(
  board: BoardState,
  left: SpiritCard,
  right: SpiritCard,
): GameState {
  return {
    schemaVersion: SCHEMA_VERSION,
    rulesVersion: RULES_VERSION,
    board,
    spiritQueue: {
      active: [left, right],
      preview: [
        card("HELLFIRE", 1, "preview:0"),
        card("GREAT_EXPLOSION", 1, "preview:1"),
        card("LIGHTNING", 1, "preview:2"),
      ],
      rerollsRemaining: 2,
      nextCardSerial: 10,
    },
    actionCount: 0,
    summonCount: 0,
    graceLevel: 0,
    status: "PLAYING",
  };
}

function fullSquareBoard(): BoardState {
  const tiles = [];
  for (let row = 0; row < 6; row += 1) {
    for (let column = 0; column < 6; column += 1) {
      tiles.push(ancient(`tile:${row},${column}`, row, column));
    }
  }
  return {
    definitionId: { equipmentPart: "SHOULDERS", stage: 1 },
    size: 6,
    tiles,
  };
}

function ancient(id: string, row: number, column: number) {
  return {
    id,
    position: { row, column },
    kind: "ANCIENT" as const,
  };
}

function card(
  spiritId:
    | "GREAT_EXPLOSION"
    | "HELLFIRE"
    | "LIGHTNING"
    | "PURIFY"
    | "SHOCKWAVE"
    | "THUNDER_STRIKE",
  level: 1 | 2 | 3,
  instanceId: string,
): SpiritCard {
  return { instanceId, spiritId, category: "NORMAL", level };
}
