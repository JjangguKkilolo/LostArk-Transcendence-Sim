import type {
  AiRecommendation,
  AiRecommender,
} from "../battle/battle.ts";
import {
  applyAction,
  getLegalActions,
  type GameAction,
  type GameState,
} from "../game-core/game.ts";
import {
  SeededRandom,
  type RandomSource,
} from "../game-core/random.ts";
import type { BoardDefinition } from "../game-core/types.ts";
import { rankHeuristicActions } from "./heuristic.ts";

export type MonteCarloOptions = Readonly<{
  sampleCount?: number;
  maxRolloutTurns?: number;
  timeBudgetMs?: number;
  signal?: AbortSignal;
}>;

export type MonteCarloMetrics = Readonly<{
  completedSamples: number;
  clearProbability: number;
  grade3Probability: number;
  expectedRemainingAncient: number;
  expectedSummonCount: number;
  averageRolloutTurns: number;
  failedSamples: number;
}>;

export type MonteCarloRecommendation = Readonly<{
  rank: number;
  action: GameAction;
  metrics: MonteCarloMetrics;
}>;

type Accumulator = {
  clears: number;
  grade3Clears: number;
  remainingAncient: number;
  summonCount: number;
  rolloutTurns: number;
  failures: number;
};

const DEFAULT_SAMPLE_COUNT = 128;
const DEFAULT_MAX_ROLLOUT_TURNS = 30;

export class MonteCarloCancelledError extends Error {
  constructor() {
    super("Monte Carlo recommendation was cancelled.");
    this.name = "MonteCarloCancelledError";
  }
}

export class MonteCarloAiRecommender implements AiRecommender {
  readonly #options: MonteCarloOptions;

  constructor(options: MonteCarloOptions = {}) {
    this.#options = options;
  }

  async recommend(
    definition: BoardDefinition,
    state: GameState,
    simulationRandom: RandomSource,
  ): Promise<AiRecommendation> {
    const ranked = await rankMonteCarloActions(
      definition,
      state,
      simulationRandom,
      this.#options,
    );
    const best = ranked[0];
    if (best === undefined) {
      throw new Error("AI has no legal action to recommend.");
    }
    return {
      action: best.action,
      legalActionCount: ranked.length,
      strategy: "MONTE_CARLO_ROLLOUT_V1",
    };
  }
}

export async function rankMonteCarloActions(
  definition: BoardDefinition,
  state: GameState,
  simulationRandom: RandomSource,
  options: MonteCarloOptions = {},
): Promise<MonteCarloRecommendation[]> {
  const sampleCount = options.sampleCount ?? DEFAULT_SAMPLE_COUNT;
  const maxRolloutTurns =
    options.maxRolloutTurns ?? DEFAULT_MAX_ROLLOUT_TURNS;
  validateOptions(sampleCount, maxRolloutTurns, options.timeBudgetMs);
  throwIfCancelled(options.signal);

  const actions = getLegalActions(definition, state);
  if (actions.length === 0) return [];
  const accumulators: Accumulator[] = actions.map(() => emptyAccumulator());
  const startedAt = monotonicNow();
  let completedSamples = 0;

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    throwIfCancelled(options.signal);
    if (
      sampleIndex > 0 &&
      options.timeBudgetMs !== undefined &&
      monotonicNow() - startedAt >= options.timeBudgetMs
    ) {
      break;
    }

    const sampleSeed = simulationRandom.nextUint32();
    for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
      const action = actions[actionIndex];
      const accumulator = accumulators[actionIndex];
      if (action === undefined || accumulator === undefined) {
        throw new Error("Monte Carlo action index escaped array bounds.");
      }
      runSample(
        definition,
        state,
        action,
        new SeededRandom(sampleSeed),
        maxRolloutTurns,
        accumulator,
      );
    }
    completedSamples += 1;

    if ((sampleIndex + 1) % 16 === 0) {
      await yieldToHost();
      throwIfCancelled(options.signal);
    }
  }

  const heuristicRanks = new Map(
    rankHeuristicActions(definition, state).map(({ action, rank }) => [
      actionKey(action),
      rank,
    ]),
  );
  const recommendations = actions.map((action, index) => {
    const accumulator = accumulators[index];
    if (accumulator === undefined || completedSamples === 0) {
      throw new Error("Monte Carlo produced no completed samples.");
    }
    return {
      rank: 0,
      action,
      metrics: finalizeMetrics(accumulator, completedSamples),
    };
  });
  recommendations.sort(
    (left, right) =>
      right.metrics.clearProbability - left.metrics.clearProbability ||
      right.metrics.grade3Probability - left.metrics.grade3Probability ||
      left.metrics.expectedRemainingAncient -
        right.metrics.expectedRemainingAncient ||
      left.metrics.expectedSummonCount - right.metrics.expectedSummonCount ||
      (heuristicRanks.get(actionKey(left.action)) ?? Number.MAX_SAFE_INTEGER) -
        (heuristicRanks.get(actionKey(right.action)) ??
          Number.MAX_SAFE_INTEGER) ||
      actionKey(left.action).localeCompare(actionKey(right.action)),
  );

  return recommendations.map((recommendation, index) => ({
    ...recommendation,
    rank: index + 1,
  }));
}

function runSample(
  definition: BoardDefinition,
  initialState: GameState,
  firstAction: GameAction,
  random: RandomSource,
  maxRolloutTurns: number,
  accumulator: Accumulator,
): void {
  let state = initialState;
  let action = firstAction;
  let turns = 0;

  while (state.status === "PLAYING" && turns < maxRolloutTurns) {
    const transition = applyAction(definition, state, action, random);
    if (!transition.ok) {
      accumulator.failures += 1;
      break;
    }
    state = transition.state;
    turns += 1;
    if (state.status === "CLEARED") break;

    const next = rankHeuristicActions(definition, state)[0];
    if (next === undefined) {
      accumulator.failures += 1;
      break;
    }
    action = next.action;
  }

  if (state.status === "CLEARED") {
    accumulator.clears += 1;
    if (state.clearGrade === 3) accumulator.grade3Clears += 1;
  }
  accumulator.remainingAncient += state.board.tiles.filter(
    ({ kind }) => kind === "ANCIENT",
  ).length;
  accumulator.summonCount += state.summonCount;
  accumulator.rolloutTurns += turns;
}

function finalizeMetrics(
  accumulator: Accumulator,
  completedSamples: number,
): MonteCarloMetrics {
  return {
    completedSamples,
    clearProbability: accumulator.clears / completedSamples,
    grade3Probability: accumulator.grade3Clears / completedSamples,
    expectedRemainingAncient:
      accumulator.remainingAncient / completedSamples,
    expectedSummonCount: accumulator.summonCount / completedSamples,
    averageRolloutTurns: accumulator.rolloutTurns / completedSamples,
    failedSamples: accumulator.failures,
  };
}

function emptyAccumulator(): Accumulator {
  return {
    clears: 0,
    grade3Clears: 0,
    remainingAncient: 0,
    summonCount: 0,
    rolloutTurns: 0,
    failures: 0,
  };
}

function validateOptions(
  sampleCount: number,
  maxRolloutTurns: number,
  timeBudgetMs: number | undefined,
): void {
  if (!Number.isSafeInteger(sampleCount) || sampleCount <= 0) {
    throw new RangeError("sampleCount must be a positive safe integer.");
  }
  if (!Number.isSafeInteger(maxRolloutTurns) || maxRolloutTurns <= 0) {
    throw new RangeError("maxRolloutTurns must be a positive safe integer.");
  }
  if (
    timeBudgetMs !== undefined &&
    (!Number.isFinite(timeBudgetMs) || timeBudgetMs < 0)
  ) {
    throw new RangeError("timeBudgetMs must be a non-negative number.");
  }
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new MonteCarloCancelledError();
}

function monotonicNow(): number {
  return globalThis.performance?.now() ?? Date.now();
}

function yieldToHost(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function actionKey(action: GameAction): string {
  return action.type === "REROLL_SPIRIT"
    ? `${action.type}:${action.activeIndex}`
    : `${action.type}:${action.activeIndex}:${action.target.row},${action.target.column}`;
}
