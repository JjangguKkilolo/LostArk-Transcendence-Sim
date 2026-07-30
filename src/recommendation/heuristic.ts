import type {
  AiRecommendation,
  AiRecommender,
} from "../battle/battle.ts";
import {
  createSpiritAttackPlan,
  getLegalActions,
  type GameAction,
  type GameState,
} from "../game-core/game.ts";
import type { RandomSource } from "../game-core/random.ts";
import type { BoardDefinition } from "../game-core/types.ts";
import { PROBABILITY_SCALE, type AttackPlan } from "../game-core/attacks.ts";

export type HeuristicMetrics = Readonly<{
  expectedPrimaryDestruction: number;
  expectedExtraDestruction: number;
  expectedRestoration: number;
  expectedRemainingAncient: number;
  expectedDistortedHits: number;
  specialActivationProbability: number;
  immediateClearProbabilityLowerBound: number;
}>;

export type HeuristicRecommendation = Readonly<{
  rank: number;
  action: GameAction;
  score: number;
  metrics: HeuristicMetrics;
  explanation: readonly string[];
}>;

export class HeuristicAiRecommender implements AiRecommender {
  async recommend(
    definition: BoardDefinition,
    state: GameState,
    _simulationRandom: RandomSource,
  ): Promise<AiRecommendation> {
    const ranked = rankHeuristicActions(definition, state);
    const best = ranked[0];
    if (best === undefined) {
      throw new Error("AI has no legal action to recommend.");
    }
    return {
      action: best.action,
      legalActionCount: ranked.length,
      strategy: "IMMEDIATE_EXPECTED_VALUE",
    };
  }
}

export function rankHeuristicActions(
  definition: BoardDefinition,
  state: GameState,
): HeuristicRecommendation[] {
  const ancientCount = state.board.tiles.filter(
    ({ kind }) => kind === "ANCIENT",
  ).length;
  const evaluated = getLegalActions(definition, state).map((action) =>
    action.type === "REROLL_SPIRIT"
      ? evaluateReroll(action, ancientCount)
      : evaluateAttack(definition, state, action, ancientCount),
  );

  evaluated.sort(
    (left, right) =>
      right.score - left.score ||
      actionKey(left.action).localeCompare(actionKey(right.action)),
  );
  return evaluated.map((recommendation, index) => ({
    ...recommendation,
    rank: index + 1,
  }));
}

function evaluateAttack(
  definition: BoardDefinition,
  state: GameState,
  action: Extract<GameAction, { type: "USE_SPIRIT" }>,
  ancientCount: number,
): Omit<HeuristicRecommendation, "rank"> {
  const spirit = state.spiritQueue.active[action.activeIndex];
  const plan = createSpiritAttackPlan(
    definition,
    state.board,
    spirit,
    action.target,
  );
  const ancientCandidates = plan.candidates.filter(
    ({ tileKind }) => tileKind === "ANCIENT",
  );
  const distortedCandidates = plan.candidates.filter(
    ({ tileKind }) => tileKind === "DISTORTED",
  );
  const expectedPrimaryDestruction = ancientCandidates.reduce(
    (total, { destroyChance }) => total + destroyChance / PROBABILITY_SCALE,
    0,
  );
  const expectedDistortedHits =
    plan.distortedInteraction === "TRIGGER_RESTORE"
      ? distortedCandidates.reduce(
          (total, { destroyChance }) =>
            total + destroyChance / PROBABILITY_SCALE,
          0,
        )
      : 0;
  const expectedDistortedRestoration = expectedDistortedHits * 3;
  const lightning = lightningExpectation(
    plan,
    Math.max(ancientCount - expectedPrimaryDestruction, 0),
  );
  const expectedRestoration =
    expectedDistortedRestoration + lightning.restoration;
  const expectedExtraDestruction = lightning.destruction;
  const expectedRemainingAncient = Math.max(
    ancientCount -
      expectedPrimaryDestruction -
      expectedExtraDestruction +
      expectedRestoration,
    0,
  );
  const specialActivationProbability = specialHitProbability(state, plan);
  const immediateClearProbabilityLowerBound = immediateClearLowerBound(
    ancientCount,
    plan,
  );
  const netRemoval =
    expectedPrimaryDestruction +
    expectedExtraDestruction -
    expectedRestoration;
  const score =
    netRemoval +
    specialActivationProbability * 0.35 +
    immediateClearProbabilityLowerBound * 5 -
    expectedDistortedHits * 0.5;
  const explanation = [
    `기대 파괴 ${round(expectedPrimaryDestruction + expectedExtraDestruction)}개`,
    `기대 복구 ${round(expectedRestoration)}개`,
  ];
  if (expectedDistortedHits > 0) {
    explanation.push(`왜곡 기대 타격 ${round(expectedDistortedHits)}개`);
  }
  if (specialActivationProbability > 0) {
    explanation.push(
      `특수 석판 발동 확률 ${percent(specialActivationProbability)}`,
    );
  }

  return {
    action,
    score,
    metrics: {
      expectedPrimaryDestruction,
      expectedExtraDestruction,
      expectedRestoration,
      expectedRemainingAncient,
      expectedDistortedHits,
      specialActivationProbability,
      immediateClearProbabilityLowerBound,
    },
    explanation,
  };
}

function evaluateReroll(
  action: Extract<GameAction, { type: "REROLL_SPIRIT" }>,
  ancientCount: number,
): Omit<HeuristicRecommendation, "rank"> {
  return {
    action,
    score: -0.25,
    metrics: {
      expectedPrimaryDestruction: 0,
      expectedExtraDestruction: 0,
      expectedRestoration: 0,
      expectedRemainingAncient: ancientCount,
      expectedDistortedHits: 0,
      specialActivationProbability: 0,
      immediateClearProbabilityLowerBound: 0,
    },
    explanation: ["현재 공격 대신 교체권 1회를 사용"],
  };
}

function lightningExpectation(
  plan: AttackPlan,
  estimatedRemainingAncient: number,
): Readonly<{ destruction: number; restoration: number }> {
  if (plan.spiritId !== "LIGHTNING") {
    return { destruction: 0, restoration: 0 };
  }
  const maximum = plan.spiritLevel * 2;
  const outcomeCount = maximum + 2;
  let destruction = 0;
  for (let count = 0; count <= maximum; count += 1) {
    destruction += Math.min(count, estimatedRemainingAncient) / outcomeCount;
  }
  return { destruction, restoration: 1 / outcomeCount };
}

function specialHitProbability(
  state: GameState,
  plan: AttackPlan,
): number {
  const special = state.board.tiles.find(
    ({ specialEffect }) => specialEffect !== undefined,
  );
  if (special === undefined) return 0;
  return (
    plan.candidates.find(({ tileId }) => tileId === special.id)
      ?.destroyChance ?? 0
  ) / PROBABILITY_SCALE;
}

function immediateClearLowerBound(
  ancientCount: number,
  plan: AttackPlan,
): number {
  const ancientCandidates = plan.candidates.filter(
    ({ tileKind, destroyChance }) =>
      tileKind === "ANCIENT" && destroyChance > 0,
  );
  if (ancientCandidates.length < ancientCount) return 0;

  let probability = ancientCandidates.reduce(
    (result, { destroyChance }) =>
      result * (destroyChance / PROBABILITY_SCALE),
    1,
  );
  if (plan.distortedInteraction === "TRIGGER_RESTORE") {
    for (const candidate of plan.candidates) {
      if (candidate.tileKind === "DISTORTED") {
        probability *= 1 - candidate.destroyChance / PROBABILITY_SCALE;
      }
    }
  }
  if (plan.spiritId === "LIGHTNING") {
    probability *=
      (plan.spiritLevel * 2 + 1) / (plan.spiritLevel * 2 + 2);
  }
  return probability;
}

function actionKey(action: GameAction): string {
  return action.type === "REROLL_SPIRIT"
    ? `${action.type}:${action.activeIndex}`
    : `${action.type}:${action.activeIndex}:${action.target.row
      .toString()
      .padStart(2, "0")},${action.target.column.toString().padStart(2, "0")}`;
}

function round(value: number): string {
  return value.toFixed(2);
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
