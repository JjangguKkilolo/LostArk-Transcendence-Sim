"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  advanceBattleRound,
  beginAiCalculation,
  beginRoundResolution,
  createBattle,
  lockAiAction,
  lockPlayerAction,
  revealPlayerOnlyAction,
  resolveBattleRound,
  type BattleState,
} from "../src/battle/battle.ts";
import { createAnimationTimeline } from "../src/animation/timeline.ts";
import {
  createGame,
  getLegalActions,
  type GameAction,
  type GameEvent,
  type GameState,
} from "../src/game-core/game.ts";
import {
  isPositionInShape,
  positionKey,
} from "../src/game-core/board.ts";
import { SeededRandom } from "../src/game-core/random.ts";
import type { ActiveSpiritIndex, SpiritCard } from "../src/game-core/spirits.ts";
import type { Position, Tile } from "../src/game-core/types.ts";
import { getBoardDefinition } from "../src/game-data/boards.ts";
import {
  MYSTERY_SPIRIT_DEFINITIONS,
  NORMAL_SPIRIT_DEFINITIONS,
} from "../src/game-data/spirits.ts";
import { rankHeuristicActions } from "../src/recommendation/heuristic.ts";

const DEFINITION = getBoardDefinition("SHOULDERS", 1);
const SPIRIT_NAMES = new Map(
  [...NORMAL_SPIRIT_DEFINITIONS, ...MYSTERY_SPIRIT_DEFINITIONS].map(
    ({ id, name }) => [id, name],
  ),
);
const SPECIAL_NAMES = {
  SPIRIT_REROLL: "추가",
  SPIRIT_SHUFFLE: "재배치",
  SPIRIT_SAVE_CHANCE: "축복",
  SPIRIT_UPGRADE: "강화",
  SPIRIT_COPY: "복제",
  SPIRIT_MYSTIC: "신비",
} as const;

export default function Home() {
  const [battle, setBattle] = useState<BattleState>(createInitialBattle);
  const [selectedIndex, setSelectedIndex] =
    useState<ActiveSpiritIndex>(0);
  const [playerPhase, setPlayerPhase] = useState<string>();
  const [aiPhase, setAiPhase] = useState<string>();
  const [message, setMessage] = useState(
    "정령을 고른 뒤 파괴할 석판을 선택하세요.",
  );
  const playerRandom = useRef(new SeededRandom(11_031));
  const aiRandom = useRef(new SeededRandom(91_117));

  const recommendations = useMemo(
    () =>
      battle.player.status === "PLAYING"
        ? rankHeuristicActions(DEFINITION, battle.player)
        : [],
    [battle.player],
  );
  const bestPlayerAction = recommendations[0]?.action;
  const legalActions = useMemo(
    () => getLegalActions(DEFINITION, battle.player),
    [battle.player],
  );
  const legalTargetKeys = useMemo(
    () =>
      new Set(
        legalActions
          .filter(
            (
              action,
            ): action is Extract<GameAction, { type: "USE_SPIRIT" }> =>
              action.type === "USE_SPIRIT" &&
              action.activeIndex === selectedIndex,
          )
          .map(({ target }) => positionKey(target)),
      ),
    [legalActions, selectedIndex],
  );

  useEffect(() => {
    if (battle.phase !== "ROUND_SUMMARY") return;
    const timer = window.setTimeout(() => {
      setPlayerPhase(undefined);
      setAiPhase(undefined);
    }, 1_800);
    return () => window.clearTimeout(timer);
  }, [battle.phase]);

  const submitAction = (action: GameAction) => {
    if (battle.phase !== "PLAYER_DECIDING") return;
    if (battle.ai.status === "CLEARED") {
      const revealed = revealPlayerOnlyAction(DEFINITION, battle, action);
      if (!revealed.ok) {
        setMessage(revealed.error);
        return;
      }
      resolveAndDisplay(revealed.state);
      return;
    }
    const playerLocked = lockPlayerAction(DEFINITION, battle, action);
    if (!playerLocked.ok) {
      setMessage(playerLocked.error);
      return;
    }
    const calculating = beginAiCalculation(playerLocked.state);
    if (!calculating.ok) return;
    const aiChoice = rankHeuristicActions(DEFINITION, calculating.state.ai)[0];
    if (aiChoice === undefined) return;
    const aiLocked = lockAiAction(
      DEFINITION,
      calculating.state,
      aiChoice.action,
    );
    if (!aiLocked.ok) return;
    const resolving = beginRoundResolution(aiLocked.state);
    if (!resolving.ok) return;
    resolveAndDisplay(resolving.state);
  };

  const resolveAndDisplay = (resolvingBattle: BattleState) => {
    const resolved = resolveBattleRound(
      DEFINITION,
      resolvingBattle,
      playerRandom.current,
      aiRandom.current,
    );
    if (!resolved.ok) {
      setMessage(resolved.error);
      return;
    }

    setBattle(resolved.state);
    playTimeline(
      resolved.state.latestRound?.playerEvents ?? [],
      setPlayerPhase,
    );
    playTimeline(
      resolved.state.latestRound?.aiEvents ?? [],
      setAiPhase,
    );
    const comparison = resolved.state.latestRound?.comparison;
    setMessage(
      comparison?.winner === "TIE"
        ? "이번 라운드는 팽팽합니다."
        : comparison?.winner === "PLAYER"
          ? "이번 라운드는 플레이어가 앞섰습니다."
          : "이번 라운드는 초파고가 앞섰습니다.",
    );
  };

  const nextRound = () => {
    const advanced = advanceBattleRound(battle);
    if (!advanced.ok) return;
    if (advanced.state.phase === "AI_CALCULATING") {
      const aiChoice = rankHeuristicActions(DEFINITION, advanced.state.ai)[0];
      if (aiChoice === undefined) return;
      const aiLocked = lockAiAction(
        DEFINITION,
        advanced.state,
        aiChoice.action,
      );
      if (!aiLocked.ok) return;
      const resolving = beginRoundResolution(aiLocked.state);
      if (!resolving.ok) return;
      resolveAndDisplay(resolving.state);
      return;
    }
    setBattle(advanced.state);
    setMessage(
      advanced.state.phase === "BATTLE_FINISHED"
        ? battleResultMessage(advanced.state)
        : "다음 선택을 준비하세요.",
    );
  };

  const reset = () => {
    playerRandom.current = new SeededRandom(11_031);
    aiRandom.current = new SeededRandom(91_117);
    setBattle(createInitialBattle());
    setSelectedIndex(0);
    setPlayerPhase(undefined);
    setAiPhase(undefined);
    setMessage("새 대전을 시작했습니다.");
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">LOST ARK · TRANSCENDENCE DUEL</p>
          <h1>
            초월 <span>대전</span>
          </h1>
        </div>
        <div className="round-lockup">
          <span>ROUND</span>
          <strong>{battle.round.toString().padStart(2, "0")}</strong>
        </div>
        <button className="ghost-button" onClick={reset}>
          새 판
        </button>
      </header>

      <section className="status-strip" aria-live="polite">
        <span className={`phase-dot phase-${battle.phase.toLowerCase()}`} />
        <strong>{phaseLabel(battle.phase)}</strong>
        <p>{message}</p>
      </section>

      <section className="duel-grid">
        <BoardPanel
          side="PLAYER"
          title="PLAYER"
          subtitle="당신의 선택"
          state={battle.player}
          animationPhase={playerPhase}
          selectedIndex={selectedIndex}
          onSelectCard={setSelectedIndex}
          legalTargetKeys={legalTargetKeys}
          recommendedAction={bestPlayerAction}
          onTarget={(target) =>
            submitAction({
              type: "USE_SPIRIT",
              activeIndex: selectedIndex,
              target,
            })
          }
          onReroll={(activeIndex) =>
            submitAction({ type: "REROLL_SPIRIT", activeIndex })
          }
          interactive={battle.phase === "PLAYER_DECIDING"}
        />

        <div className="versus-mark" aria-hidden="true">
          <span>V</span>
          <span>S</span>
        </div>

        <BoardPanel
          side="AI"
          title="CHOPAGO"
          subtitle="확률로 읽는 선택"
          state={battle.ai}
          animationPhase={aiPhase}
          selectedIndex={0}
          onSelectCard={() => undefined}
          legalTargetKeys={new Set()}
          recommendedAction={
            battle.ai.status === "PLAYING"
              ? rankHeuristicActions(DEFINITION, battle.ai)[0]?.action
              : undefined
          }
          onTarget={() => undefined}
          onReroll={() => undefined}
          interactive={false}
        />
      </section>

      <section className="lower-grid">
        <div className="recommendation-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">CHOPAGO READ</p>
              <h2>지금의 추천</h2>
            </div>
            <span className="live-badge">LIVE</span>
          </div>
          <div className="recommendation-list">
            {recommendations.slice(0, 3).map((recommendation) => (
              <div className="recommendation-row" key={actionKey(recommendation.action)}>
                <span className="rank">{recommendation.rank}</span>
                <div>
                  <strong>{actionLabel(recommendation.action, battle.player)}</strong>
                  <p>{recommendation.explanation.join(" · ")}</p>
                </div>
                <b>{recommendation.score.toFixed(2)}</b>
              </div>
            ))}
          </div>
        </div>

        <div className="round-panel">
          <p className="eyebrow">ROUND RESULT</p>
          <div className="score-comparison">
            <Score side="YOU" state={battle.player} />
            <span className="score-divider" />
            <Score side="AI" state={battle.ai} />
          </div>
          {battle.phase === "ROUND_SUMMARY" && (
            <button className="primary-button" onClick={nextRound}>
              {battle.player.status === "CLEARED" &&
              battle.ai.status === "CLEARED"
                ? "최종 결과 보기"
                : "다음 라운드"}
            </button>
          )}
        </div>
      </section>
    </main>
  );
}

type BoardPanelProps = {
  side: "PLAYER" | "AI";
  title: string;
  subtitle: string;
  state: GameState;
  animationPhase: string | undefined;
  selectedIndex: ActiveSpiritIndex;
  onSelectCard: (index: ActiveSpiritIndex) => void;
  legalTargetKeys: ReadonlySet<string>;
  recommendedAction: GameAction | undefined;
  onTarget: (target: Position) => void;
  onReroll: (index: ActiveSpiritIndex) => void;
  interactive: boolean;
};

function BoardPanel(props: BoardPanelProps) {
  const tileByPosition = new Map(
    props.state.board.tiles.map((tile) => [positionKey(tile.position), tile]),
  );
  const recommendedKey =
    props.recommendedAction?.type === "USE_SPIRIT"
      ? positionKey(props.recommendedAction.target)
      : undefined;

  return (
    <article className={`board-panel board-${props.side.toLowerCase()}`}>
      <div className="board-heading">
        <div>
          <p>{props.subtitle}</p>
          <h2>{props.title}</h2>
        </div>
        <div className="board-stats">
          <span>석판</span>
          <strong>{ancientCount(props.state)}</strong>
        </div>
      </div>

      <div className={`board animation-${props.animationPhase ?? "idle"}`}>
        {Array.from({ length: DEFINITION.size ** 2 }, (_, index) => {
          const position = {
            row: Math.floor(index / DEFINITION.size),
            column: index % DEFINITION.size,
          };
          const playable = isPositionInShape(
            position,
            DEFINITION.size,
            DEFINITION.shape,
          );
          const key = positionKey(position);
          const tile = tileByPosition.get(key);
          const legal = props.legalTargetKeys.has(key);
          return (
            <button
              key={key}
              className={[
                "tile",
                playable ? "" : "tile-void",
                tile === undefined && playable ? "tile-empty" : "",
                tile?.kind === "DISTORTED" ? "tile-distorted" : "",
                tile?.specialEffect ? "tile-special" : "",
                legal && props.interactive ? "tile-legal" : "",
                recommendedKey === key ? "tile-recommended" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              disabled={!props.interactive || !legal}
              onClick={() => props.onTarget(position)}
              aria-label={tileLabel(tile, position)}
            >
              {tile?.specialEffect ? (
                <span className="special-glyph">
                  {SPECIAL_NAMES[tile.specialEffect].slice(0, 1)}
                </span>
              ) : tile?.kind === "DISTORTED" ? (
                <span className="distorted-glyph">◆</span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="spirit-zone">
        <div className="active-cards">
          {props.state.spiritQueue.active.map((card, index) => (
            <SpiritCardView
              key={card.instanceId}
              card={card}
              selected={props.selectedIndex === index}
              onClick={() =>
                props.onSelectCard(index as ActiveSpiritIndex)
              }
              disabled={!props.interactive}
              onReroll={() =>
                props.onReroll(index as ActiveSpiritIndex)
              }
              rerolls={props.state.spiritQueue.rerollsRemaining}
            />
          ))}
        </div>
        <div className="preview-cards">
          <span>NEXT</span>
          {props.state.spiritQueue.preview.map((card) => (
            <div className="preview-card" key={card.instanceId}>
              <small>Lv.{card.level}</small>
              <strong>{SPIRIT_NAMES.get(card.spiritId)}</strong>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}

function SpiritCardView({
  card,
  selected,
  onClick,
  disabled,
  onReroll,
  rerolls,
}: {
  card: SpiritCard;
  selected: boolean;
  onClick: () => void;
  disabled: boolean;
  onReroll: () => void;
  rerolls: number;
}) {
  return (
    <div className={`spirit-card ${selected ? "spirit-selected" : ""}`}>
      <button onClick={onClick} disabled={disabled}>
        <span>Lv.{card.level}</span>
        <strong>{SPIRIT_NAMES.get(card.spiritId)}</strong>
        <small>{card.category === "MYSTERY" ? "유적의 신비" : "정령 소환"}</small>
      </button>
      <button
        className="reroll-button"
        disabled={disabled || rerolls <= 0}
        onClick={onReroll}
        aria-label={`${SPIRIT_NAMES.get(card.spiritId)} 교체`}
      >
        ↻
      </button>
    </div>
  );
}

function Score({ side, state }: { side: string; state: GameState }) {
  return (
    <div className="score-block">
      <span>{side}</span>
      <strong>{ancientCount(state)}</strong>
      <small>남은 석판 · 소환 {state.summonCount}</small>
    </div>
  );
}

function createInitialBattle(): BattleState {
  const setup = createGame(DEFINITION, 0, new SeededRandom(2_024));
  if (!setup.ok) throw new Error(setup.error.message);
  return createBattle(setup.state);
}

function playTimeline(
  events: readonly GameEvent[],
  setPhase: (phase: string | undefined) => void,
) {
  const timeline = createAnimationTimeline(events);
  let elapsed = 0;
  for (const frame of timeline) {
    window.setTimeout(() => setPhase(frame.phase.toLowerCase()), elapsed);
    elapsed += Math.min(frame.durationMs, 240);
  }
  window.setTimeout(() => setPhase(undefined), elapsed);
}

function ancientCount(state: GameState) {
  return state.board.tiles.filter(({ kind }) => kind === "ANCIENT").length;
}

function phaseLabel(phase: BattleState["phase"]) {
  const labels = {
    PLAYER_DECIDING: "선택 대기",
    PLAYER_LOCKED: "선택 잠금",
    AI_CALCULATING: "초파고 계산",
    BOTH_REVEALED: "행동 공개",
    RESOLVING: "초월 진행",
    ROUND_SUMMARY: "라운드 완료",
    BATTLE_FINISHED: "대전 종료",
  };
  return labels[phase];
}

function actionLabel(action: GameAction, state: GameState) {
  if (action.type === "REROLL_SPIRIT") {
    return `${SPIRIT_NAMES.get(state.spiritQueue.active[action.activeIndex].spiritId)} 교체`;
  }
  const spirit = state.spiritQueue.active[action.activeIndex];
  return `${SPIRIT_NAMES.get(spirit.spiritId)} · ${action.target.row + 1}행 ${action.target.column + 1}열`;
}

function actionKey(action: GameAction) {
  return action.type === "REROLL_SPIRIT"
    ? `${action.type}:${action.activeIndex}`
    : `${action.type}:${action.activeIndex}:${positionKey(action.target)}`;
}

function tileLabel(tile: Tile | undefined, position: Position) {
  const coordinate = `${position.row + 1}행 ${position.column + 1}열`;
  if (tile === undefined) return `${coordinate} 빈칸`;
  if (tile.kind === "DISTORTED") return `${coordinate} 왜곡된 석판`;
  if (tile.specialEffect) {
    return `${coordinate} ${SPECIAL_NAMES[tile.specialEffect]} 특수 석판`;
  }
  return `${coordinate} 고대 석판`;
}

function battleResultMessage(state: BattleState) {
  if (state.result?.winner === "TIE") return "대전이 무승부로 끝났습니다.";
  return state.result?.winner === "PLAYER"
    ? "플레이어가 초파고를 이겼습니다!"
    : "초파고가 이번 대전에서 승리했습니다.";
}
