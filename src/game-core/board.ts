import { shuffleCopy, type RandomSource } from "./random.ts";
import type {
  BoardDefinition,
  BoardSetup,
  BoardShape,
  Position,
  Tile,
} from "./types.ts";

export const MIN_GRACE_LEVEL = 0;
export const MAX_GRACE_LEVEL = 10;
export const BASE_REROLLS = 2;

export function positionKey(position: Position): string {
  return `${position.row},${position.column}`;
}

export function comparePositions(left: Position, right: Position): number {
  return left.row - right.row || left.column - right.column;
}

export function isPositionInShape(
  position: Position,
  size: number,
  shape: BoardShape,
): boolean {
  if (
    position.row < 0 ||
    position.column < 0 ||
    position.row >= size ||
    position.column >= size
  ) {
    return false;
  }

  const center = (size - 1) / 2;
  const distance =
    Math.abs(position.row - center) + Math.abs(position.column - center);

  switch (shape) {
    case "DIAMOND":
      return distance <= size / 2;
    case "WIDE_DIAMOND":
      return distance <= size / 2 + 1;
    case "SQUARE":
      return true;
    case "ROUNDED_DIAMOND":
      return distance <= (size * 2) / 3;
  }
}

export function createPlayablePositions(
  definition: Pick<BoardDefinition, "size" | "shape">,
): Position[] {
  const positions: Position[] = [];

  for (let row = 0; row < definition.size; row += 1) {
    for (let column = 0; column < definition.size; column += 1) {
      const position = { row, column };
      if (isPositionInShape(position, definition.size, definition.shape)) {
        positions.push(position);
      }
    }
  }

  return positions;
}

export function validateBoardDefinition(definition: BoardDefinition): void {
  const distortedKeys = new Set<string>();

  if (!Number.isSafeInteger(definition.grade3Cutline)) {
    throw new Error("The grade 3 cutline must be an integer.");
  }
  if (definition.grade3Cutline <= 0) {
    throw new Error("The grade 3 cutline must be positive.");
  }

  for (const position of definition.distortedPositions) {
    if (!isPositionInShape(position, definition.size, definition.shape)) {
      throw new Error(
        `Distorted position ${positionKey(position)} is not playable.`,
      );
    }

    const key = positionKey(position);
    if (distortedKeys.has(key)) {
      throw new Error(`Distorted position ${key} is duplicated.`);
    }
    distortedKeys.add(key);
  }
}

export function createBoardSetup(
  definition: BoardDefinition,
  graceLevel: number,
  random: RandomSource,
): BoardSetup {
  validateBoardDefinition(definition);
  validateGraceLevel(graceLevel);

  const distortedKeys = new Set(
    definition.distortedPositions.map(positionKey),
  );
  const distortedPositions = [...definition.distortedPositions].sort(
    comparePositions,
  );
  const normalizedDistortedPositions = shuffleCopy(
    distortedPositions,
    random,
  )
    .slice(0, graceLevel)
    .sort(comparePositions);
  const normalizedKeys = new Set(
    normalizedDistortedPositions.map(positionKey),
  );

  const tiles: Tile[] = createPlayablePositions(definition).map((position) => {
    const key = positionKey(position);
    const isDistorted = distortedKeys.has(key) && !normalizedKeys.has(key);

    return {
      id: `tile:${key}`,
      position,
      kind: isDistorted ? "DISTORTED" : "ANCIENT",
    };
  });

  return {
    board: {
      definitionId: { ...definition.id },
      size: definition.size,
      tiles,
    },
    graceLevel,
    rerollsRemaining: BASE_REROLLS + graceLevel,
    normalizedDistortedPositions,
  };
}

function validateGraceLevel(graceLevel: number): void {
  if (
    !Number.isSafeInteger(graceLevel) ||
    graceLevel < MIN_GRACE_LEVEL ||
    graceLevel > MAX_GRACE_LEVEL
  ) {
    throw new RangeError(
      `graceLevel must be an integer from ${MIN_GRACE_LEVEL} to ${MAX_GRACE_LEVEL}.`,
    );
  }
}
