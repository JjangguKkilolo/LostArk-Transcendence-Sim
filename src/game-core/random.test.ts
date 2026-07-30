import assert from "node:assert/strict";
import test from "node:test";

import { SeededRandom, shuffleCopy } from "./random.ts";

test("the same seed produces the same random sequence", () => {
  const left = new SeededRandom(20240724);
  const right = new SeededRandom(20240724);

  assert.deepEqual(
    Array.from({ length: 20 }, () => left.nextUint32()),
    Array.from({ length: 20 }, () => right.nextUint32()),
  );
});

test("different streams do not consume each other's state", () => {
  const player = new SeededRandom(1);
  const ai = new SeededRandom(2);
  const control = new SeededRandom(2);

  Array.from({ length: 50 }, () => player.nextUint32());

  assert.equal(ai.nextUint32(), control.nextUint32());
});

test("shuffleCopy is deterministic and does not mutate its input", () => {
  const input = [1, 2, 3, 4, 5];
  const first = shuffleCopy(input, new SeededRandom(42));
  const second = shuffleCopy(input, new SeededRandom(42));

  assert.deepEqual(first, second);
  assert.deepEqual(input, [1, 2, 3, 4, 5]);
  assert.notDeepEqual(first, input);
});

test("nextInt validates its exact integer domain", () => {
  const random = new SeededRandom(1);

  assert.throws(() => random.nextInt(0), RangeError);
  assert.throws(() => random.nextInt(1.5), RangeError);
  assert.throws(() => random.nextInt(0x1_0000_0001), RangeError);
});
