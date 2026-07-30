import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceBattleRound,
  beginAiCalculation,
  beginRoundResolution,
  compareBattleSides,
  createBattle,
  lockAiAction,
  lockPlayerAction,
  recommendRandomAction,
  resolveBattleRound,
} from "./battle.ts";
import type { GameState } from "../game-core/game.ts";
import type { RandomSource } from "../game-core/random.ts";
import type { SpiritCard } from "../game-core/spirits.ts";
import { RULES_VERSION, SCHEMA_VERSION } from "../game-core/types.ts";
import { getBoardDefinition } from "../game-data/boards.ts";

class SequenceRandom implements RandomSource {
  #values: number[];
  consumed = 0;

  constructor(values: readonly number[]) {
    this.#values = [...values];
  }

  nextUint32(): number {
    return this.#take();
  }

  nextFloat(): number {
    return this.#take() / 0x1_0000_0000;
  }

  nextInt(maxExclusive: number): number {
    const value = this.#take();
    if (value < 0 || value >= maxExclusive) {
      throw new Error("Sequence value is outside the requested range.");
    }
    return value;
  }

  #take(): number {
    const value = this.#values.shift();
    if (value === undefined) {
      throw new Error("SequenceRandom has no values left.");
    }
    this.consumed += 1;
    return value;
  }
}

test("battle starts both sides from equal but independent state copies", () => {
  const initial = playingState();
  const battle = createBattle(initial);

  assert.equal(battle.phase, "PLAYER_DECIDING");
  assert.deepEqual(battle.player, battle.ai);
  assert.notEqual(battle.player, battle.ai);
  assert.notEqual(battle.player.board, battle.ai.board);
  assert.notEqual(battle.player.spiritQueue, battle.ai.spiritQueue);
});

test("a round hides choices until both lock and resolves with independent random", () => {
  const definition = getBoardDefinition("SHOULDERS", 1);
  let battle = createBattle(playingState());
  const action = { type: "REROLL_SPIRIT", activeIndex: 0 } as const;

  const playerLocked = lockPlayerAction(definition, battle, action);
  assert.equal(playerLocked.ok, true);
  if (!playerLocked.ok) return;
  battle = playerLocked.state;
  assert.equal(battle.phase, "PLAYER_LOCKED");
  assert.equal(battle.pendingAiAction, undefined);

  const calculating = beginAiCalculation(battle);
  assert.equal(calculating.ok, true);
  if (!calculating.ok) return;
  battle = calculating.state;

  const aiLocked = lockAiAction(definition, battle, action);
  assert.equal(aiLocked.ok, true);
  if (!aiLocked.ok) return;
  battle = aiLocked.state;
  assert.equal(battle.phase, "BOTH_REVEALED");

  const resolving = beginRoundResolution(battle);
  assert.equal(resolving.ok, true);
  if (!resolving.ok) return;
  battle = resolving.state;
  assert.equal(battle.phase, "RESOLVING");

  const resolved = resolveBattleRound(
    definition,
    battle,
    new SequenceRandom([0]),
    new SequenceRandom([122]),
  );
  assert.equal(resolved.ok, true);
  if (!resolved.ok) return;
  battle = resolved.state;
  assert.equal(battle.phase, "ROUND_SUMMARY");
  assert.equal(battle.history.length, 1);
  assert.notEqual(
    battle.player.spiritQueue.preview[2]?.spiritId,
    battle.ai.spiritQueue.preview[2]?.spiritId,
  );

  const advanced = advanceBattleRound(battle);
  assert.equal(advanced.ok, true);
  if (!advanced.ok) return;
  assert.equal(advanced.state.phase, "PLAYER_DECIDING");
  assert.equal(advanced.state.round, 2);
});

test("random baseline AI uses only its simulation random stream", () => {
  const definition = getBoardDefinition("SHOULDERS", 1);
  const simulationRandom = new SequenceRandom([0]);
  const playerGameplayRandom = new SequenceRandom([17]);
  const aiGameplayRandom = new SequenceRandom([23]);
  const recommendation = recommendRandomAction(
    definition,
    playingState(),
    simulationRandom,
  );

  assert.equal(recommendation.strategy, "RANDOM_BASELINE");
  assert.ok(recommendation.legalActionCount > 0);
  assert.equal(simulationRandom.consumed, 1);
  assert.equal(playerGameplayRandom.consumed, 0);
  assert.equal(aiGameplayRandom.consumed, 0);
});

test("comparison follows clear, grade, summons, and remaining tiles", () => {
  const playing = playingState();
  const cleared = clearedState(3, 7);
  assert.deepEqual(compareBattleSides(cleared, playing), {
    winner: "PLAYER",
    reason: "CLEAR_STATUS",
  });
  assert.deepEqual(
    compareBattleSides(clearedState(3, 8), clearedState(2, 6)),
    { winner: "PLAYER", reason: "CLEAR_GRADE" },
  );
  assert.deepEqual(
    compareBattleSides(clearedState(3, 7), clearedState(3, 8)),
    { winner: "PLAYER", reason: "SUMMON_COUNT" },
  );
  assert.deepEqual(compareBattleSides(playingState(1), playingState(2)), {
    winner: "PLAYER",
    reason: "REMAINING_ANCIENT",
  });
  assert.deepEqual(
    compareBattleSides(clearedState(3, 7), clearedState(3, 7)),
    { winner: "TIE", reason: "TIE" },
  );
});

test("invalid phase transitions do not alter the battle", () => {
  const definition = getBoardDefinition("SHOULDERS", 1);
  const battle = createBattle(playingState());
  const result = lockAiAction(
    definition,
    battle,
    { type: "REROLL_SPIRIT", activeIndex: 0 },
  );

  assert.deepEqual(result, {
    ok: false,
    error: "AI action can only be locked while AI is calculating.",
  });
  assert.equal(battle.phase, "PLAYER_DECIDING");
});

function playingState(ancientCount = 3): GameState {
  const positions = [
    { row: 0, column: 0 },
    { row: 0, column: 1 },
    { row: 0, column: 2 },
  ].slice(0, ancientCount);
  return {
    schemaVersion: SCHEMA_VERSION,
    rulesVersion: RULES_VERSION,
    board: {
      definitionId: { equipmentPart: "SHOULDERS", stage: 1 },
      size: 6,
      tiles: positions.map((position) => ({
        id: `tile:${position.row},${position.column}`,
        position,
        kind: "ANCIENT",
      })),
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

function clearedState(grade: 0 | 1 | 2 | 3, summonCount: number): GameState {
  return {
    ...playingState(0),
    board: {
      ...playingState(0).board,
      tiles: [],
    },
    summonCount,
    status: "CLEARED",
    clearGrade: grade,
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
