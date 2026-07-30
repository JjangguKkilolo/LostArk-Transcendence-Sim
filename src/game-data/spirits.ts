import type { RandomSource } from "../game-core/random.ts";
import type {
  ElementalLord,
  NormalSpiritId,
  SpiritDefinition,
} from "../game-core/spirits.ts";

export const NORMAL_SPIRIT_DEFINITIONS: readonly SpiritDefinition[] = [
  spirit("HELLFIRE", "업화", "EPHERNIA", 23),
  spirit("GREAT_EXPLOSION", "대폭발", "EPHERNIA", 21),
  spirit("LIGHTNING", "벼락", "SILPERION", 18),
  spirit("THUNDER_STRIKE", "낙뢰", "SILPERION", 30),
  spirit("TORNADO", "용오름", "SILPERION", 30),
  spirit("SHOCKWAVE", "충격파", "GNOSIS", 19),
  spirit("EARTHQUAKE", "지진", "GNOSIS", 14),
  spirit("TIDAL_WAVE", "해일", "UNDART", 11),
  spirit("RAINSTORM", "폭풍우", "UNDART", 14),
  spirit("PURIFY", "정화", "ELZOWIN", 20),
];

export const NORMAL_SPIRIT_TOTAL_WEIGHT = NORMAL_SPIRIT_DEFINITIONS.reduce(
  (total, definition) => total + definition.appearanceWeight,
  0,
);

if (NORMAL_SPIRIT_TOTAL_WEIGHT !== 200) {
  throw new Error(
    `Normal spirit weights must total 200, got ${NORMAL_SPIRIT_TOTAL_WEIGHT}.`,
  );
}

export function drawNormalSpiritId(random: RandomSource): NormalSpiritId {
  let roll = random.nextInt(NORMAL_SPIRIT_TOTAL_WEIGHT);

  for (const definition of NORMAL_SPIRIT_DEFINITIONS) {
    if (roll < definition.appearanceWeight) {
      return definition.id;
    }
    roll -= definition.appearanceWeight;
  }

  throw new Error("Normal spirit weighted draw escaped the definition table.");
}

function spirit(
  id: NormalSpiritId,
  name: string,
  elementalLord: ElementalLord,
  appearanceWeight: number,
): SpiritDefinition {
  return {
    id,
    name,
    category: "NORMAL",
    elementalLord,
    appearanceWeight,
  };
}
