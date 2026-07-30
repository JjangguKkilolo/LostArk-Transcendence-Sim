export interface RandomSource {
  nextUint32(): number;
  nextFloat(): number;
  nextInt(maxExclusive: number): number;
}

export class SeededRandom implements RandomSource {
  readonly #initialSeed: number;
  #state: number;

  constructor(seed: number) {
    if (!Number.isSafeInteger(seed)) {
      throw new RangeError("Seed must be a safe integer.");
    }

    this.#initialSeed = seed >>> 0;
    this.#state = this.#initialSeed;
  }

  get initialSeed(): number {
    return this.#initialSeed;
  }

  get state(): number {
    return this.#state;
  }

  nextUint32(): number {
    this.#state = (this.#state + 0x6d2b79f5) >>> 0;
    let value = this.#state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  }

  nextFloat(): number {
    return this.nextUint32() / 0x1_0000_0000;
  }

  nextInt(maxExclusive: number): number {
    if (
      !Number.isSafeInteger(maxExclusive) ||
      maxExclusive <= 0 ||
      maxExclusive > 0x1_0000_0000
    ) {
      throw new RangeError(
        "maxExclusive must be a positive integer no greater than 2^32.",
      );
    }

    const upperBound =
      Math.floor(0x1_0000_0000 / maxExclusive) * maxExclusive;

    let value = this.nextUint32();
    while (value >= upperBound) {
      value = this.nextUint32();
    }

    return value % maxExclusive;
  }
}

export function shuffleCopy<T>(
  values: readonly T[],
  random: RandomSource,
): T[] {
  const result = [...values];

  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = random.nextInt(index + 1);
    const current = result[index];
    const swap = result[swapIndex];

    if (current === undefined || swap === undefined) {
      throw new Error("Shuffle index escaped the array bounds.");
    }

    result[index] = swap;
    result[swapIndex] = current;
  }

  return result;
}
