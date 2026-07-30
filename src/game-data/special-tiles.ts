import type { RandomSource } from "../game-core/random.ts";
import type { SpecialTileId } from "../game-core/types.ts";

export type SpecialTileEffect =
  | "ADD_REROLL"
  | "SHUFFLE_BOARD"
  | "REFUND_SUMMON"
  | "UPGRADE_OTHER_SPIRIT"
  | "COPY_USED_SPIRIT"
  | "REPLACE_OTHER_WITH_MYSTERY";

export type SpecialTileDefinition = Readonly<{
  id: SpecialTileId;
  name: string;
  weight: number;
  effect: SpecialTileEffect;
}>;

export const SPECIAL_TILE_DEFINITIONS: readonly SpecialTileDefinition[] = [
  special("SPIRIT_REROLL", "추가", 47, "ADD_REROLL"),
  special("SPIRIT_SHUFFLE", "재배치", 34, "SHUFFLE_BOARD"),
  special("SPIRIT_SAVE_CHANCE", "축복", 23, "REFUND_SUMMON"),
  special("SPIRIT_UPGRADE", "강화", 32, "UPGRADE_OTHER_SPIRIT"),
  special("SPIRIT_COPY", "복제", 32, "COPY_USED_SPIRIT"),
  special("SPIRIT_MYSTIC", "신비", 32, "REPLACE_OTHER_WITH_MYSTERY"),
];

export const SPECIAL_TILE_TOTAL_WEIGHT = SPECIAL_TILE_DEFINITIONS.reduce(
  (total, definition) => total + definition.weight,
  0,
);

if (SPECIAL_TILE_TOTAL_WEIGHT !== 200) {
  throw new Error(
    `Special tile weights must total 200, got ${SPECIAL_TILE_TOTAL_WEIGHT}.`,
  );
}

export function drawSpecialTileId(random: RandomSource): SpecialTileId {
  let roll = random.nextInt(SPECIAL_TILE_TOTAL_WEIGHT);

  for (const definition of SPECIAL_TILE_DEFINITIONS) {
    if (roll < definition.weight) return definition.id;
    roll -= definition.weight;
  }

  throw new Error("Special tile weighted draw escaped the definition table.");
}

function special(
  id: SpecialTileId,
  name: string,
  weight: number,
  effect: SpecialTileEffect,
): SpecialTileDefinition {
  return { id, name, weight, effect };
}
