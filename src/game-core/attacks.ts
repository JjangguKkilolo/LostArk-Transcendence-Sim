import {
  comparePositions,
  createPlayablePositions,
  isPositionInShape,
  positionKey,
} from "./board.ts";
import type { RandomSource } from "./random.ts";
import type { SpiritCard, SpiritId } from "./spirits.ts";
import type {
  BoardDefinition,
  BoardState,
  Position,
  Tile,
  TileKind,
} from "./types.ts";

export const PROBABILITY_SCALE = 10_000;

export type FixedPatternSpiritId =
  | "HELLFIRE"
  | "THUNDER_STRIKE"
  | "TORNADO"
  | "SHOCKWAVE";

export type LinearPatternSpiritId =
  | "GREAT_EXPLOSION"
  | "EARTHQUAKE"
  | "RAINSTORM"
  | "TIDAL_WAVE";

export type PatternSpiritId = FixedPatternSpiritId | LinearPatternSpiritId;
export type ElzowinAttackSpiritId = "PURIFY" | "WORLD_TREE_RESONANCE";
export type SingleTargetSpiritId = "LIGHTNING" | "OUTBURST";
export type PlannedAttackSpiritId =
  | PatternSpiritId
  | ElzowinAttackSpiritId
  | SingleTargetSpiritId;

export type DistortedInteraction =
  | "TRIGGER_RESTORE"
  | "DESTROY_WITHOUT_RESTORE"
  | "IGNORE";

export type AttackCandidate = Readonly<{
  tileId: string;
  position: Position;
  tileKind: TileKind;
  destroyChance: number;
}>;

export type AttackPlan = Readonly<{
  spiritInstanceId: string;
  spiritId: PlannedAttackSpiritId;
  spiritLevel: 1 | 2 | 3;
  distortedInteraction: DistortedInteraction;
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

export type LightningFollowUp =
  | Readonly<{
      kind: "RESTORE_ONE";
      roll: -1;
      position?: Position;
    }>
  | Readonly<{
      kind: "DESTROY_EXTRA";
      roll: number;
      requestedCount: number;
      tiles: readonly Tile[];
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

const LINEAR_PATTERN_SPIRITS: ReadonlySet<SpiritId> = new Set([
  "GREAT_EXPLOSION",
  "EARTHQUAKE",
  "RAINSTORM",
  "TIDAL_WAVE",
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

export function isLinearPatternSpirit(
  spiritId: SpiritId,
): spiritId is LinearPatternSpiritId {
  return LINEAR_PATTERN_SPIRITS.has(spiritId);
}

export function createFixedAttackPlan(
  definition: BoardDefinition,
  board: BoardState,
  spirit: SpiritCard,
  target: Position,
): AttackPlan {
  if (
    spirit.category !== "NORMAL" ||
    !isFixedPatternSpirit(spirit.spiritId)
  ) {
    throw new Error(`Spirit ${spirit.spiritId} is not a fixed-pattern spirit.`);
  }

  return createPatternAttackPlan(
    definition,
    board,
    spirit,
    spirit.spiritId,
    target,
    createRelativePattern(spirit.spiritId),
  );
}

export function createLinearAttackPlan(
  definition: BoardDefinition,
  board: BoardState,
  spirit: SpiritCard,
  target: Position,
): AttackPlan {
  if (
    spirit.category !== "NORMAL" ||
    !isLinearPatternSpirit(spirit.spiritId)
  ) {
    throw new Error(`Spirit ${spirit.spiritId} is not a linear-pattern spirit.`);
  }

  return createPatternAttackPlan(
    definition,
    board,
    spirit,
    spirit.spiritId,
    target,
    createLinearPattern(spirit.spiritId, definition.size),
  );
}

export function createElzowinAttackPlan(
  definition: BoardDefinition,
  board: BoardState,
  spirit: SpiritCard,
  target: Position,
): AttackPlan {
  if (
    spirit.spiritId !== "PURIFY" &&
    spirit.spiritId !== "WORLD_TREE_RESONANCE"
  ) {
    throw new Error(`Spirit ${spirit.spiritId} is not an Elzowin attack spirit.`);
  }
  if (spirit.spiritId === "WORLD_TREE_RESONANCE" && spirit.level !== 1) {
    throw new Error("World Tree's Resonance cannot be enhanced.");
  }

  return createPatternAttackPlan(
    definition,
    board,
    spirit,
    spirit.spiritId,
    target,
    createElzowinPattern(spirit),
  );
}

export function createOutburstAttackPlan(
  definition: BoardDefinition,
  board: BoardState,
  spirit: SpiritCard,
  target: Position,
): AttackPlan {
  if (spirit.spiritId !== "OUTBURST") {
    throw new Error(`Spirit ${spirit.spiritId} is not Outburst.`);
  }
  if (spirit.level !== 1) {
    throw new Error("Outburst cannot be enhanced.");
  }

  return createPatternAttackPlan(
    definition,
    board,
    spirit,
    "OUTBURST",
    target,
    [relativeCell(0, 0)],
  );
}

export function createLightningAttackPlan(
  definition: BoardDefinition,
  board: BoardState,
  spirit: SpiritCard,
  target: Position,
): AttackPlan {
  if (spirit.category !== "NORMAL" || spirit.spiritId !== "LIGHTNING") {
    throw new Error(`Spirit ${spirit.spiritId} is not Lightning.`);
  }

  return createPatternAttackPlan(
    definition,
    board,
    spirit,
    "LIGHTNING",
    target,
    [relativeCell(0, 0)],
  );
}

/**
 * Rolls Lightning after its primary hit and distorted restoration have already
 * been applied to the supplied board.
 */
export function rollLightningFollowUp(
  definition: BoardDefinition,
  board: BoardState,
  spirit: SpiritCard,
  random: RandomSource,
): LightningFollowUp {
  validateBoardMatchesDefinition(definition, board);
  if (spirit.category !== "NORMAL" || spirit.spiritId !== "LIGHTNING") {
    throw new Error(`Spirit ${spirit.spiritId} is not Lightning.`);
  }

  const roll = random.nextInt(spirit.level * 2 + 2) - 1;
  if (roll === -1) {
    const occupied = new Set(
      board.tiles.map(({ position }) => positionKey(position)),
    );
    const emptyPositions = createPlayablePositions(definition)
      .filter((position) => !occupied.has(positionKey(position)))
      .sort(comparePositions);
    const position =
      emptyPositions.length === 0
        ? undefined
        : emptyPositions[random.nextInt(emptyPositions.length)];

    return position === undefined
      ? { kind: "RESTORE_ONE", roll }
      : { kind: "RESTORE_ONE", roll, position: { ...position } };
  }

  const candidates = board.tiles
    .filter(({ kind }) => kind === "ANCIENT")
    .sort((left, right) => comparePositions(left.position, right.position));
  const selected: Tile[] = [];
  const count = Math.min(roll, candidates.length);

  for (let index = 0; index < count; index += 1) {
    const selectedIndex = index + random.nextInt(candidates.length - index);
    const current = candidates[index];
    const chosen = candidates[selectedIndex];
    if (current === undefined || chosen === undefined) {
      throw new Error("Lightning candidate selection escaped array bounds.");
    }
    candidates[index] = chosen;
    candidates[selectedIndex] = current;
    selected.push(chosen);
  }

  return {
    kind: "DESTROY_EXTRA",
    roll,
    requestedCount: roll,
    tiles: selected,
  };
}

function createPatternAttackPlan(
  definition: BoardDefinition,
  board: BoardState,
  spirit: SpiritCard,
  spiritId: PlannedAttackSpiritId,
  target: Position,
  relativePattern: readonly RelativeCell[],
): AttackPlan {
  validateBoardMatchesDefinition(definition, board);
  if (!isPositionInShape(target, definition.size, definition.shape)) {
    throw new Error(`Target ${positionKey(target)} is not playable.`);
  }

  const tileByPosition = new Map(
    board.tiles.map((tile) => [positionKey(tile.position), tile]),
  );
  const targetTile = tileByPosition.get(positionKey(target));
  if (
    targetTile?.kind === "DISTORTED" &&
    spiritId !== "PURIFY" &&
    spiritId !== "WORLD_TREE_RESONANCE"
  ) {
    throw new Error(`Spirit ${spiritId} cannot target a distorted tile.`);
  }
  const candidates = relativePattern
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
        destroyChance: destroyChance(
          spirit,
          cell.isCenter,
          tile.kind,
          Math.max(Math.abs(cell.row), Math.abs(cell.column)),
        ),
      };
    })
    .filter((candidate) => candidate !== undefined)
    .sort((left, right) => comparePositions(left.position, right.position));

  return {
    spiritInstanceId: spirit.instanceId,
    spiritId,
    spiritLevel: spirit.level,
    distortedInteraction: distortedInteraction(spiritId, spirit.level),
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

function createLinearPattern(
  spiritId: LinearPatternSpiritId,
  boardSize: number,
): RelativeCell[] {
  const maximumOffset = boardSize - 1;
  const cells: RelativeCell[] = [];

  for (let offset = -maximumOffset; offset <= maximumOffset; offset += 1) {
    switch (spiritId) {
      case "GREAT_EXPLOSION":
        cells.push(relativeCell(offset, offset));
        if (offset !== 0) cells.push(relativeCell(offset, -offset));
        break;
      case "EARTHQUAKE":
        cells.push(relativeCell(0, offset));
        break;
      case "RAINSTORM":
        cells.push(relativeCell(offset, 0));
        break;
      case "TIDAL_WAVE":
        cells.push(relativeCell(0, offset));
        if (offset !== 0) cells.push(relativeCell(offset, 0));
        break;
    }
  }

  return cells;
}

function createElzowinPattern(spirit: SpiritCard): RelativeCell[] {
  if (spirit.spiritId === "PURIFY") {
    const cells = [
      relativeCell(0, -1),
      relativeCell(0, 0),
      relativeCell(0, 1),
    ];
    if (spirit.level === 3) {
      cells.push(relativeCell(-1, 0), relativeCell(1, 0));
    }
    return cells;
  }

  if (spirit.spiritId === "WORLD_TREE_RESONANCE") {
    return [
      relativeCell(-2, 0),
      relativeCell(-1, 0),
      relativeCell(0, -2),
      relativeCell(0, -1),
      relativeCell(0, 0),
      relativeCell(0, 1),
      relativeCell(0, 2),
      relativeCell(1, 0),
      relativeCell(2, 0),
    ];
  }

  throw new Error(`Unsupported Elzowin spirit: ${spirit.spiritId}.`);
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
  distance: number,
): number {
  if (
    spirit.spiritId === "PURIFY"
  ) {
    if (isCenter) return PROBABILITY_SCALE;
    return spirit.level >= 2 ? PROBABILITY_SCALE : 5_000;
  }
  if (
    spirit.spiritId === "OUTBURST" ||
    spirit.spiritId === "LIGHTNING" ||
    spirit.spiritId === "WORLD_TREE_RESONANCE"
  ) {
    return PROBABILITY_SCALE;
  }
  if (
    spirit.category !== "NORMAL" ||
    (!isFixedPatternSpirit(spirit.spiritId) &&
      !isLinearPatternSpirit(spirit.spiritId))
  ) {
    throw new Error("Unsupported spirit passed to chance calculation.");
  }

  if (spirit.level === 3) {
    return tileKind === "DISTORTED" ? 0 : PROBABILITY_SCALE;
  }
  if (spirit.level === 2 || isCenter) {
    return PROBABILITY_SCALE;
  }
  if (isLinearPatternSpirit(spirit.spiritId)) {
    return Math.max(PROBABILITY_SCALE - distance * 1_500, 1_000);
  }
  return LEVEL_ONE_NON_CENTER_CHANCE[spirit.spiritId];
}

function distortedInteraction(
  spiritId: PlannedAttackSpiritId,
  level: 1 | 2 | 3,
): DistortedInteraction {
  if (spiritId === "PURIFY" || spiritId === "WORLD_TREE_RESONANCE") {
    return "DESTROY_WITHOUT_RESTORE";
  }
  if (level === 3) return "IGNORE";
  return "TRIGGER_RESTORE";
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
