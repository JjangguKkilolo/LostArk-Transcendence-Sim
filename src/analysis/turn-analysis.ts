import type { GameAction, GameEvent, GameState } from "../game-core/game.ts";
import type { HeuristicRecommendation } from "../recommendation/heuristic.ts";
import type { MonteCarloRecommendation } from "../recommendation/monte-carlo.ts";

export type LuckLabel =
  | "VERY_UNLUCKY"
  | "UNLUCKY"
  | "EXPECTED"
  | "LUCKY"
  | "VERY_LUCKY";

export type DecisionAnalysis = Readonly<{
  chosenRank: number;
  legalActionCount: number;
  qualityPercentile: number;
  bestAction: GameAction;
  clearProbabilityLoss: number;
  grade3ProbabilityLoss: number;
  expectedRemainingPenalty: number;
  expectedSummonPenalty: number;
  decisionLoss: number;
}>;

export type LuckAnalysis = Readonly<{
  expectedDestroyedTiles: number;
  expectedRestoredTiles: number;
  expectedNetRemoval: number;
  actualDestroyedTiles: number;
  actualRestoredTiles: number;
  actualNetRemoval: number;
  netRemovalDelta: number;
  probabilisticHits: number;
  successfulProbabilisticHits: number;
  label: LuckLabel;
}>;

export type TurnAnalysis = Readonly<{
  action: GameAction;
  decision: DecisionAnalysis;
  luck: LuckAnalysis;
}>;

export type CumulativeAnalysis = Readonly<{
  analyzedTurns: number;
  averageChosenRank: number;
  averageQualityPercentile: number;
  cumulativeDecisionLoss: number;
  cumulativeClearProbabilityLoss: number;
  cumulativeGrade3ProbabilityLoss: number;
  cumulativeLuckDelta: number;
  luckyTurns: number;
  unluckyTurns: number;
}>;

export function analyzeTurn(
  before: GameState,
  after: GameState,
  action: GameAction,
  events: readonly GameEvent[],
  heuristicRecommendations: readonly HeuristicRecommendation[],
  monteCarloRecommendations: readonly MonteCarloRecommendation[],
): TurnAnalysis {
  const chosenHeuristic = findAction(heuristicRecommendations, action);
  const chosenMonteCarlo = findAction(monteCarloRecommendations, action);
  const best = monteCarloRecommendations[0];
  if (chosenHeuristic === undefined) {
    throw new Error("Chosen action is missing from heuristic recommendations.");
  }
  if (chosenMonteCarlo === undefined || best === undefined) {
    throw new Error("Chosen action is missing from Monte Carlo recommendations.");
  }

  return {
    action,
    decision: analyzeDecision(
      chosenMonteCarlo,
      best,
      monteCarloRecommendations.length,
    ),
    luck: analyzeLuck(
      before,
      after,
      events,
      chosenHeuristic,
    ),
  };
}

export function aggregateTurnAnalyses(
  analyses: readonly TurnAnalysis[],
): CumulativeAnalysis {
  if (analyses.length === 0) {
    return {
      analyzedTurns: 0,
      averageChosenRank: 0,
      averageQualityPercentile: 0,
      cumulativeDecisionLoss: 0,
      cumulativeClearProbabilityLoss: 0,
      cumulativeGrade3ProbabilityLoss: 0,
      cumulativeLuckDelta: 0,
      luckyTurns: 0,
      unluckyTurns: 0,
    };
  }

  const totals = analyses.reduce(
    (result, analysis) => ({
      rank: result.rank + analysis.decision.chosenRank,
      quality:
        result.quality + analysis.decision.qualityPercentile,
      decisionLoss:
        result.decisionLoss + analysis.decision.decisionLoss,
      clearLoss:
        result.clearLoss + analysis.decision.clearProbabilityLoss,
      grade3Loss:
        result.grade3Loss + analysis.decision.grade3ProbabilityLoss,
      luck: result.luck + analysis.luck.netRemovalDelta,
      lucky:
        result.lucky +
        (analysis.luck.label === "LUCKY" ||
        analysis.luck.label === "VERY_LUCKY"
          ? 1
          : 0),
      unlucky:
        result.unlucky +
        (analysis.luck.label === "UNLUCKY" ||
        analysis.luck.label === "VERY_UNLUCKY"
          ? 1
          : 0),
    }),
    {
      rank: 0,
      quality: 0,
      decisionLoss: 0,
      clearLoss: 0,
      grade3Loss: 0,
      luck: 0,
      lucky: 0,
      unlucky: 0,
    },
  );

  return {
    analyzedTurns: analyses.length,
    averageChosenRank: totals.rank / analyses.length,
    averageQualityPercentile: totals.quality / analyses.length,
    cumulativeDecisionLoss: totals.decisionLoss,
    cumulativeClearProbabilityLoss: totals.clearLoss,
    cumulativeGrade3ProbabilityLoss: totals.grade3Loss,
    cumulativeLuckDelta: totals.luck,
    luckyTurns: totals.lucky,
    unluckyTurns: totals.unlucky,
  };
}

function analyzeDecision(
  chosen: MonteCarloRecommendation,
  best: MonteCarloRecommendation,
  legalActionCount: number,
): DecisionAnalysis {
  const clearProbabilityLoss = nonNegative(
    best.metrics.clearProbability - chosen.metrics.clearProbability,
  );
  const grade3ProbabilityLoss = nonNegative(
    best.metrics.grade3Probability - chosen.metrics.grade3Probability,
  );
  const expectedRemainingPenalty = nonNegative(
    chosen.metrics.expectedRemainingAncient -
      best.metrics.expectedRemainingAncient,
  );
  const expectedSummonPenalty = nonNegative(
    chosen.metrics.expectedSummonCount -
      best.metrics.expectedSummonCount,
  );
  const decisionLoss =
    clearProbabilityLoss * 100 +
    grade3ProbabilityLoss * 30 +
    expectedRemainingPenalty * 2 +
    expectedSummonPenalty;
  const qualityPercentile =
    legalActionCount <= 1
      ? 100
      : ((legalActionCount - chosen.rank) / (legalActionCount - 1)) * 100;

  return {
    chosenRank: chosen.rank,
    legalActionCount,
    qualityPercentile,
    bestAction: best.action,
    clearProbabilityLoss,
    grade3ProbabilityLoss,
    expectedRemainingPenalty,
    expectedSummonPenalty,
    decisionLoss,
  };
}

function analyzeLuck(
  before: GameState,
  after: GameState,
  events: readonly GameEvent[],
  heuristic: HeuristicRecommendation,
): LuckAnalysis {
  const expectedDestroyedTiles =
    heuristic.metrics.expectedPrimaryDestruction +
    heuristic.metrics.expectedExtraDestruction;
  const expectedRestoredTiles = heuristic.metrics.expectedRestoration;
  const expectedNetRemoval =
    expectedDestroyedTiles - expectedRestoredTiles;
  const destroyedEvents = events.filter(
    (
      event,
    ): event is Extract<GameEvent, { type: "TILE_DESTROYED" }> =>
      event.type === "TILE_DESTROYED",
  );
  const restoredEvents = events.filter(
    (
      event,
    ): event is Extract<GameEvent, { type: "TILES_RESTORED" }> =>
      event.type === "TILES_RESTORED",
  );
  const actualDestroyedTiles = destroyedEvents.filter(
    ({ tile }) => tile.kind === "ANCIENT",
  ).length;
  const actualRestoredTiles = restoredEvents.reduce(
    (total, event) =>
      total +
      event.tiles.filter(({ kind }) => kind === "ANCIENT").length,
    0,
  );
  const actualNetRemoval =
    countAncient(before) - countAncient(after);
  const netRemovalDelta = actualNetRemoval - expectedNetRemoval;
  const probabilisticRolls = events.filter(
    (
      event,
    ): event is Extract<GameEvent, { type: "TILE_HIT_ROLLED" }> =>
      event.type === "TILE_HIT_ROLLED" && event.roll !== undefined,
  );

  return {
    expectedDestroyedTiles,
    expectedRestoredTiles,
    expectedNetRemoval,
    actualDestroyedTiles,
    actualRestoredTiles,
    actualNetRemoval,
    netRemovalDelta,
    probabilisticHits: probabilisticRolls.length,
    successfulProbabilisticHits: probabilisticRolls.filter(
      ({ destroyed }) => destroyed,
    ).length,
    label: luckLabel(netRemovalDelta),
  };
}

function luckLabel(delta: number): LuckLabel {
  if (delta >= 2) return "VERY_LUCKY";
  if (delta >= 0.5) return "LUCKY";
  if (delta <= -2) return "VERY_UNLUCKY";
  if (delta <= -0.5) return "UNLUCKY";
  return "EXPECTED";
}

function findAction<
  T extends Readonly<{ action: GameAction }>,
>(recommendations: readonly T[], action: GameAction): T | undefined {
  const key = actionKey(action);
  return recommendations.find(
    (recommendation) => actionKey(recommendation.action) === key,
  );
}

function actionKey(action: GameAction): string {
  return action.type === "REROLL_SPIRIT"
    ? `${action.type}:${action.activeIndex}`
    : `${action.type}:${action.activeIndex}:${action.target.row},${action.target.column}`;
}

function countAncient(state: GameState): number {
  return state.board.tiles.filter(({ kind }) => kind === "ANCIENT").length;
}

function nonNegative(value: number): number {
  return Math.max(value, 0);
}
