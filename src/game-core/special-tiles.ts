import {
  comparePositions,
  createPlayablePositions,
  positionKey,
} from "./board.ts";
import { shuffleCopy, type RandomSource } from "./random.ts";
import type { SpiritCard, SpiritLevel } from "./spirits.ts";
import type {
  BoardDefinition,
  BoardState,
  SpecialTileId,
  Tile,
} from "./types.ts";
import { drawSpecialTileId } from "../game-data/special-tiles.ts";

export type SpecialTileAppliedEffect = Readonly<{
  sourceTile: Tile;
  effect: SpecialTileId;
  rerollDelta: 0 | 1;
  summonDelta: -1 | 0;
  otherSpirit: SpiritCard;
}>;

export type SpecialTileEvent =
  | Readonly<{
      type: "SPECIAL_TILE_ACTIVATED";
      sourceTile: Tile;
      effect: SpecialTileId;
    }>
  | Readonly<{
      type: "BOARD_SHUFFLED";
      movements: readonly Readonly<{
        tileId: string;
        from: Tile["position"];
        to: Tile["position"];
      }>[];
    }>
  | Readonly<{
      type: "OLD_SPECIAL_CLEARED";
      tileId: string;
      effect: SpecialTileId;
    }>
  | Readonly<{
      type: "NEW_SPECIAL_ASSIGNED";
      tileId: string;
      effect: SpecialTileId;
    }>;

export type SpecialTileTurnResolution = Readonly<{
  board: BoardState;
  appliedEffect?: SpecialTileAppliedEffect;
  events: readonly SpecialTileEvent[];
}>;

export function resolveSpecialTileTurn(
  definition: BoardDefinition,
  boardAfterAttack: BoardState,
  destroyedTiles: readonly Tile[],
  usedSpirit: SpiritCard,
  otherSpirit: SpiritCard,
  random: RandomSource,
): SpecialTileTurnResolution {
  validateSpecialTileInvariant(boardAfterAttack);
  const destroyedSpecialTiles = destroyedTiles.filter(
    (tile) => tile.specialEffect !== undefined,
  );
  const survivingSpecialCount = boardAfterAttack.tiles.filter(
    ({ specialEffect }) => specialEffect !== undefined,
  ).length;
  if (destroyedSpecialTiles.length + survivingSpecialCount > 1) {
    throw new Error("At most one special tile may exist during a turn.");
  }

  let board = boardAfterAttack;
  const events: SpecialTileEvent[] = [];
  let appliedEffect: SpecialTileAppliedEffect | undefined;
  const sourceTile = destroyedSpecialTiles[0];

  if (sourceTile?.specialEffect !== undefined) {
    const effect = sourceTile.specialEffect;
    events.push({ type: "SPECIAL_TILE_ACTIVATED", sourceTile, effect });
    const resolved = applySpecialEffect(
      definition,
      board,
      sourceTile,
      effect,
      usedSpirit,
      otherSpirit,
      random,
    );
    board = resolved.board;
    appliedEffect = resolved.appliedEffect;
    events.push(...resolved.events);
  }

  const cleared = clearExistingSpecialTiles(board);
  board = cleared.board;
  events.push(...cleared.events);

  const ancientTiles = board.tiles
    .filter(({ kind }) => kind === "ANCIENT")
    .sort((left, right) => comparePositions(left.position, right.position));
  if (ancientTiles.length > 0) {
    const selected = ancientTiles[random.nextInt(ancientTiles.length)];
    if (selected === undefined) {
      throw new Error("Special tile selection escaped array bounds.");
    }
    const effect = drawSpecialTileId(random);
    board = {
      ...board,
      tiles: board.tiles.map((tile) =>
        tile.id === selected.id ? { ...tile, specialEffect: effect } : tile,
      ),
    };
    events.push({
      type: "NEW_SPECIAL_ASSIGNED",
      tileId: selected.id,
      effect,
    });
  }

  return {
    board,
    ...(appliedEffect === undefined ? {} : { appliedEffect }),
    events,
  };
}

export function validateSpecialTileInvariant(board: BoardState): void {
  const specialTiles = board.tiles.filter(
    ({ specialEffect }) => specialEffect !== undefined,
  );
  if (specialTiles.length > 1) {
    throw new Error("A board cannot contain more than one active special tile.");
  }
  if (specialTiles.some(({ kind }) => kind !== "ANCIENT")) {
    throw new Error("Only ancient tiles can carry a special effect.");
  }
}

function applySpecialEffect(
  definition: BoardDefinition,
  board: BoardState,
  sourceTile: Tile,
  effect: SpecialTileId,
  usedSpirit: SpiritCard,
  otherSpirit: SpiritCard,
  random: RandomSource,
): Readonly<{
  board: BoardState;
  appliedEffect: SpecialTileAppliedEffect;
  events: readonly SpecialTileEvent[];
}> {
  let nextBoard = board;
  let nextOtherSpirit = otherSpirit;
  let rerollDelta: 0 | 1 = 0;
  let summonDelta: -1 | 0 = 0;
  const events: SpecialTileEvent[] = [];

  switch (effect) {
    case "SPIRIT_REROLL":
      rerollDelta = 1;
      break;
    case "SPIRIT_SHUFFLE": {
      const shuffled = shuffleBoard(definition, board, random);
      nextBoard = shuffled.board;
      events.push(shuffled.event);
      break;
    }
    case "SPIRIT_SAVE_CHANCE":
      summonDelta = -1;
      break;
    case "SPIRIT_UPGRADE":
      nextOtherSpirit =
        otherSpirit.category === "NORMAL" && otherSpirit.level < 3
          ? { ...otherSpirit, level: incrementLevel(otherSpirit.level) }
          : otherSpirit;
      break;
    case "SPIRIT_COPY":
      nextOtherSpirit = {
        ...otherSpirit,
        spiritId: usedSpirit.spiritId,
        category: usedSpirit.category,
        level: usedSpirit.level,
      };
      break;
    case "SPIRIT_MYSTIC":
      nextOtherSpirit = {
        ...otherSpirit,
        spiritId:
          random.nextInt(2) === 0
            ? "OUTBURST"
            : "WORLD_TREE_RESONANCE",
        category: "MYSTERY",
        level: 1,
      };
      break;
  }

  return {
    board: nextBoard,
    appliedEffect: {
      sourceTile,
      effect,
      rerollDelta,
      summonDelta,
      otherSpirit: nextOtherSpirit,
    },
    events,
  };
}

function shuffleBoard(
  definition: BoardDefinition,
  board: BoardState,
  random: RandomSource,
): Readonly<{
  board: BoardState;
  event: Extract<SpecialTileEvent, { type: "BOARD_SHUFFLED" }>;
}> {
  const positions = createPlayablePositions(definition).sort(comparePositions);
  const tileByPosition = new Map(
    board.tiles.map((tile) => [positionKey(tile.position), tile]),
  );
  const cells = positions.map(
    (position) => tileByPosition.get(positionKey(position)) ?? null,
  );
  const shuffled = shuffleCopy(cells, random);
  const tiles: Tile[] = [];
  const movements: {
    tileId: string;
    from: Tile["position"];
    to: Tile["position"];
  }[] = [];

  for (let index = 0; index < positions.length; index += 1) {
    const tile = shuffled[index];
    const position = positions[index];
    if (tile === undefined || position === undefined) {
      throw new Error("Board shuffle escaped array bounds.");
    }
    if (tile === null) continue;

    tiles.push({ ...tile, position: { ...position } });
    if (positionKey(tile.position) !== positionKey(position)) {
      movements.push({
        tileId: tile.id,
        from: { ...tile.position },
        to: { ...position },
      });
    }
  }

  return {
    board: { ...board, tiles },
    event: { type: "BOARD_SHUFFLED", movements },
  };
}

function clearExistingSpecialTiles(
  board: BoardState,
): Readonly<{ board: BoardState; events: readonly SpecialTileEvent[] }> {
  const events: SpecialTileEvent[] = [];
  const tiles = board.tiles.map((tile): Tile => {
    if (tile.specialEffect === undefined) return tile;
    events.push({
      type: "OLD_SPECIAL_CLEARED",
      tileId: tile.id,
      effect: tile.specialEffect,
    });
    const { specialEffect: _removed, ...normalTile } = tile;
    return normalTile;
  });
  return { board: { ...board, tiles }, events };
}

function incrementLevel(level: SpiritLevel): 2 | 3 {
  if (level === 1) return 2;
  if (level === 2) return 3;
  throw new Error("A level 3 spirit cannot be enhanced.");
}
