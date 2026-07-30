import assert from "node:assert/strict";
import test from "node:test";

import {
  createFixedAttackPlan,
  createElzowinAttackPlan,
  createLinearAttackPlan,
  createOutburstAttackPlan,
  rollAttackPlan,
} from "./attacks.ts";
import { createBoardSetup, positionKey } from "./board.ts";
import type { RandomSource } from "./random.ts";
import { SeededRandom } from "./random.ts";
import type {
  FixedPatternSpiritId,
  LinearPatternSpiritId,
} from "./attacks.ts";
import type { SpiritCard, SpiritLevel } from "./spirits.ts";
import { getBoardDefinition } from "../game-data/boards.ts";

class SequenceRandom implements RandomSource {
  #values: number[];

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
    return value;
  }
}

const INTERIOR_PATTERN_COUNTS: Readonly<Record<FixedPatternSpiritId, number>> = {
  HELLFIRE: 13,
  THUNDER_STRIKE: 5,
  TORNADO: 5,
  SHOCKWAVE: 9,
};

const LINEAR_PATTERN_COUNTS: Readonly<Record<LinearPatternSpiritId, number>> = {
  GREAT_EXPLOSION: 10,
  EARTHQUAKE: 6,
  RAINSTORM: 6,
  TIDAL_WAVE: 11,
};

test("fixed spirits produce their full documented interior patterns", () => {
  const definition = getBoardDefinition("SHOULDERS", 1);
  const board = createBoardSetup(definition, 0, new SeededRandom(1)).board;

  for (const [spiritId, expectedCount] of Object.entries(
    INTERIOR_PATTERN_COUNTS,
  ) as [FixedPatternSpiritId, number][]) {
    const plan = createFixedAttackPlan(
      definition,
      board,
      card(spiritId, 1),
      { row: 2, column: 2 },
    );

    assert.equal(plan.candidates.length, expectedCount, spiritId);
    assert.deepEqual(
      plan.candidates.map(({ position }) => positionKey(position)),
      [...plan.candidates]
        .sort(
          (left, right) =>
            left.position.row - right.position.row ||
            left.position.column - right.position.column,
        )
        .map(({ position }) => positionKey(position)),
    );
  }
});

test("attack patterns are clipped at the playable board edge", () => {
  const definition = getBoardDefinition("SHOULDERS", 1);
  const board = createBoardSetup(definition, 0, new SeededRandom(1)).board;
  const expected = {
    HELLFIRE: 6,
    THUNDER_STRIKE: 3,
    TORNADO: 2,
    SHOCKWAVE: 4,
  } as const;

  for (const [spiritId, expectedCount] of Object.entries(expected) as [
    FixedPatternSpiritId,
    number,
  ][]) {
    const plan = createFixedAttackPlan(
      definition,
      board,
      card(spiritId, 1),
      { row: 0, column: 0 },
    );
    assert.equal(plan.candidates.length, expectedCount, spiritId);
  }
});

test("linear spirits cover the documented rows, columns, and diagonals", () => {
  const definition = getBoardDefinition("SHOULDERS", 1);
  const board = createBoardSetup(definition, 0, new SeededRandom(1)).board;

  for (const [spiritId, expectedCount] of Object.entries(
    LINEAR_PATTERN_COUNTS,
  ) as [LinearPatternSpiritId, number][]) {
    const plan = createLinearAttackPlan(
      definition,
      board,
      linearCard(spiritId, 1),
      { row: 2, column: 2 },
    );
    assert.equal(plan.candidates.length, expectedCount, spiritId);
    assert.equal(
      new Set(plan.candidates.map(({ position }) => positionKey(position))).size,
      expectedCount,
      `${spiritId} must not duplicate its center`,
    );
  }
});

test("linear level one chance loses 15 percent per step with a 10 percent floor", () => {
  const definition = getBoardDefinition("SHOULDERS", 6);
  const board = createBoardSetup(definition, 0, new SeededRandom(1)).board;
  const plan = createLinearAttackPlan(
    definition,
    board,
    linearCard("EARTHQUAKE", 1),
    { row: 0, column: 0 },
  );

  assert.equal(chanceAt(plan, 0, 0), 10_000);
  assert.equal(chanceAt(plan, 0, 1), 8_500);
  assert.equal(chanceAt(plan, 0, 5), 2_500);
  assert.equal(chanceAt(plan, 0, 6), 1_000);
  assert.equal(chanceAt(plan, 0, 7), 1_000);
});

test("linear level two is guaranteed and level three ignores distorted", () => {
  const definition = getBoardDefinition("WEAPON", 1);
  const board = createBoardSetup(definition, 0, new SeededRandom(1)).board;
  const target = { row: 1, column: 3 };
  const levelTwo = createLinearAttackPlan(
    definition,
    board,
    linearCard("TIDAL_WAVE", 2),
    target,
  );
  const levelThree = createLinearAttackPlan(
    definition,
    board,
    linearCard("TIDAL_WAVE", 3),
    target,
  );

  assert.equal(chanceAt(levelTwo, target.row, target.column), 10_000);
  assert.equal(chanceAt(levelThree, 1, 2), 0);
  assert.ok(
    levelThree.candidates
      .filter(({ tileKind }) => tileKind === "ANCIENT")
      .every(({ destroyChance }) => destroyChance === 10_000),
  );
});

test("level one center and non-center chances match each spirit", () => {
  const definition = getBoardDefinition("SHOULDERS", 1);
  const board = createBoardSetup(definition, 0, new SeededRandom(1)).board;

  const thunder = createFixedAttackPlan(
    definition,
    board,
    card("THUNDER_STRIKE", 1),
    { row: 2, column: 2 },
  );
  const shockwave = createFixedAttackPlan(
    definition,
    board,
    card("SHOCKWAVE", 1),
    { row: 2, column: 2 },
  );

  assert.equal(chanceAt(thunder, 2, 2), 10_000);
  assert.equal(chanceAt(thunder, 2, 3), 5_000);
  assert.equal(chanceAt(shockwave, 1, 1), 7_500);
});

test("level two is guaranteed and level three ignores distorted tiles", () => {
  const definition = getBoardDefinition("WEAPON", 1);
  const board = createBoardSetup(definition, 0, new SeededRandom(1)).board;
  const target = { row: 1, column: 3 };

  const levelTwo = createFixedAttackPlan(
    definition,
    board,
    card("SHOCKWAVE", 2),
    target,
  );
  const levelThree = createFixedAttackPlan(
    definition,
    board,
    card("SHOCKWAVE", 3),
    target,
  );

  assert.equal(chanceAt(levelTwo, target.row, target.column), 10_000);
  assert.equal(chanceAt(levelThree, 1, 2), 0);
  assert.ok(
    levelThree.candidates
      .filter(({ tileKind }) => tileKind === "ANCIENT")
      .every(({ destroyChance }) => destroyChance === 10_000),
  );
});

test("purify expands from a horizontal line to a cross and destroys distorted", () => {
  const definition = getBoardDefinition("WEAPON", 1);
  const board = createBoardSetup(definition, 0, new SeededRandom(1)).board;
  const target = { row: 1, column: 2 };
  const levelOne = createElzowinAttackPlan(
    definition,
    board,
    normalCard("PURIFY", 1),
    target,
  );
  const levelTwo = createElzowinAttackPlan(
    definition,
    board,
    normalCard("PURIFY", 2),
    target,
  );
  const levelThree = createElzowinAttackPlan(
    definition,
    board,
    normalCard("PURIFY", 3),
    target,
  );

  assert.equal(levelOne.candidates.length, 3);
  assert.equal(chanceAt(levelOne, 1, 1), 5_000);
  assert.equal(chanceAt(levelOne, 1, 2), 10_000);
  assert.equal(chanceAt(levelTwo, 1, 1), 10_000);
  assert.equal(levelThree.candidates.length, 5);
  assert.equal(levelThree.distortedInteraction, "DESTROY_WITHOUT_RESTORE");
  assert.ok(
    levelThree.candidates
      .filter(({ tileKind }) => tileKind === "DISTORTED")
      .every(({ destroyChance }) => destroyChance === 10_000),
  );
});

test("world tree resonance is a guaranteed radius-two cross", () => {
  const definition = getBoardDefinition("SHOULDERS", 1);
  const board = createBoardSetup(definition, 0, new SeededRandom(1)).board;
  const plan = createElzowinAttackPlan(
    definition,
    board,
    mysteryCard("WORLD_TREE_RESONANCE"),
    { row: 2, column: 2 },
  );

  assert.equal(plan.candidates.length, 9);
  assert.equal(plan.distortedInteraction, "DESTROY_WITHOUT_RESTORE");
  assert.ok(
    plan.candidates.every(
      ({ destroyChance }) => destroyChance === 10_000,
    ),
  );
});

test("outburst destroys one normal target and cannot target distorted", () => {
  const definition = getBoardDefinition("WEAPON", 1);
  const board = createBoardSetup(definition, 0, new SeededRandom(1)).board;
  const spirit = mysteryCard("OUTBURST");
  const plan = createOutburstAttackPlan(
    definition,
    board,
    spirit,
    { row: 1, column: 3 },
  );

  assert.equal(plan.candidates.length, 1);
  assert.equal(plan.candidates[0]?.destroyChance, 10_000);
  assert.throws(
    () =>
      createOutburstAttackPlan(
        definition,
        board,
        spirit,
        { row: 1, column: 2 },
      ),
    /cannot target a distorted tile/,
  );
});

test("non-Elzowin pattern spirits cannot center an attack on distorted", () => {
  const definition = getBoardDefinition("WEAPON", 1);
  const board = createBoardSetup(definition, 0, new SeededRandom(1)).board;

  assert.throws(
    () =>
      createFixedAttackPlan(
        definition,
        board,
        card("SHOCKWAVE", 2),
        { row: 1, column: 2 },
      ),
    /cannot target a distorted tile/,
  );
});

test("attack rolling consumes randomness only for probabilistic candidates", () => {
  const definition = getBoardDefinition("SHOULDERS", 1);
  const board = createBoardSetup(definition, 0, new SeededRandom(1)).board;
  const plan = createFixedAttackPlan(
    definition,
    board,
    card("THUNDER_STRIKE", 1),
    { row: 2, column: 2 },
  );
  const result = rollAttackPlan(
    plan,
    new SequenceRandom([4_999, 5_000, 0, 9_999]),
  );

  assert.equal(result.rolls.filter(({ destroyed }) => destroyed).length, 3);
  assert.equal(
    result.rolls.find(({ candidate }) =>
      candidate.position.row === 2 && candidate.position.column === 2
    )?.roll,
    undefined,
  );
});

test("non-playable targets and unsupported spirits are rejected", () => {
  const definition = getBoardDefinition("WEAPON", 1);
  const board = createBoardSetup(definition, 0, new SeededRandom(1)).board;

  assert.throws(
    () =>
      createFixedAttackPlan(
        definition,
        board,
        card("HELLFIRE", 1),
        { row: 0, column: 0 },
      ),
    /not playable/,
  );
  assert.throws(
    () =>
      createFixedAttackPlan(
        definition,
        board,
        {
          instanceId: "card:purify",
          spiritId: "PURIFY",
          category: "NORMAL",
          level: 1,
        },
        { row: 2, column: 2 },
      ),
    /not a fixed-pattern spirit/,
  );
});

function card(
  spiritId: FixedPatternSpiritId,
  level: SpiritLevel,
): SpiritCard {
  return {
    instanceId: `card:${spiritId}:${level}`,
    spiritId,
    category: "NORMAL",
    level,
  };
}

function linearCard(
  spiritId: LinearPatternSpiritId,
  level: SpiritLevel,
): SpiritCard {
  return {
    instanceId: `card:${spiritId}:${level}`,
    spiritId,
    category: "NORMAL",
    level,
  };
}

function normalCard(
  spiritId: "PURIFY",
  level: SpiritLevel,
): SpiritCard {
  return {
    instanceId: `card:${spiritId}:${level}`,
    spiritId,
    category: "NORMAL",
    level,
  };
}

function mysteryCard(
  spiritId: "OUTBURST" | "WORLD_TREE_RESONANCE",
): SpiritCard {
  return {
    instanceId: `card:${spiritId}:1`,
    spiritId,
    category: "MYSTERY",
    level: 1,
  };
}

function chanceAt(
  plan: ReturnType<typeof createFixedAttackPlan>,
  row: number,
  column: number,
): number | undefined {
  return plan.candidates.find(
    (candidate) =>
      candidate.position.row === row && candidate.position.column === column,
  )?.destroyChance;
}
