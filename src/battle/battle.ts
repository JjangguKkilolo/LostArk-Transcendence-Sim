import {
  applyAction,
  getLegalActions,
  type GameAction,
  type GameEvent,
  type GameState,
} from "../game-core/game.ts";
import type { RandomSource } from "../game-core/random.ts";
import type { BoardDefinition } from "../game-core/types.ts";

export type BattlePhase =
  | "PLAYER_DECIDING"
  | "PLAYER_LOCKED"
  | "AI_CALCULATING"
  | "BOTH_REVEALED"
  | "RESOLVING"
  | "ROUND_SUMMARY"
  | "BATTLE_FINISHED";

export type BattleSide = "PLAYER" | "AI";
export type BattleWinner = BattleSide | "TIE";

export type BattleComparisonReason =
  | "CLEAR_STATUS"
  | "CLEAR_GRADE"
  | "SUMMON_COUNT"
  | "REMAINING_ANCIENT"
  | "TIE";

export type BattleComparison = Readonly<{
  winner: BattleWinner;
  reason: BattleComparisonReason;
}>;

export type BattleRound = Readonly<{
  round: number;
  playerAction?: GameAction;
  aiAction?: GameAction;
  playerBefore: GameState;
  aiBefore: GameState;
  playerAfter: GameState;
  aiAfter: GameState;
  playerEvents: readonly GameEvent[];
  aiEvents: readonly GameEvent[];
  comparison: BattleComparison;
}>;

export type BattleState = Readonly<{
  phase: BattlePhase;
  round: number;
  player: GameState;
  ai: GameState;
  pendingPlayerAction?: GameAction;
  pendingAiAction?: GameAction;
  latestRound?: BattleRound;
  history: readonly BattleRound[];
  result?: BattleComparison;
}>;

export type BattleTransition =
  | Readonly<{ ok: true; state: BattleState }>
  | Readonly<{ ok: false; error: string }>;

export type AiRecommendation = Readonly<{
  action: GameAction;
  legalActionCount: number;
  strategy: string;
}>;

export interface AiRecommender {
  recommend(
    definition: BoardDefinition,
    state: GameState,
    simulationRandom: RandomSource,
  ): Promise<AiRecommendation>;
}

export function createBattle(initialGame: GameState): BattleState {
  const player = cloneGameState(initialGame);
  const ai = cloneGameState(initialGame);
  const finished = player.status === "CLEARED" && ai.status === "CLEARED";

  return {
    phase: finished ? "BATTLE_FINISHED" : nextDecisionPhase(player, ai),
    round: 1,
    player,
    ai,
    history: [],
    ...(finished ? { result: compareBattleSides(player, ai) } : {}),
  };
}

export function lockPlayerAction(
  definition: BoardDefinition,
  state: BattleState,
  action: GameAction,
): BattleTransition {
  if (state.phase !== "PLAYER_DECIDING") {
    return failure("Player action can only be locked while deciding.");
  }
  if (!isLegalAction(definition, state.player, action)) {
    return failure("Player action is not legal for the current game state.");
  }
  return {
    ok: true,
    state: {
      ...state,
      phase: "PLAYER_LOCKED",
      pendingPlayerAction: cloneAction(action),
    },
  };
}

export function beginAiCalculation(state: BattleState): BattleTransition {
  if (state.phase !== "PLAYER_LOCKED") {
    return failure("AI calculation can only begin after player lock.");
  }
  return { ok: true, state: { ...state, phase: "AI_CALCULATING" } };
}

export function lockAiAction(
  definition: BoardDefinition,
  state: BattleState,
  action: GameAction,
): BattleTransition {
  if (state.phase !== "AI_CALCULATING") {
    return failure("AI action can only be locked while AI is calculating.");
  }
  if (!isLegalAction(definition, state.ai, action)) {
    return failure("AI action is not legal for the current game state.");
  }
  return {
    ok: true,
    state: {
      ...state,
      phase: "BOTH_REVEALED",
      pendingAiAction: cloneAction(action),
    },
  };
}

export function resolveBattleRound(
  definition: BoardDefinition,
  state: BattleState,
  playerGameplayRandom: RandomSource,
  aiGameplayRandom: RandomSource,
): BattleTransition {
  if (state.phase !== "RESOLVING") {
    return failure("A round can only resolve during the resolving phase.");
  }
  if (
    state.player.status === "PLAYING" &&
    state.pendingPlayerAction === undefined
  ) {
    return failure("A playing player is missing a locked action.");
  }
  if (state.ai.status === "PLAYING" && state.pendingAiAction === undefined) {
    return failure("A playing AI is missing a locked action.");
  }

  const playerResult =
    state.pendingPlayerAction === undefined
      ? { ok: true as const, state: state.player, events: [] }
      : applyAction(
          definition,
          state.player,
          state.pendingPlayerAction,
          playerGameplayRandom,
        );
  if (!playerResult.ok) {
    return failure(`Player resolution failed: ${playerResult.error.message}`);
  }
  const aiResult =
    state.pendingAiAction === undefined
      ? { ok: true as const, state: state.ai, events: [] }
      : applyAction(
          definition,
          state.ai,
          state.pendingAiAction,
          aiGameplayRandom,
        );
  if (!aiResult.ok) {
    return failure(`AI resolution failed: ${aiResult.error.message}`);
  }

  const comparison = compareBattleSides(playerResult.state, aiResult.state);
  const round: BattleRound = {
    round: state.round,
    ...(state.pendingPlayerAction === undefined
      ? {}
      : { playerAction: state.pendingPlayerAction }),
    ...(state.pendingAiAction === undefined
      ? {}
      : { aiAction: state.pendingAiAction }),
    playerBefore: state.player,
    aiBefore: state.ai,
    playerAfter: playerResult.state,
    aiAfter: aiResult.state,
    playerEvents: playerResult.events,
    aiEvents: aiResult.events,
    comparison,
  };

  return {
    ok: true,
    state: {
      phase: "ROUND_SUMMARY",
      round: state.round,
      player: playerResult.state,
      ai: aiResult.state,
      latestRound: round,
      history: [...state.history, round],
    },
  };
}

export function beginRoundResolution(state: BattleState): BattleTransition {
  if (state.phase !== "BOTH_REVEALED") {
    return failure("Resolution can only begin after both actions are revealed.");
  }
  return { ok: true, state: { ...state, phase: "RESOLVING" } };
}

export function advanceBattleRound(state: BattleState): BattleTransition {
  if (state.phase !== "ROUND_SUMMARY") {
    return failure("Only a summarized round can advance.");
  }
  const finished =
    state.player.status === "CLEARED" && state.ai.status === "CLEARED";
  if (finished) {
    return {
      ok: true,
      state: {
        ...state,
        phase: "BATTLE_FINISHED",
        result: compareBattleSides(state.player, state.ai),
      },
    };
  }

  return {
    ok: true,
    state: {
      phase: nextDecisionPhase(state.player, state.ai),
      round: state.round + 1,
      player: state.player,
      ai: state.ai,
      history: state.history,
    },
  };
}

export function prepareAiOnlyRound(state: BattleState): BattleTransition {
  if (
    state.phase !== "AI_CALCULATING" ||
    state.player.status !== "CLEARED" ||
    state.ai.status !== "PLAYING"
  ) {
    return failure("AI-only preparation requires a finished player.");
  }
  return { ok: true, state };
}

export function lockAiOnlyAction(
  definition: BoardDefinition,
  state: BattleState,
  action: GameAction,
): BattleTransition {
  return lockAiAction(definition, state, action);
}

export function revealPlayerOnlyAction(
  definition: BoardDefinition,
  state: BattleState,
  action: GameAction,
): BattleTransition {
  if (
    state.phase !== "PLAYER_DECIDING" ||
    state.player.status !== "PLAYING" ||
    state.ai.status !== "CLEARED"
  ) {
    return failure("Player-only reveal requires a finished AI.");
  }
  if (!isLegalAction(definition, state.player, action)) {
    return failure("Player action is not legal for the current game state.");
  }
  return {
    ok: true,
    state: {
      ...state,
      phase: "BOTH_REVEALED",
      pendingPlayerAction: cloneAction(action),
    },
  };
}

export function compareBattleSides(
  player: GameState,
  ai: GameState,
): BattleComparison {
  if (player.status !== ai.status) {
    return {
      winner: player.status === "CLEARED" ? "PLAYER" : "AI",
      reason: "CLEAR_STATUS",
    };
  }
  const playerGrade = player.clearGrade ?? -1;
  const aiGrade = ai.clearGrade ?? -1;
  if (playerGrade !== aiGrade) {
    return {
      winner: playerGrade > aiGrade ? "PLAYER" : "AI",
      reason: "CLEAR_GRADE",
    };
  }
  if (player.summonCount !== ai.summonCount) {
    return {
      winner: player.summonCount < ai.summonCount ? "PLAYER" : "AI",
      reason: "SUMMON_COUNT",
    };
  }
  const playerRemaining = countAncient(player);
  const aiRemaining = countAncient(ai);
  if (playerRemaining !== aiRemaining) {
    return {
      winner: playerRemaining < aiRemaining ? "PLAYER" : "AI",
      reason: "REMAINING_ANCIENT",
    };
  }
  return { winner: "TIE", reason: "TIE" };
}

export function recommendRandomAction(
  definition: BoardDefinition,
  state: GameState,
  simulationRandom: RandomSource,
): AiRecommendation {
  const legalActions = getLegalActions(definition, state);
  if (legalActions.length === 0) {
    throw new Error("AI has no legal action to recommend.");
  }
  const action = legalActions[simulationRandom.nextInt(legalActions.length)];
  if (action === undefined) {
    throw new Error("AI recommendation escaped legal action bounds.");
  }
  return {
    action,
    legalActionCount: legalActions.length,
    strategy: "RANDOM_BASELINE",
  };
}

function nextDecisionPhase(player: GameState, ai: GameState): BattlePhase {
  if (player.status === "PLAYING") return "PLAYER_DECIDING";
  if (ai.status === "PLAYING") return "AI_CALCULATING";
  return "BATTLE_FINISHED";
}

function isLegalAction(
  definition: BoardDefinition,
  state: GameState,
  action: GameAction,
): boolean {
  return getLegalActions(definition, state).some(
    (candidate) => actionKey(candidate) === actionKey(action),
  );
}

function actionKey(action: GameAction): string {
  return action.type === "REROLL_SPIRIT"
    ? `${action.type}:${action.activeIndex}`
    : `${action.type}:${action.activeIndex}:${action.target.row},${action.target.column}`;
}

function cloneAction(action: GameAction): GameAction {
  return action.type === "REROLL_SPIRIT"
    ? { ...action }
    : { ...action, target: { ...action.target } };
}

function cloneGameState(state: GameState): GameState {
  return {
    ...state,
    board: {
      ...state.board,
      definitionId: { ...state.board.definitionId },
      tiles: state.board.tiles.map((tile) => ({
        ...tile,
        position: { ...tile.position },
      })),
    },
    spiritQueue: {
      ...state.spiritQueue,
      active: state.spiritQueue.active.map((card) => ({ ...card })) as [
        typeof state.spiritQueue.active[0],
        typeof state.spiritQueue.active[1],
      ],
      preview: state.spiritQueue.preview.map((card) => ({ ...card })) as [
        typeof state.spiritQueue.preview[0],
        typeof state.spiritQueue.preview[1],
        typeof state.spiritQueue.preview[2],
      ],
    },
  };
}

function countAncient(state: GameState): number {
  return state.board.tiles.filter(({ kind }) => kind === "ANCIENT").length;
}

function failure(error: string): BattleTransition {
  return { ok: false, error };
}
