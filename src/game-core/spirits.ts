import type { RandomSource } from "./random.ts";
import { drawNormalSpiritId } from "../game-data/spirits.ts";

export type NormalSpiritId =
  | "HELLFIRE"
  | "GREAT_EXPLOSION"
  | "LIGHTNING"
  | "THUNDER_STRIKE"
  | "TORNADO"
  | "SHOCKWAVE"
  | "EARTHQUAKE"
  | "TIDAL_WAVE"
  | "RAINSTORM"
  | "PURIFY";

export type MysterySpiritId = "OUTBURST" | "WORLD_TREE_RESONANCE";
export type SpiritId = NormalSpiritId | MysterySpiritId;
export type SpiritLevel = 1 | 2 | 3;
export type ActiveSpiritIndex = 0 | 1;
export type SpiritCategory = "NORMAL" | "MYSTERY";
export type ElementalLord =
  | "EPHERNIA"
  | "SILPERION"
  | "GNOSIS"
  | "UNDART"
  | "ELZOWIN";

export type SpiritDefinition = Readonly<{
  id: NormalSpiritId;
  name: string;
  category: "NORMAL";
  elementalLord: ElementalLord;
  appearanceWeight: number;
}>;

export type SpiritCard = Readonly<{
  instanceId: string;
  spiritId: SpiritId;
  category: SpiritCategory;
  level: SpiritLevel;
}>;

export type SpiritQueueState = Readonly<{
  active: readonly [SpiritCard, SpiritCard];
  preview: readonly [SpiritCard, SpiritCard, SpiritCard];
  rerollsRemaining: number;
  nextCardSerial: number;
}>;

export type SpiritFlowEvent =
  | {
      type: "INITIAL_SPIRITS_DEALT";
      active: readonly [SpiritCard, SpiritCard];
      preview: readonly [SpiritCard, SpiritCard, SpiritCard];
    }
  | {
      type: "SPIRIT_USED";
      activeIndex: ActiveSpiritIndex;
      card: SpiritCard;
    }
  | {
      type: "SPIRIT_REROLLED";
      activeIndex: ActiveSpiritIndex;
      removed: SpiritCard;
      rerollsRemaining: number;
    }
  | {
      type: "QUEUE_ADVANCED";
      activeIndex: ActiveSpiritIndex;
      incoming: SpiritCard;
      revealed: SpiritCard;
    }
  | {
      type: "SPIRITS_MERGED";
      consumedIndex: ActiveSpiritIndex;
      consumed: SpiritCard;
      resultIndex: ActiveSpiritIndex;
      result: SpiritCard;
    };

export type SpiritQueueTransition = Readonly<{
  state: SpiritQueueState;
  events: readonly SpiritFlowEvent[];
}>;

const MYSTERY_SPIRIT_IDS: ReadonlySet<SpiritId> = new Set([
  "OUTBURST",
  "WORLD_TREE_RESONANCE",
]);

export function createSpiritQueue(
  rerollsRemaining: number,
  random: RandomSource,
): SpiritQueueTransition {
  validateRerolls(rerollsRemaining);

  let nextCardSerial = 0;
  const draw = (): SpiritCard => {
    const result = createNormalCard(nextCardSerial, random);
    nextCardSerial += 1;
    return result;
  };

  const active: [SpiritCard, SpiritCard] = [draw(), draw()];
  const preview: [SpiritCard, SpiritCard, SpiritCard] = [
    draw(),
    draw(),
    draw(),
  ];
  const initialState: SpiritQueueState = {
    active,
    preview,
    rerollsRemaining,
    nextCardSerial,
  };
  const events: SpiritFlowEvent[] = [
    {
      type: "INITIAL_SPIRITS_DEALT",
      active: [...active],
      preview: [...preview],
    },
  ];
  const stabilized = stabilizeMerges(initialState, random);

  return {
    state: stabilized.state,
    events: [...events, ...stabilized.events],
  };
}

export function consumeUsedSpirit(
  state: SpiritQueueState,
  activeIndex: ActiveSpiritIndex,
  random: RandomSource,
): SpiritQueueTransition {
  validateSpiritQueue(state);
  const used = state.active[activeIndex];
  const events: SpiritFlowEvent[] = [
    { type: "SPIRIT_USED", activeIndex, card: used },
  ];
  const advanced = replaceFromPreview(state, activeIndex, random);
  const stabilized = stabilizeMerges(advanced.state, random);

  return {
    state: stabilized.state,
    events: [...events, advanced.event, ...stabilized.events],
  };
}

export function rerollActiveSpirit(
  state: SpiritQueueState,
  activeIndex: ActiveSpiritIndex,
  random: RandomSource,
): SpiritQueueTransition {
  validateSpiritQueue(state);
  if (state.rerollsRemaining <= 0) {
    throw new Error("No spirit rerolls remain.");
  }

  const rerollsRemaining = state.rerollsRemaining - 1;
  const removed = state.active[activeIndex];
  const advanced = replaceFromPreview(
    { ...state, rerollsRemaining },
    activeIndex,
    random,
  );
  const stabilized = stabilizeMerges(advanced.state, random);

  return {
    state: stabilized.state,
    events: [
      {
        type: "SPIRIT_REROLLED",
        activeIndex,
        removed,
        rerollsRemaining,
      },
      advanced.event,
      ...stabilized.events,
    ],
  };
}

export function canMergeSpirits(
  active: SpiritQueueState["active"],
): boolean {
  const [left, right] = active;
  return (
    left.spiritId === right.spiritId &&
    left.category === "NORMAL" &&
    right.category === "NORMAL" &&
    left.level < 3 &&
    right.level < 3
  );
}

export function validateSpiritQueue(state: SpiritQueueState): void {
  if (state.active.length !== 2 || state.preview.length !== 3) {
    throw new Error("A spirit queue must expose two active and three preview cards.");
  }
  validateRerolls(state.rerollsRemaining);
  if (!Number.isSafeInteger(state.nextCardSerial) || state.nextCardSerial < 0) {
    throw new Error("nextCardSerial must be a non-negative safe integer.");
  }

  const instanceIds = new Set<string>();
  for (const card of [...state.active, ...state.preview]) {
    if (card.level < 1 || card.level > 3) {
      throw new Error(`Invalid spirit level: ${card.level}.`);
    }
    if (card.category === "MYSTERY" && card.level !== 1) {
      throw new Error("Mystery spirits cannot be enhanced.");
    }
    const isMysteryId = MYSTERY_SPIRIT_IDS.has(card.spiritId);
    if (isMysteryId !== (card.category === "MYSTERY")) {
      throw new Error(
        `Spirit ${card.spiritId} does not match category ${card.category}.`,
      );
    }
    if (instanceIds.has(card.instanceId)) {
      throw new Error(`Duplicate visible card instance: ${card.instanceId}.`);
    }
    instanceIds.add(card.instanceId);
  }

  if (canMergeSpirits(state.active)) {
    throw new Error("A stable spirit queue cannot contain mergeable active cards.");
  }
}

function stabilizeMerges(
  initialState: SpiritQueueState,
  random: RandomSource,
): SpiritQueueTransition {
  let state = initialState;
  const events: SpiritFlowEvent[] = [];
  let mergeCount = 0;

  while (canMergeSpirits(state.active)) {
    mergeCount += 1;
    if (mergeCount > 100) {
      throw new Error("Spirit merge safety limit exceeded.");
    }

    const [left, right] = state.active;
    const resultIndex: ActiveSpiritIndex = left.level > right.level ? 0 : 1;
    const consumedIndex: ActiveSpiritIndex = resultIndex === 0 ? 1 : 0;
    const resultSource = state.active[resultIndex];
    const consumed = state.active[consumedIndex];
    const result: SpiritCard = {
      ...resultSource,
      level: incrementLevel(resultSource.level),
    };
    const active: [SpiritCard, SpiritCard] = [...state.active];
    active[resultIndex] = result;
    state = { ...state, active };
    events.push({
      type: "SPIRITS_MERGED",
      consumedIndex,
      consumed,
      resultIndex,
      result,
    });

    const advanced = replaceFromPreview(state, consumedIndex, random);
    state = advanced.state;
    events.push(advanced.event);
  }

  validateSpiritQueue(state);
  return { state, events };
}

function replaceFromPreview(
  state: SpiritQueueState,
  activeIndex: ActiveSpiritIndex,
  random: RandomSource,
): Readonly<{
  state: SpiritQueueState;
  event: SpiritFlowEvent;
}> {
  const [incoming, second, third] = state.preview;
  const revealed = createNormalCard(state.nextCardSerial, random);
  const active: [SpiritCard, SpiritCard] = [...state.active];
  active[activeIndex] = incoming;
  const nextState: SpiritQueueState = {
    ...state,
    active,
    preview: [second, third, revealed],
    nextCardSerial: state.nextCardSerial + 1,
  };

  return {
    state: nextState,
    event: {
      type: "QUEUE_ADVANCED",
      activeIndex,
      incoming,
      revealed,
    },
  };
}

function createNormalCard(
  serial: number,
  random: RandomSource,
): SpiritCard {
  return {
    instanceId: `spirit-card:${serial}`,
    spiritId: drawNormalSpiritId(random),
    category: "NORMAL",
    level: 1,
  };
}

function incrementLevel(level: SpiritLevel): 2 | 3 {
  if (level === 1) return 2;
  if (level === 2) return 3;
  throw new Error("A level 3 spirit cannot be merged.");
}

function validateRerolls(rerollsRemaining: number): void {
  if (!Number.isSafeInteger(rerollsRemaining) || rerollsRemaining < 0) {
    throw new RangeError(
      "rerollsRemaining must be a non-negative safe integer.",
    );
  }
}
