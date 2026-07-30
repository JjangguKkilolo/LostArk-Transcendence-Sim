import type { GameAction, GameState } from "../game-core/game.ts";
import type { BoardDefinition } from "../game-core/types.ts";
import type { MonteCarloMetrics } from "./monte-carlo.ts";

export type ChopagoWorkerRequest = Readonly<{
  requestId: number;
  definition: BoardDefinition;
  state: GameState;
  seed: number;
  sampleCount: number;
  maxRolloutTurns: number;
  timeBudgetMs: number;
}>;

export type ChopagoWorkerRecommendation = Readonly<{
  rank: number;
  action: GameAction;
  metrics: MonteCarloMetrics;
}>;

export type ChopagoWorkerResponse =
  | Readonly<{
      type: "SUCCESS";
      requestId: number;
      recommendations: readonly ChopagoWorkerRecommendation[];
    }>
  | Readonly<{
      type: "ERROR";
      requestId: number;
      message: string;
    }>;
