import assert from "node:assert/strict";
import test from "node:test";

import type { GameAction, GameEvent, GameState } from "../game-core/game.ts";
import { RULES_VERSION, SCHEMA_VERSION } from "../game-core/types.ts";
import type { HeuristicRecommendation } from "../recommendation/heuristic.ts";
import type { MonteCarloRecommendation } from "../recommendation/monte-carlo.ts";
import {
  aggregateTurnAnalyses,
  analyzeTurn,
} from "./turn-analysis.ts";

const BEST_ACTION: GameAction = {
  type: "USE_SPIRIT",
  activeIndex: 0,
  target: { row: 1, column: 1 },
};
const CHOSEN_ACTION: GameAction = {
  type: "USE_SPIRIT",
  activeIndex: 1,
  target: { row: 2, column: 2 },
};

test("turn analysis separates decision quality from realized luck", () => {
  const before = stateWithAncientCount(3);
  const after = stateWithAncientCount(1);
  const analysis = analyzeTurn(
    before,
    after,
    CHOSEN_ACTION,
    resolvedEvents(),
    heuristicRecommendations(),
    monteCarloRecommendations(),
  );

  assert.equal(analysis.decision.chosenRank, 2);
  assert.equal(analysis.decision.legalActionCount, 2);
  assert.equal(analysis.decision.qualityPercentile, 0);
  assert.ok(
    Math.abs(analysis.decision.clearProbabilityLoss - 0.2) <
      Number.EPSILON,
  );
  assert.ok(
    Math.abs(analysis.decision.grade3ProbabilityLoss - 0.1) <
      Number.EPSILON,
  );
  assert.ok(
    Math.abs(analysis.decision.decisionLoss - 25) < 1e-10,
  );

  assert.equal(analysis.luck.expectedDestroyedTiles, 1.5);
  assert.equal(analysis.luck.expectedNetRemoval, 1.5);
  assert.equal(analysis.luck.actualDestroyedTiles, 2);
  assert.equal(analysis.luck.actualNetRemoval, 2);
  assert.equal(analysis.luck.netRemovalDelta, 0.5);
  assert.equal(analysis.luck.label, "LUCKY");
  assert.equal(analysis.luck.probabilisticHits, 2);
  assert.equal(analysis.luck.successfulProbabilisticHits, 1);
});

test("cumulative analysis preserves judgment loss and luck totals", () => {
  const analysis = analyzeTurn(
    stateWithAncientCount(3),
    stateWithAncientCount(1),
    CHOSEN_ACTION,
    resolvedEvents(),
    heuristicRecommendations(),
    monteCarloRecommendations(),
  );
  const cumulative = aggregateTurnAnalyses([analysis, analysis]);

  assert.equal(cumulative.analyzedTurns, 2);
  assert.equal(cumulative.averageChosenRank, 2);
  assert.equal(cumulative.averageQualityPercentile, 0);
  assert.ok(
    Math.abs(cumulative.cumulativeDecisionLoss - 50) < 1e-10,
  );
  assert.equal(cumulative.cumulativeLuckDelta, 1);
  assert.equal(cumulative.luckyTurns, 2);
  assert.equal(cumulative.unluckyTurns, 0);
});

test("empty cumulative analysis returns stable zero values", () => {
  assert.deepEqual(aggregateTurnAnalyses([]), {
    analyzedTurns: 0,
    averageChosenRank: 0,
    averageQualityPercentile: 0,
    cumulativeDecisionLoss: 0,
    cumulativeClearProbabilityLoss: 0,
    cumulativeGrade3ProbabilityLoss: 0,
    cumulativeLuckDelta: 0,
    luckyTurns: 0,
    unluckyTurns: 0,
  });
});

test("analysis rejects recommendation snapshots that omit the chosen action", () => {
  assert.throws(
    () =>
      analyzeTurn(
        stateWithAncientCount(3),
        stateWithAncientCount(1),
        CHOSEN_ACTION,
        resolvedEvents(),
        heuristicRecommendations().slice(0, 1),
        monteCarloRecommendations(),
      ),
    /missing from heuristic recommendations/,
  );
});

function heuristicRecommendations(): HeuristicRecommendation[] {
  return [
    heuristic(BEST_ACTION, 1, 2),
    heuristic(CHOSEN_ACTION, 2, 1.5),
  ];
}

function heuristic(
  action: GameAction,
  rank: number,
  expectedPrimaryDestruction: number,
): HeuristicRecommendation {
  return {
    rank,
    action,
    score: expectedPrimaryDestruction,
    metrics: {
      expectedPrimaryDestruction,
      expectedExtraDestruction: 0,
      expectedRestoration: 0,
      expectedRemainingAncient: 3 - expectedPrimaryDestruction,
      expectedDistortedHits: 0,
      specialActivationProbability: 0,
      immediateClearProbabilityLowerBound: 0,
    },
    explanation: [],
  };
}

function monteCarloRecommendations(): MonteCarloRecommendation[] {
  return [
    monteCarlo(BEST_ACTION, 1, 0.8, 0.5, 0.5, 4),
    monteCarlo(CHOSEN_ACTION, 2, 0.6, 0.4, 1.0, 5),
  ];
}

function monteCarlo(
  action: GameAction,
  rank: number,
  clearProbability: number,
  grade3Probability: number,
  expectedRemainingAncient: number,
  expectedSummonCount: number,
): MonteCarloRecommendation {
  return {
    rank,
    action,
    metrics: {
      completedSamples: 100,
      clearProbability,
      grade3Probability,
      expectedRemainingAncient,
      expectedSummonCount,
      averageRolloutTurns: 4,
      failedSamples: 0,
    },
  };
}

function resolvedEvents(): GameEvent[] {
  return [
    hitEvent("first", true, 1_000),
    hitEvent("second", false, 9_000),
    {
      type: "TILE_DESTROYED",
      tile: ancientTile("first", 0),
      cause: "PRIMARY_ATTACK",
    },
    {
      type: "TILE_DESTROYED",
      tile: ancientTile("third", 2),
      cause: "PRIMARY_ATTACK",
    },
  ];
}

function hitEvent(
  tileId: string,
  destroyed: boolean,
  roll: number,
): Extract<GameEvent, { type: "TILE_HIT_ROLLED" }> {
  return {
    type: "TILE_HIT_ROLLED",
    candidate: {
      tileId,
      position: { row: 0, column: 0 },
      tileKind: "ANCIENT",
      destroyChance: 5_000,
    },
    destroyed,
    roll,
  };
}

function stateWithAncientCount(count: number): GameState {
  return {
    schemaVersion: SCHEMA_VERSION,
    rulesVersion: RULES_VERSION,
    board: {
      definitionId: { equipmentPart: "SHOULDERS", stage: 1 },
      size: 6,
      tiles: Array.from({ length: count }, (_, index) =>
        ancientTile(`tile:${index}`, index),
      ),
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

function ancientTile(id: string, column: number) {
  return {
    id,
    position: { row: 0, column },
    kind: "ANCIENT" as const,
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
) {
  return {
    instanceId,
    spiritId,
    category: "NORMAL" as const,
    level: 1 as const,
  };
}
