export const RULESET_ID = "lostark-transcendence-classic" as const;
export const RULES_VERSION = "classic-2024-07-24" as const;
export const SCHEMA_VERSION = 1 as const;

export type EquipmentPart =
  | "WEAPON"
  | "HELMET"
  | "SHOULDERS"
  | "CHEST"
  | "PANTS"
  | "GLOVES";

export type TranscendenceStage = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type BoardSize = 6 | 7 | 8;
export type BoardShape =
  | "DIAMOND"
  | "WIDE_DIAMOND"
  | "SQUARE"
  | "ROUNDED_DIAMOND";
export type TileKind = "ANCIENT" | "DISTORTED";
export type ClearGrade = 0 | 1 | 2 | 3;

export type Position = Readonly<{
  row: number;
  column: number;
}>;

export type TranscendenceBoardId = Readonly<{
  equipmentPart: EquipmentPart;
  stage: TranscendenceStage;
}>;

export type BoardDefinition = Readonly<{
  id: TranscendenceBoardId;
  size: BoardSize;
  shape: BoardShape;
  distortedPositions: readonly Position[];
  grade3Cutline: number;
}>;

export type Tile = Readonly<{
  id: string;
  position: Position;
  kind: TileKind;
}>;

export type BoardState = Readonly<{
  definitionId: TranscendenceBoardId;
  size: BoardSize;
  tiles: readonly Tile[];
}>;

export type BoardSetup = Readonly<{
  board: BoardState;
  graceLevel: number;
  rerollsRemaining: number;
  normalizedDistortedPositions: readonly Position[];
}>;
