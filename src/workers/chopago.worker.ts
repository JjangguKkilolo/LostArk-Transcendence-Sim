/// <reference lib="webworker" />

import { SeededRandom } from "../game-core/random.ts";
import { rankMonteCarloActions } from "../recommendation/monte-carlo.ts";
import type {
  ChopagoWorkerRequest,
  ChopagoWorkerResponse,
} from "../recommendation/worker-protocol.ts";

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

workerScope.onmessage = async (
  event: MessageEvent<ChopagoWorkerRequest>,
) => {
  const request = event.data;
  try {
    const recommendations = await rankMonteCarloActions(
      request.definition,
      request.state,
      new SeededRandom(request.seed),
      {
        sampleCount: request.sampleCount,
        maxRolloutTurns: request.maxRolloutTurns,
        timeBudgetMs: request.timeBudgetMs,
      },
    );
    const playerRecommendations =
      request.playerState === undefined || request.playerSeed === undefined
        ? []
        : await rankMonteCarloActions(
            request.definition,
            request.playerState,
            new SeededRandom(request.playerSeed),
            {
              sampleCount: request.sampleCount,
              maxRolloutTurns: request.maxRolloutTurns,
              timeBudgetMs: request.timeBudgetMs,
            },
          );
    const response: ChopagoWorkerResponse = {
      type: "SUCCESS",
      requestId: request.requestId,
      recommendations: recommendations.slice(0, 3),
      playerRecommendations,
    };
    workerScope.postMessage(response);
  } catch (error) {
    const response: ChopagoWorkerResponse = {
      type: "ERROR",
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
    };
    workerScope.postMessage(response);
  }
};

export {};
