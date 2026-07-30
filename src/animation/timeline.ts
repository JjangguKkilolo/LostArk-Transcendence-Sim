import type { GameEvent } from "../game-core/game.ts";
import type { SpiritId } from "../game-core/spirits.ts";
import type { Position } from "../game-core/types.ts";
import { positionKey } from "../game-core/board.ts";

export type AnimationPhase =
  | "CAST"
  | "HIT"
  | "DESTROY"
  | "RESTORE"
  | "SPECIAL"
  | "QUEUE"
  | "COMPLETE";

export type AnimationFrame = Readonly<{
  phase: AnimationPhase;
  durationMs: number;
  events: readonly GameEvent[];
}>;

export type AnimationStyle =
  | "FIRE"
  | "LIGHTNING"
  | "WIND"
  | "EARTH"
  | "WATER"
  | "ELZOWIN"
  | "MYSTERY"
  | "NEUTRAL";

export type AnimationCue = Readonly<{
  phase: AnimationPhase;
  style: AnimationStyle;
  spiritId?: SpiritId;
  affectedPositions: readonly Position[];
  failedPositions: readonly Position[];
}>;

export function createAnimationTimeline(
  events: readonly GameEvent[],
): AnimationFrame[] {
  const frames: AnimationFrame[] = [];

  for (const event of events) {
    const phase = eventPhase(event);
    if (phase === undefined) continue;
    const previous = frames.at(-1);
    if (previous?.phase === phase && canBatch(phase)) {
      frames[frames.length - 1] = {
        ...previous,
        events: [...previous.events, event],
      };
      continue;
    }
    frames.push({
      phase,
      durationMs: phaseDuration(phase),
      events: [event],
    });
  }

  return frames;
}

export function createAnimationCue(
  frame: AnimationFrame,
  spiritId: SpiritId | undefined,
): AnimationCue {
  const affected: Position[] = [];
  const failed: Position[] = [];

  for (const event of frame.events) {
    switch (event.type) {
      case "SPIRIT_CAST":
        affected.push(event.target);
        break;
      case "TILE_HIT_ROLLED":
        affected.push(event.candidate.position);
        if (!event.destroyed) failed.push(event.candidate.position);
        break;
      case "DISTORTED_HIT":
      case "TILE_DESTROYED":
        affected.push(event.tile.position);
        break;
      case "TILES_RESTORED":
        affected.push(...event.tiles.map(({ position }) => position));
        break;
      case "LIGHTNING_FOLLOW_UP_RESOLVED":
        if (event.result.kind === "RESTORE_ONE") {
          if (event.result.position !== undefined) {
            affected.push(event.result.position);
          }
        } else {
          affected.push(...event.result.tiles.map(({ position }) => position));
        }
        break;
      case "BOARD_SHUFFLED":
        for (const movement of event.movements) {
          affected.push(movement.from, movement.to);
        }
        break;
      case "BOARD_CREATED":
      case "GRACE_APPLIED":
      case "INITIAL_SPIRITS_DEALT":
      case "GAME_READY":
      case "ACTION_ACCEPTED":
      case "SPECIAL_TILE_ACTIVATED":
      case "OLD_SPECIAL_CLEARED":
      case "NEW_SPECIAL_ASSIGNED":
      case "SPIRIT_USED":
      case "SPIRIT_REROLLED":
      case "QUEUE_ADVANCED":
      case "SPIRITS_MERGED":
      case "TURN_COMPLETED":
      case "GAME_CLEARED":
        break;
    }
  }

  return {
    phase: frame.phase,
    style: animationStyle(spiritId),
    ...(spiritId === undefined ? {} : { spiritId }),
    affectedPositions: uniquePositions(affected),
    failedPositions: uniquePositions(failed),
  };
}

function eventPhase(event: GameEvent): AnimationPhase | undefined {
  switch (event.type) {
    case "SPIRIT_CAST":
      return "CAST";
    case "TILE_HIT_ROLLED":
    case "DISTORTED_HIT":
      return "HIT";
    case "TILE_DESTROYED":
      return "DESTROY";
    case "TILES_RESTORED":
      return "RESTORE";
    case "LIGHTNING_FOLLOW_UP_RESOLVED":
    case "SPECIAL_TILE_ACTIVATED":
    case "BOARD_SHUFFLED":
    case "OLD_SPECIAL_CLEARED":
    case "NEW_SPECIAL_ASSIGNED":
      return "SPECIAL";
    case "SPIRIT_USED":
    case "SPIRIT_REROLLED":
    case "QUEUE_ADVANCED":
    case "SPIRITS_MERGED":
      return "QUEUE";
    case "TURN_COMPLETED":
    case "GAME_CLEARED":
      return "COMPLETE";
    case "BOARD_CREATED":
    case "GRACE_APPLIED":
    case "INITIAL_SPIRITS_DEALT":
    case "GAME_READY":
    case "ACTION_ACCEPTED":
      return undefined;
  }
}

function canBatch(phase: AnimationPhase): boolean {
  return (
    phase === "HIT" ||
    phase === "DESTROY" ||
    phase === "RESTORE" ||
    phase === "SPECIAL"
  );
}

function phaseDuration(phase: AnimationPhase): number {
  switch (phase) {
    case "CAST":
      return 420;
    case "HIT":
      return 260;
    case "DESTROY":
      return 360;
    case "RESTORE":
      return 380;
    case "SPECIAL":
      return 420;
    case "QUEUE":
      return 260;
    case "COMPLETE":
      return 220;
  }
}

function animationStyle(spiritId: SpiritId | undefined): AnimationStyle {
  switch (spiritId) {
    case "HELLFIRE":
    case "GREAT_EXPLOSION":
      return "FIRE";
    case "LIGHTNING":
    case "THUNDER_STRIKE":
      return "LIGHTNING";
    case "TORNADO":
      return "WIND";
    case "SHOCKWAVE":
    case "EARTHQUAKE":
      return "EARTH";
    case "TIDAL_WAVE":
    case "RAINSTORM":
      return "WATER";
    case "PURIFY":
    case "WORLD_TREE_RESONANCE":
      return "ELZOWIN";
    case "OUTBURST":
      return "MYSTERY";
    case undefined:
      return "NEUTRAL";
  }
}

function uniquePositions(positions: readonly Position[]): Position[] {
  const byKey = new Map<string, Position>();
  for (const position of positions) {
    byKey.set(positionKey(position), { ...position });
  }
  return [...byKey.values()];
}
