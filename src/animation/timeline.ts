import type { GameEvent } from "../game-core/game.ts";

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
