import {
  comparePositions,
  isPositionInShape,
  positionKey,
} from "./board.ts";
import type { RandomSource } from "./random.ts";
import type { SpiritCard, SpiritId } from "./spirits.ts";
import type {
  BoardDefinition,
  BoardState,
  Position,
  TileKind,
} from "./types.ts";

export const PROBABILITY_SCALE = 10_000;

export type FixedPatternSpiritId =
  | "HELLFIRE"
  | "THUNDER_STRIKE"
  | "TORNADO"
  | "SHOCKWAVE";

export type AttackCandidate = Readonly<{
  tileId: string;
  position: Position;
  tileKind: TileKind;
  destroyChance: number;
}>;

export type AttackPlan = Readonly<{
  spiritInstanceId: string;
  spiritId: FixedPatternSpiritId;
  spiritLevel: 1 | 2 | 3;
  target: Position;
  candidates: readonly AttackCandidate[];
}>;

export type AttackRoll = Readonly<{
  candidate: AttackCandidate;
  destroyed: boolean;
  roll?: number;
}>;

export type AttackRollResult = Readonly<{
  plan: AttackPlan;
  rolls: readonly AttackRoll[];
}>;

type RelativeCell = Readonly<{
  row: number;
  column: number;
  isCenter: boolean;
}>;

const FIXED_PATTERN_SPIRITS: ReadonlySet<SpiritId> = new Set([
  "HELLFIRE",
  "THUNDER_STRIKE",
  "TORNADO",
  "SHOCKWAVE",
]);

const LEVEL_ONE_NON_CENTER_CHANCE: Readonly<
  Record<FixedPatternSpiritId, number>
> = {
  HELLFIRE: 5_000,
  THUNDER_STRIKE: 5_000,
  TORNADO: 5_000,
  SHOCKWAVE: 7_500,
};

export function isFixedPatternSpirit(
  spiritId: SpiritId,
): spiritId is FixedPatternSpiritId {
  return FIXED_PATTERN_SPIRITS.has(spiritId);
}

export function createFixedAttackPlan(
  definition: BoardDefinition,
  board: BoardState,
  spirit: SpiritCard,
  target: Position,
): AttackPlan {
  validateBoardMatchesDefinition(definition, board);

  if (
    spirit.category !== "NORMAL" ||
    !isFixedPatternSpirit(spirit.spiritId)
  ) {
    throw new Error(`Spirit ${spirit.spiritId} is not a fixed-pattern spirit.`);
  }
  if (!isPositionInShape(target, definition.size, definition.shape)) {
    throw new Error(`Target ${positionKey(target)} is not playable.`);
  }

  const tileByPosition = new Map(
    board.tiles.map((tile) => [positionKey(tile.position), tile]),
  );
  const candidates = createRelativePattern(spirit.spiritId)
    .map((cell) => ({
      cell,
      position: {
        row: target.row + cell.row,
        column: target.column + cell.column,
      },
    }))
    .filter(({ position }) =>
      isPositionInShape(position, definition.size, definition.shape),
    )
    .map(({ cell, position }): AttackCandidate | undefined => {
      const tile = tileByPosition.get(positionKey(position));
      if (tile === undefined) return undefined;

      return {
        tileId: tile.id,
        position,
        tileKind: tile.kind,
        destroyChance: destroyChance(spirit, cell.isCenter, tile.kind),
      };
    })
    .filter((candidate) => candidate !== undefined)
    .sort((left, right) => comparePositions(left.position, right.position));

  return {
    spiritInstanceId: spirit.instanceId,
    spiritId: spirit.spiritId,
    spiritLevel: spirit.level,
    target: { ...target },
    candidates,
  };
}

export function rollAttackPlan(
  plan: AttackPlan,
  random: RandomSource,
): AttackRollResult {
  const rolls = plan.candidates.map((candidate): AttackRoll => {
    if (candidate.destroyChance === 0) {
      return { candidate, destroyed: false };
    }
    if (candidate.destroyChance === PROBABILITY_SCALE) {
      return { candidate, destroyed: true };
    }

    const roll = random.nextInt(PROBABILITY_SCALE);
    return {
      candidate,
      destroyed: roll < candidate.destroyChance,
      roll,
    };
  });

  return { plan, rolls };
}

function createRelativePattern(
  spiritId: FixedPatternSpiritId,
): RelativeCell[] {
  switch (spiritId) {
    case "HELLFIRE":
      return squareOffsets(2).filter(
        ({ row, column }) => Math.abs(row) + Math.abs(column) <= 2,
      );
    case "THUNDER_STRIKE":
      return [
        relativeCell(0, 0),
        relativeCell(-1, 0),
        relativeCell(0, -1),
        relativeCell(0, 1),
        relativeCell(1, 0),
      ];
    case "TORNADO":
      return [
        relativeCell(0, 0),
        relativeCell(-1, -1),
        relativeCell(-1, 1),
        relativeCell(1, -1),
        relativeCell(1, 1),
      ];
    case "SHOCKWAVE":
      return squareOffsets(1);
  }
}

function squareOffsets(radius: number): RelativeCell[] {
  const cells: RelativeCell[] = [];
  for (let row = -radius; row <= radius; row += 1) {
    for (let column = -radius; column <= radius; column += 1) {
      cells.push(relativeCell(row, column));
    }
  }
  return cells;
}

function relativeCell(row: number, column: number): RelativeCell {
  return { row, column, isCenter: row === 0 && column === 0 };
}

function destroyChance(
  spirit: SpiritCard,
  isCenter: boolean,
  tileKind: TileKind,
): number {
  if (spirit.category !== "NORMAL" || !isFixedPatternSpirit(spirit.spiritId)) {
    throw new Error("Unsupported spirit passed to fixed chance calculation.");
  }

  if (spirit.level === 3) {
    return tileKind === "DISTORTED" ? 0 : PROBABILITY_SCALE;
  }
  if (spirit.level === 2 || isCenter) {
    return PROBABILITY_SCALE;
  }
  return LEVEL_ONE_NON_CENTER_CHANCE[spirit.spiritId];
}

function validateBoardMatchesDefinition(
  definition: BoardDefinition,
  board: BoardState,
): void {
  if (
    definition.id.equipmentPart !== board.definitionId.equipmentPart ||
    definition.id.stage !== board.definitionId.stage ||
    definition.size !== board.size
  ) {
    throw new Error("Board state does not match its board definition.");
  }
}
