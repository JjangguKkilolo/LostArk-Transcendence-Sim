import type {
  BoardDefinition,
  BoardShape,
  BoardSize,
  EquipmentPart,
  Position,
  TranscendenceStage,
} from "../game-core/types.ts";

const PARTS: readonly EquipmentPart[] = [
  "WEAPON",
  "HELMET",
  "SHOULDERS",
  "CHEST",
  "PANTS",
  "GLOVES",
];

const STAGES: readonly TranscendenceStage[] = [1, 2, 3, 4, 5, 6, 7];

const SHAPE_BY_PART: Readonly<Record<EquipmentPart, BoardShape>> = {
  WEAPON: "DIAMOND",
  HELMET: "WIDE_DIAMOND",
  SHOULDERS: "SQUARE",
  CHEST: "DIAMOND",
  PANTS: "SQUARE",
  GLOVES: "ROUNDED_DIAMOND",
};

const DISTORTED: Readonly<
  Record<EquipmentPart, Readonly<Record<TranscendenceStage, string>>>
> = {
  WEAPON: {
    1: "1,2 2,2 3,3 4,3",
    2: "1,2 2,1 3,4 4,3",
    3: "1,3 2,1 3,4 4,2",
    4: "1,4 2,1 2,3 4,3 4,5 5,2",
    5: "1,4 2,1 3,3 4,5 5,2",
    6: "1,4 2,2 2,5 3,5 4,2 5,2 5,5 6,3",
    7: "1,3 2,4 3,1 3,3 4,4 4,6 5,3 6,4",
  },
  HELMET: {
    1: "",
    2: "1,1 2,2 3,3 4,4",
    3: "1,1 1,4 4,1 4,4",
    4: "1,2 2,5 3,3 4,1 5,4",
    5: "1,3 2,1 2,5 4,1 4,5 5,3",
    6: "1,2 2,3 2,6 3,5 4,2 5,1 5,4 6,5",
    7: "1,2 1,3 2,6 3,3 3,6 4,1 4,4 5,1 6,4 6,5",
  },
  SHOULDERS: {
    1: "",
    2: "1,4 2,3 3,2 4,1",
    3: "1,1 1,4 4,1 4,4",
    4: "1,3 2,1 2,5 4,1 4,5 5,3",
    5: "1,1 1,4 2,5 3,3 4,1 5,2 5,5",
    6: "1,5 2,1 2,3 3,5 4,2 5,4 5,6 6,2",
    7: "1,2 1,5 2,1 2,6 3,3 4,4 5,1 5,6 6,2 6,5",
  },
  CHEST: {
    1: "",
    2: "2,2 2,3 3,2 3,3",
    3: "1,2 2,4 3,1 4,3",
    4: "1,4 2,1 2,2 4,4 4,5 5,2",
    5: "1,2 2,5 3,3 4,1 5,4",
    6: "2,2 2,3 2,5 3,5 4,2 5,2 5,4 5,5",
    7: "2,2 2,5 3,1 3,4 4,3 4,6 5,2 5,5",
  },
  PANTS: {
    1: "",
    2: "1,1 1,2 4,3 4,4",
    3: "1,1 2,3 3,2 4,4",
    4: "1,2 2,5 3,3 4,1 5,4",
    5: "1,2 1,4 3,1 3,5 5,2 5,4",
    6: "1,1 1,6 2,2 2,5 5,2 5,5 6,1 6,6",
    7: "1,1 1,6 2,2 2,4 2,5 5,2 5,3 5,5 6,1 6,6",
  },
  GLOVES: {
    1: "",
    2: "1,3 2,4 3,1 4,2",
    3: "1,1 1,3 4,2 4,4",
    4: "2,2 2,4 3,3 4,2 4,4",
    5: "1,3 2,4 3,1 3,5 4,2 5,3",
    6: "1,2 1,5 2,1 2,6 3,3 4,4 5,1 5,6 6,2 6,5",
    7: "1,3 2,4 3,2 3,6 4,1 4,5 5,3 6,4",
  },
};

export const BOARD_DEFINITIONS: readonly BoardDefinition[] = PARTS.flatMap(
  (equipmentPart) =>
    STAGES.map((stage) => ({
      id: { equipmentPart, stage },
      size: sizeForStage(stage),
      shape: SHAPE_BY_PART[equipmentPart],
      distortedPositions: parsePositions(DISTORTED[equipmentPart][stage]),
      grade3Cutline: grade3Cutline(equipmentPart, stage),
    })),
);

const BOARD_BY_KEY = new Map(
  BOARD_DEFINITIONS.map((definition) => [
    boardDefinitionKey(definition.id.equipmentPart, definition.id.stage),
    definition,
  ]),
);

export function getBoardDefinition(
  equipmentPart: EquipmentPart,
  stage: TranscendenceStage,
): BoardDefinition {
  const definition = BOARD_BY_KEY.get(boardDefinitionKey(equipmentPart, stage));
  if (definition === undefined) {
    throw new Error(`Unknown board definition: ${equipmentPart} stage ${stage}.`);
  }
  return definition;
}

function boardDefinitionKey(
  equipmentPart: EquipmentPart,
  stage: TranscendenceStage,
): string {
  return `${equipmentPart}:${stage}`;
}

function sizeForStage(stage: TranscendenceStage): BoardSize {
  if (stage <= 3) return 6;
  if (stage <= 5) return 7;
  return 8;
}

function grade3Cutline(
  equipmentPart: EquipmentPart,
  stage: TranscendenceStage,
): number {
  if (equipmentPart === "WEAPON" || equipmentPart === "CHEST") {
    return stage <= 5 ? 5 : 8;
  }
  if (equipmentPart === "HELMET" || equipmentPart === "GLOVES") {
    if (stage <= 3) return 7;
    if (stage <= 5) return 8;
    return 11;
  }
  if (stage <= 3) return 7;
  if (stage <= 5) return 10;
  return 13;
}

function parsePositions(serialized: string): Position[] {
  if (serialized.length === 0) return [];

  return serialized.split(" ").map((pair) => {
    const [rowText, columnText] = pair.split(",");
    const row = Number(rowText);
    const column = Number(columnText);

    if (!Number.isInteger(row) || !Number.isInteger(column)) {
      throw new Error(`Invalid board position: ${pair}.`);
    }

    return { row, column };
  });
}
