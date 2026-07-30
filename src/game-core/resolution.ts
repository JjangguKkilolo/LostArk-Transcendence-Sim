import {
  comparePositions,
  createPlayablePositions,
  positionKey,
} from "./board.ts";
import {
  rollAttackPlan,
  rollLightningFollowUp,
  type AttackCandidate,
  type AttackPlan,
  type AttackRoll,
  type LightningFollowUp,
} from "./attacks.ts";
import type { RandomSource } from "./random.ts";
import type { SpiritCard } from "./spirits.ts";
import type {
  BoardDefinition,
  BoardState,
  Position,
  Tile,
} from "./types.ts";

export type AttackResolutionEvent =
  | Readonly<{
      type: "TILE_HIT_ROLLED";
      candidate: AttackCandidate;
      destroyed: boolean;
      roll?: number;
    }>
  | Readonly<{
      type: "TILE_DESTROYED";
      tile: Tile;
      cause: "PRIMARY_ATTACK" | "LIGHTNING_FOLLOW_UP";
    }>
  | Readonly<{
      type: "DISTORTED_HIT";
      tile: Tile;
    }>
  | Readonly<{
      type: "TILES_RESTORED";
      cause: "DISTORTED_HIT" | "LIGHTNING_FOLLOW_UP";
      requestedCount: number;
      tiles: readonly Tile[];
    }>
  | Readonly<{
      type: "LIGHTNING_FOLLOW_UP_RESOLVED";
      result: LightningFollowUp;
    }>;

export type AttackResolution = Readonly<{
  board: BoardState;
  plan: AttackPlan;
  rolls: readonly AttackRoll[];
  events: readonly AttackResolutionEvent[];
}>;

export function resolveAttackPlan(
  definition: BoardDefinition,
  initialBoard: BoardState,
  plan: AttackPlan,
  random: RandomSource,
): AttackResolution {
  validatePlanSnapshot(initialBoard, plan);

  const rolled = rollAttackPlan(plan, random);
  const events: AttackResolutionEvent[] = rolled.rolls.map((result) => ({
    type: "TILE_HIT_ROLLED",
    candidate: result.candidate,
    destroyed: result.destroyed,
    ...(result.roll === undefined ? {} : { roll: result.roll }),
  }));
  const removedIds = new Set<string>();
  let distortedHits = 0;

  for (const result of rolled.rolls) {
    if (!result.destroyed) continue;

    const tile = findTile(initialBoard, result.candidate.tileId);
    if (
      tile.kind === "DISTORTED" &&
      plan.distortedInteraction === "TRIGGER_RESTORE"
    ) {
      distortedHits += 1;
      events.push({ type: "DISTORTED_HIT", tile });
      continue;
    }
    if (
      tile.kind === "DISTORTED" &&
      plan.distortedInteraction === "IGNORE"
    ) {
      throw new Error("An ignored distorted tile cannot be destroyed.");
    }

    removedIds.add(tile.id);
    events.push({
      type: "TILE_DESTROYED",
      tile,
      cause: "PRIMARY_ATTACK",
    });
  }

  let board = withoutTiles(initialBoard, removedIds);
  const requestedRestores = distortedHits * 3;
  if (requestedRestores > 0) {
    const restored = restoreRandomAncientTiles(
      definition,
      board,
      requestedRestores,
      random,
    );
    board = restored.board;
    events.push({
      type: "TILES_RESTORED",
      cause: "DISTORTED_HIT",
      requestedCount: requestedRestores,
      tiles: restored.tiles,
    });
  }

  if (plan.spiritId === "LIGHTNING") {
    const effect = rollLightningFollowUp(
      definition,
      board,
      lightningCardFromPlan(plan),
      random,
    );
    events.push({ type: "LIGHTNING_FOLLOW_UP_RESOLVED", result: effect });

    if (effect.kind === "RESTORE_ONE") {
      if (effect.position !== undefined) {
        const tile = ancientTileAt(effect.position);
        board = { ...board, tiles: sortedTiles([...board.tiles, tile]) };
        events.push({
          type: "TILES_RESTORED",
          cause: "LIGHTNING_FOLLOW_UP",
          requestedCount: 1,
          tiles: [tile],
        });
      }
    } else {
      const lightningRemovedIds = new Set(effect.tiles.map(({ id }) => id));
      board = withoutTiles(board, lightningRemovedIds);
      for (const tile of effect.tiles) {
        events.push({
          type: "TILE_DESTROYED",
          tile,
          cause: "LIGHTNING_FOLLOW_UP",
        });
      }
    }
  }

  return {
    board,
    plan,
    rolls: rolled.rolls,
    events,
  };
}

function restoreRandomAncientTiles(
  definition: BoardDefinition,
  board: BoardState,
  requestedCount: number,
  random: RandomSource,
): Readonly<{ board: BoardState; tiles: readonly Tile[] }> {
  const occupied = new Set(
    board.tiles.map(({ position }) => positionKey(position)),
  );
  const emptyPositions = createPlayablePositions(definition)
    .filter((position) => !occupied.has(positionKey(position)))
    .sort(comparePositions);
  const count = Math.min(requestedCount, emptyPositions.length);
  const restored: Tile[] = [];

  for (let index = 0; index < count; index += 1) {
    const selectedIndex =
      index + random.nextInt(emptyPositions.length - index);
    const current = emptyPositions[index];
    const chosen = emptyPositions[selectedIndex];
    if (current === undefined || chosen === undefined) {
      throw new Error("Restore selection escaped array bounds.");
    }
    emptyPositions[index] = chosen;
    emptyPositions[selectedIndex] = current;
    restored.push(ancientTileAt(chosen));
  }

  return {
    board: { ...board, tiles: sortedTiles([...board.tiles, ...restored]) },
    tiles: restored,
  };
}

function validatePlanSnapshot(board: BoardState, plan: AttackPlan): void {
  for (const candidate of plan.candidates) {
    const tile = board.tiles.find(({ id }) => id === candidate.tileId);
    if (
      tile === undefined ||
      positionKey(tile.position) !== positionKey(candidate.position) ||
      tile.kind !== candidate.tileKind
    ) {
      throw new Error("Attack plan does not match the current board snapshot.");
    }
  }
}

function findTile(board: BoardState, tileId: string): Tile {
  const tile = board.tiles.find(({ id }) => id === tileId);
  if (tile === undefined) {
    throw new Error(`Attack candidate tile ${tileId} is missing.`);
  }
  return tile;
}

function withoutTiles(
  board: BoardState,
  removedIds: ReadonlySet<string>,
): BoardState {
  return {
    ...board,
    tiles: board.tiles.filter(({ id }) => !removedIds.has(id)),
  };
}

function ancientTileAt(position: Position): Tile {
  return {
    id: `tile:${positionKey(position)}`,
    position: { ...position },
    kind: "ANCIENT",
  };
}

function sortedTiles(tiles: readonly Tile[]): Tile[] {
  return [...tiles].sort((left, right) =>
    comparePositions(left.position, right.position),
  );
}

function lightningCardFromPlan(plan: AttackPlan): SpiritCard {
  return {
    instanceId: plan.spiritInstanceId,
    spiritId: "LIGHTNING",
    category: "NORMAL",
    level: plan.spiritLevel,
  };
}
