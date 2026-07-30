import assert from "node:assert/strict";
import test from "node:test";

import type { GameState } from "../game-core/game.ts";
import type { RandomSource } from "../game-core/random.ts";
import { SeededRandom } from "../game-core/random.ts";
import type { SpiritCard } from "../game-core/spirits.ts";
import { RULES_VERSION, SCHEMA_VERSION } from "../game-core/types.ts";
import { getBoardDefinition } from "../game-data/boards.ts";
import {
  MonteCarloAiRecommender,
  MonteCarloCancelledError,
  rankMonteCarloActions,
} from "./monte-carlo.ts";

class CountingRandom implements RandomSource {
  consumed = 0;

  nextUint32(): number {
    this.consumed += 1;
    return 17;
  }

  nextFloat(): number {
    this.consumed += 1;
    return 0.5;
  }

  nextInt(_maxExclusive: number): number {
    this.consumed += 1;
    return 0;
  }
}

test("Monte Carlo ranks the higher immediate clear chance first", async () => {
  const definition = getBoardDefinition("SHOULDERS", 1);
  const ranked = await rankMonteCarloActions(
    definition,
    twoTileState(),
    new SeededRandom(12345),
    { sampleCount: 256, maxRolloutTurns: 1 },
  );
  const best = ranked[0];

  assert.equal(best?.action.type, "USE_SPIRIT");
  if (best?.action.type !== "USE_SPIRIT") return;
  assert.equal(best.action.activeIndex, 0);
  assert.ok(best.metrics.clearProbability > 0.65);
  assert.ok(best.metrics.clearProbability < 0.85);
  assert.equal(best.metrics.completedSamples, 256);
  assert.equal(best.metrics.failedSamples, 0);

  const purify = ranked.find(
    ({ action }) =>
      action.type === "USE_SPIRIT" &&
      action.activeIndex === 1 &&
      action.target.row === 2 &&
      action.target.column === 2,
  );
  assert.ok(
    best.metrics.clearProbability >
      (purify?.metrics.clearProbability ?? 1),
  );
});

test("the same state, options, and AI seed reproduce identical rankings", async () => {
  const definition = getBoardDefinition("SHOULDERS", 1);
  const options = { sampleCount: 32, maxRolloutTurns: 2 };
  const first = await rankMonteCarloActions(
    definition,
    twoTileState(),
    new SeededRandom(77),
    options,
  );
  const second = await rankMonteCarloActions(
    definition,
    twoTileState(),
    new SeededRandom(77),
    options,
  );

  assert.deepEqual(first, second);
});

test("simulation consumes only its supplied AI random stream", async () => {
  const definition = getBoardDefinition("SHOULDERS", 1);
  const simulation = new CountingRandom();
  const playerGameplay = new CountingRandom();
  const aiGameplay = new CountingRandom();
  await rankMonteCarloActions(
    definition,
    twoTileState(),
    simulation,
    { sampleCount: 4, maxRolloutTurns: 1 },
  );

  assert.equal(simulation.consumed, 4);
  assert.equal(playerGameplay.consumed, 0);
  assert.equal(aiGameplay.consumed, 0);
});

test("an aborted recommendation stops before consuming a sample seed", async () => {
  const definition = getBoardDefinition("SHOULDERS", 1);
  const controller = new AbortController();
  const simulation = new CountingRandom();
  controller.abort();

  await assert.rejects(
    rankMonteCarloActions(
      definition,
      twoTileState(),
      simulation,
      {
        sampleCount: 4,
        maxRolloutTurns: 1,
        signal: controller.signal,
      },
    ),
    MonteCarloCancelledError,
  );
  assert.equal(simulation.consumed, 0);
});

test("MonteCarloAiRecommender exposes the battle AI interface", async () => {
  const definition = getBoardDefinition("SHOULDERS", 1);
  const recommender = new MonteCarloAiRecommender({
    sampleCount: 16,
    maxRolloutTurns: 1,
  });
  const result = await recommender.recommend(
    definition,
    twoTileState(),
    new SeededRandom(9),
  );

  assert.equal(result.strategy, "MONTE_CARLO_ROLLOUT_V1");
  assert.ok(result.legalActionCount > 0);
  assert.equal(result.action.type, "USE_SPIRIT");
});

function twoTileState(): GameState {
  return {
    schemaVersion: SCHEMA_VERSION,
    rulesVersion: RULES_VERSION,
    board: {
      definitionId: { equipmentPart: "SHOULDERS", stage: 1 },
      size: 6,
      tiles: [
        {
          id: "left",
          position: { row: 2, column: 2 },
          kind: "ANCIENT",
        },
        {
          id: "right",
          position: { row: 2, column: 3 },
          kind: "ANCIENT",
        },
      ],
    },
    spiritQueue: {
      active: [
        card("SHOCKWAVE", "active:0"),
        card("PURIFY", "active:1"),
      ],
      preview: [
        card("HELLFIRE", "preview:0"),
        card("GREAT_EXPLOSION", "preview:1"),
        card("LIGHTNING", "preview:2"),
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

function card(
  spiritId:
    | "GREAT_EXPLOSION"
    | "HELLFIRE"
    | "LIGHTNING"
    | "PURIFY"
    | "SHOCKWAVE",
  instanceId: string,
): SpiritCard {
  return {
    instanceId,
    spiritId,
    category: "NORMAL",
    level: 1,
  };
}
