import assert from "node:assert/strict";
import test from "node:test";

import type { RandomSource } from "./random.ts";
import {
  consumeUsedSpirit,
  createSpiritQueue,
  rerollActiveSpirit,
  validateSpiritQueue,
} from "./spirits.ts";
import {
  drawNormalSpiritId,
  NORMAL_SPIRIT_DEFINITIONS,
  NORMAL_SPIRIT_TOTAL_WEIGHT,
} from "../game-data/spirits.ts";

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
      throw new Error(`${value} is outside the requested range.`);
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

test("normal spirit weights preserve the documented 200-slot pool", () => {
  assert.equal(NORMAL_SPIRIT_DEFINITIONS.length, 10);
  assert.equal(NORMAL_SPIRIT_TOTAL_WEIGHT, 200);
  assert.deepEqual(
    NORMAL_SPIRIT_DEFINITIONS.map(({ id, appearanceWeight }) => [
      id,
      appearanceWeight,
    ]),
    [
      ["HELLFIRE", 23],
      ["GREAT_EXPLOSION", 21],
      ["LIGHTNING", 18],
      ["THUNDER_STRIKE", 30],
      ["TORNADO", 30],
      ["SHOCKWAVE", 19],
      ["EARTHQUAKE", 14],
      ["TIDAL_WAVE", 11],
      ["RAINSTORM", 14],
      ["PURIFY", 20],
    ],
  );
});

test("weighted draw uses exact lower and upper boundaries", () => {
  assert.equal(drawNormalSpiritId(new SequenceRandom([0])), "HELLFIRE");
  assert.equal(drawNormalSpiritId(new SequenceRandom([22])), "HELLFIRE");
  assert.equal(
    drawNormalSpiritId(new SequenceRandom([23])),
    "GREAT_EXPLOSION",
  );
  assert.equal(drawNormalSpiritId(new SequenceRandom([199])), "PURIFY");
});

test("initial deal resolves every automatic chain merge", () => {
  const transition = createSpiritQueue(
    2,
    new SequenceRandom([0, 0, 0, 155, 180, 23, 44]),
  );

  assert.deepEqual(
    transition.state.active.map(({ spiritId, level }) => [spiritId, level]),
    [
      ["TIDAL_WAVE", 1],
      ["HELLFIRE", 3],
    ],
  );
  assert.deepEqual(
    transition.state.preview.map(({ spiritId, level }) => [spiritId, level]),
    [
      ["PURIFY", 1],
      ["GREAT_EXPLOSION", 1],
      ["LIGHTNING", 1],
    ],
  );
  assert.equal(
    transition.events.filter(({ type }) => type === "SPIRITS_MERGED").length,
    2,
  );
  validateSpiritQueue(transition.state);
});

test("reroll consumes one reroll, advances the queue, and leaves input intact", () => {
  const initial = createSpiritQueue(
    2,
    new SequenceRandom([0, 23, 44, 62, 92]),
  ).state;
  const transition = rerollActiveSpirit(
    initial,
    0,
    new SequenceRandom([122]),
  );

  assert.equal(initial.rerollsRemaining, 2);
  assert.equal(initial.active[0].spiritId, "HELLFIRE");
  assert.equal(transition.state.rerollsRemaining, 1);
  assert.equal(transition.state.active[0].spiritId, "LIGHTNING");
  assert.deepEqual(
    transition.state.preview.map(({ spiritId }) => spiritId),
    ["THUNDER_STRIKE", "TORNADO", "SHOCKWAVE"],
  );
  assert.equal(transition.events[0]?.type, "SPIRIT_REROLLED");
});

test("using a spirit advances the same queue without consuming a reroll", () => {
  const initial = createSpiritQueue(
    4,
    new SequenceRandom([0, 23, 44, 62, 92]),
  ).state;
  const transition = consumeUsedSpirit(
    initial,
    1,
    new SequenceRandom([122]),
  );

  assert.equal(transition.state.rerollsRemaining, 4);
  assert.equal(transition.state.active[1].spiritId, "LIGHTNING");
  assert.equal(transition.events[0]?.type, "SPIRIT_USED");
});

test("reroll is rejected when no uses remain", () => {
  const initial = createSpiritQueue(
    0,
    new SequenceRandom([0, 23, 44, 62, 92]),
  ).state;

  assert.throws(
    () => rerollActiveSpirit(initial, 0, new SequenceRandom([122])),
    /No spirit rerolls remain/,
  );
});

test("queue validation rejects a spirit id and category mismatch", () => {
  const initial = createSpiritQueue(
    2,
    new SequenceRandom([0, 23, 44, 62, 92]),
  ).state;
  const invalid = {
    ...initial,
    active: [
      { ...initial.active[0], category: "MYSTERY" as const },
      initial.active[1],
    ] as const,
  };

  assert.throws(() => validateSpiritQueue(invalid), /does not match category/);
});
