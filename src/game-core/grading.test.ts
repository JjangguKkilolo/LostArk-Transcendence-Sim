import assert from "node:assert/strict";
import test from "node:test";

import { calculateGrade } from "./grading.ts";

test("grade boundaries follow the classic cutline rule", () => {
  assert.equal(calculateGrade(5, 5), 3);
  assert.equal(calculateGrade(6, 5), 2);
  assert.equal(calculateGrade(7, 5), 1);
  assert.equal(calculateGrade(8, 5), 1);
  assert.equal(calculateGrade(9, 5), 0);
});

test("invalid grading input is rejected", () => {
  assert.throws(() => calculateGrade(-1, 5), RangeError);
  assert.throws(() => calculateGrade(1, 0), RangeError);
});
