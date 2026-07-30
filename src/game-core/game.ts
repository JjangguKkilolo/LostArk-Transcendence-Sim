import {
  createElzowinAttackPlan,
  createFixedAttackPlan,
  createLightningAttackPlan,
  createLinearAttackPlan,
  createOutburstAttackPlan,
  isFixedPatternSpirit,
  isLinearPatternSpirit,
  type AttackPlan,
} from "./attacks.ts";
import {
  createBoardSetup,
  createPlayablePositions,
  isPositionInShape,
  positionKey,
} from "./board.ts";
import { calculateGrade } from "./grading.ts";
import type { RandomSource } from "./random.ts";
import {
  resolveAttackPlan,
  type AttackResolutionEvent,
} from "./resolution.ts";
import {
  resolveSpecialTileTurn,
  validateSpecialTileInvariant,
  type SpecialTileEvent,
} from "./special-tiles.ts";
import {
  consumeUsedSpiritWithOther,
  createSpiritQueue,
  rerollActiveSpirit,
  validateSpiritQueue,
  type ActiveSpiritIndex,
  type SpiritCard,
  type SpiritFlowEvent,
  type SpiritQueueState,
} from "./spirits.ts";
import {
  RULES_VERSION,
  SCHEMA_VERSION,
  type BoardDefinition,
  type BoardState,
  type ClearGrade,
  type Position,
} from "./types.ts";

export type GameStatus = "PLAYING" | "CLEARED";

export type GameState = Readonly<{
  schemaVersion: typeof SCHEMA_VERSION;
  rulesVersion: typeof RULES_VERSION;
  board: BoardState;
  spiritQueue: SpiritQueueState;
  actionCount: number;
  summonCount: number;
  graceLevel: number;
  status: GameStatus;
  clearGrade?: ClearGrade;
}>;

export type GameAction =
  | Readonly<{
      type: "USE_SPIRIT";
      activeIndex: ActiveSpiritIndex;
      target: Position;
    }>
  | Readonly<{
      type: "REROLL_SPIRIT";
      activeIndex: ActiveSpiritIndex;
    }>;

export type GameEvent =
  | Readonly<{
      type: "BOARD_CREATED";
      boardId: BoardState["definitionId"];
    }>
  | Readonly<{
      type: "GRACE_APPLIED";
      level: number;
      normalized: readonly Position[];
    }>
  | Readonly<{ type: "GAME_READY" }>
  | Readonly<{ type: "ACTION_ACCEPTED"; action: GameAction }>
  | Readonly<{
      type: "SPIRIT_CAST";
      activeIndex: ActiveSpiritIndex;
      spirit: SpiritCard;
      target: Position;
    }>
  | AttackResolutionEvent
  | SpecialTileEvent
  | SpiritFlowEvent
  | Readonly<{
      type: "TURN_COMPLETED";
      actionCount: number;
      summonCount: number;
    }>
  | Readonly<{
      type: "GAME_CLEARED";
      grade: ClearGrade;
      summonCount: number;
    }>;

export type RuleErrorCode =
  | "GAME_ALREADY_FINISHED"
  | "ILLEGAL_ACTIVE_INDEX"
  | "ILLEGAL_TARGET"
  | "NO_REROLLS_REMAINING"
  | "RULESET_MISMATCH"
  | "INVALID_DATA"
  | "INVARIANT_VIOLATION";

export type RuleError = Readonly<{
  code: RuleErrorCode;
  message: string;
}>;

export type GameTransition =
  | Readonly<{
      ok: true;
      state: GameState;
      events: readonly GameEvent[];
    }>
  | Readonly<{
      ok: false;
      error: RuleError;
    }>;

export function createGame(
  definition: BoardDefinition,
  graceLevel: number,
  random: RandomSource,
): GameTransition {
  try {
    const setup = createBoardSetup(definition, graceLevel, random);
    const queue = createSpiritQueue(setup.rerollsRemaining, random);
    const state: GameState = {
      schemaVersion: SCHEMA_VERSION,
      rulesVersion: RULES_VERSION,
      board: setup.board,
      spiritQueue: queue.state,
      actionCount: 0,
      summonCount: 0,
      graceLevel,
      status: "PLAYING",
    };
    assertGameState(definition, state);
    return {
      ok: true,
      state,
      events: [
        { type: "BOARD_CREATED", boardId: setup.board.definitionId },
        {
          type: "GRACE_APPLIED",
          level: graceLevel,
          normalized: setup.normalizedDistortedPositions,
        },
        ...queue.events,
        { type: "GAME_READY" },
      ],
    };
  } catch (error) {
    return failure("INVALID_DATA", error);
  }
}

export function getLegalActions(
  definition: BoardDefinition,
  state: GameState,
): GameAction[] {
  if (state.status !== "PLAYING") return [];

  const actions: GameAction[] = [];
  const tileByPosition = new Map(
    state.board.tiles.map((tile) => [positionKey(tile.position), tile]),
  );

  for (const activeIndex of [0, 1] as const) {
    const spirit = state.spiritQueue.active[activeIndex];
    for (const target of createPlayablePositions(definition)) {
      const tile = tileByPosition.get(positionKey(target));
      const isElzowin =
        spirit.spiritId === "PURIFY" ||
        spirit.spiritId === "WORLD_TREE_RESONANCE";
      if (tile?.kind === "DISTORTED" && !isElzowin) continue;
      if (
        (spirit.spiritId === "LIGHTNING" ||
          spirit.spiritId === "OUTBURST") &&
        tile?.kind !== "ANCIENT"
      ) {
        continue;
      }
      actions.push({ type: "USE_SPIRIT", activeIndex, target });
    }
    if (state.spiritQueue.rerollsRemaining > 0) {
      actions.push({ type: "REROLL_SPIRIT", activeIndex });
    }
  }

  return actions;
}

export function applyAction(
  definition: BoardDefinition,
  state: GameState,
  action: GameAction,
  random: RandomSource,
): GameTransition {
  const validation = validateAction(definition, state, action);
  if (validation !== undefined) return { ok: false, error: validation };

  try {
    if (action.type === "REROLL_SPIRIT") {
      const queue = rerollActiveSpirit(
        state.spiritQueue,
        action.activeIndex,
        random,
      );
      const nextState: GameState = {
        ...state,
        spiritQueue: queue.state,
        actionCount: state.actionCount + 1,
      };
      assertGameState(definition, nextState);
      return {
        ok: true,
        state: nextState,
        events: [
          { type: "ACTION_ACCEPTED", action },
          ...queue.events,
          {
            type: "TURN_COMPLETED",
            actionCount: nextState.actionCount,
            summonCount: nextState.summonCount,
          },
        ],
      };
    }

    const usedSpirit = state.spiritQueue.active[action.activeIndex];
    const otherIndex: ActiveSpiritIndex =
      action.activeIndex === 0 ? 1 : 0;
    const otherSpirit = state.spiritQueue.active[otherIndex];
    const plan = createAttackPlan(
      definition,
      state.board,
      usedSpirit,
      action.target,
    );
    const attack = resolveAttackPlan(definition, state.board, plan, random);
    const destroyedTiles = attack.events
      .filter(
        (
          event,
        ): event is Extract<
          AttackResolutionEvent,
          { type: "TILE_DESTROYED" }
        > => event.type === "TILE_DESTROYED",
      )
      .map(({ tile }) => tile);
    const specials = resolveSpecialTileTurn(
      definition,
      attack.board,
      destroyedTiles,
      usedSpirit,
      otherSpirit,
      random,
    );
    const rerollDelta = specials.appliedEffect?.rerollDelta ?? 0;
    const summonDelta = specials.appliedEffect?.summonDelta ?? 0;
    const affectedOther =
      specials.appliedEffect?.otherSpirit ?? otherSpirit;
    const queue = consumeUsedSpiritWithOther(
      {
        ...state.spiritQueue,
        rerollsRemaining:
          state.spiritQueue.rerollsRemaining + rerollDelta,
      },
      action.activeIndex,
      affectedOther,
      random,
    );
    const summonCount = state.summonCount + 1 + summonDelta;
    const cleared = !specials.board.tiles.some(
      ({ kind }) => kind === "ANCIENT",
    );
    const grade = cleared
      ? calculateGrade(summonCount, definition.grade3Cutline)
      : undefined;
    const nextState: GameState = {
      ...state,
      board: specials.board,
      spiritQueue: queue.state,
      actionCount: state.actionCount + 1,
      summonCount,
      status: cleared ? "CLEARED" : "PLAYING",
      ...(grade === undefined ? {} : { clearGrade: grade }),
    };
    assertGameState(definition, nextState);
    const events: GameEvent[] = [
      { type: "ACTION_ACCEPTED", action },
      {
        type: "SPIRIT_CAST",
        activeIndex: action.activeIndex,
        spirit: usedSpirit,
        target: action.target,
      },
      ...attack.events,
      ...specials.events,
      ...queue.events,
      {
        type: "TURN_COMPLETED",
        actionCount: nextState.actionCount,
        summonCount: nextState.summonCount,
      },
    ];
    if (grade !== undefined) {
      events.push({ type: "GAME_CLEARED", grade, summonCount });
    }
    return { ok: true, state: nextState, events };
  } catch (error) {
    return failure("INVARIANT_VIOLATION", error);
  }
}

export function assertGameState(
  definition: BoardDefinition,
  state: GameState,
): void {
  if (
    state.schemaVersion !== SCHEMA_VERSION ||
    state.rulesVersion !== RULES_VERSION
  ) {
    throw new Error("Game state rules or schema version does not match.");
  }
  if (
    definition.id.equipmentPart !==
      state.board.definitionId.equipmentPart ||
    definition.id.stage !== state.board.definitionId.stage
  ) {
    throw new Error("Game state board definition does not match.");
  }
  validateSpiritQueue(state.spiritQueue);
  validateSpecialTileInvariant(state.board);
  if (
    !Number.isSafeInteger(state.actionCount) ||
    state.actionCount < 0 ||
    !Number.isSafeInteger(state.summonCount) ||
    state.summonCount < 0
  ) {
    throw new Error("Game counters must be non-negative safe integers.");
  }
  const hasAncient = state.board.tiles.some(({ kind }) => kind === "ANCIENT");
  if (state.status === "CLEARED") {
    if (hasAncient || state.clearGrade === undefined) {
      throw new Error("A cleared game cannot contain ancient tiles.");
    }
  } else if (state.clearGrade !== undefined) {
    throw new Error("A playing game cannot have a clear grade.");
  }
}

function validateAction(
  definition: BoardDefinition,
  state: GameState,
  action: GameAction,
): RuleError | undefined {
  if (
    state.schemaVersion !== SCHEMA_VERSION ||
    state.rulesVersion !== RULES_VERSION
  ) {
    return {
      code: "RULESET_MISMATCH",
      message: "Game state uses a different schema or rules version.",
    };
  }
  if (state.status !== "PLAYING") {
    return {
      code: "GAME_ALREADY_FINISHED",
      message: "A completed game cannot accept another action.",
    };
  }
  if (action.activeIndex !== 0 && action.activeIndex !== 1) {
    return {
      code: "ILLEGAL_ACTIVE_INDEX",
      message: "Active spirit index must be 0 or 1.",
    };
  }
  try {
    assertGameState(definition, state);
  } catch (error) {
    return {
      code: "INVALID_DATA",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  if (action.type === "REROLL_SPIRIT") {
    return state.spiritQueue.rerollsRemaining > 0
      ? undefined
      : {
          code: "NO_REROLLS_REMAINING",
          message: "No spirit rerolls remain.",
        };
  }
  if (
    !isPositionInShape(action.target, definition.size, definition.shape) ||
    !getLegalActions(definition, state).some(
      (legal) =>
        legal.type === "USE_SPIRIT" &&
        legal.activeIndex === action.activeIndex &&
        positionKey(legal.target) === positionKey(action.target),
    )
  ) {
    return { code: "ILLEGAL_TARGET", message: "Spirit target is not legal." };
  }
  return undefined;
}

function createAttackPlan(
  definition: BoardDefinition,
  board: BoardState,
  spirit: SpiritCard,
  target: Position,
): AttackPlan {
  if (isFixedPatternSpirit(spirit.spiritId)) {
    return createFixedAttackPlan(definition, board, spirit, target);
  }
  if (isLinearPatternSpirit(spirit.spiritId)) {
    return createLinearAttackPlan(definition, board, spirit, target);
  }
  if (
    spirit.spiritId === "PURIFY" ||
    spirit.spiritId === "WORLD_TREE_RESONANCE"
  ) {
    return createElzowinAttackPlan(definition, board, spirit, target);
  }
  if (spirit.spiritId === "LIGHTNING") {
    return createLightningAttackPlan(definition, board, spirit, target);
  }
  return createOutburstAttackPlan(definition, board, spirit, target);
}

function failure(code: RuleErrorCode, error: unknown): GameTransition {
  return {
    ok: false,
    error: {
      code,
      message: error instanceof Error ? error.message : String(error),
    },
  };
}
