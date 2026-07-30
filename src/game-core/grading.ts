import type { ClearGrade } from "./types.ts";

export function calculateGrade(
  summonCount: number,
  grade3Cutline: number,
): ClearGrade {
  if (!Number.isSafeInteger(summonCount) || summonCount < 0) {
    throw new RangeError("summonCount must be a non-negative safe integer.");
  }

  if (!Number.isSafeInteger(grade3Cutline) || grade3Cutline <= 0) {
    throw new RangeError("grade3Cutline must be a positive safe integer.");
  }

  if (summonCount <= grade3Cutline) return 3;
  if (summonCount <= grade3Cutline + 1) return 2;
  if (summonCount <= grade3Cutline + 3) return 1;
  return 0;
}
