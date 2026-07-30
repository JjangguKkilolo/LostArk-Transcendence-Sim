"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

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
import type {
  BoardDefinition,
  EquipmentPart,
  Position,
  Tile,
  TranscendenceStage,
} from "../src/game-core/types.ts";
import { getBoardDefinition } from "../src/game-data/boards.ts";
import {
  MYSTERY_SPIRIT_DEFINITIONS,
  NORMAL_SPIRIT_DEFINITIONS,
} from "../src/game-data/spirits.ts";
import { rankHeuristicActions } from "../src/recommendation/heuristic.ts";
import type {
  ChopagoWorkerRecommendation,
  ChopagoWorkerRequest,
  ChopagoWorkerResponse,
} from "../src/recommendation/worker-protocol.ts";
import {
  aggregateTurnAnalyses,
  analyzeTurn,
  type CumulativeAnalysis,
  type LuckLabel,
  type TurnAnalysis,
} from "../src/analysis/turn-analysis.ts";

const MONTE_CARLO_SAMPLE_COUNT = 64;
const MONTE_CARLO_MAX_TURNS = 24;
const MONTE_CARLO_TIME_BUDGET_MS = 1_800;

type GameConfig = Readonly<{
  equipmentPart: EquipmentPart;
  stage: TranscendenceStage;
  graceLevel: number;
}>;

const DEFAULT_CONFIG: GameConfig = {
  equipmentPart: "SHOULDERS",
  stage: 1,
  graceLevel: 0,
};
const EQUIPMENT_PARTS: readonly EquipmentPart[] = [
  "WEAPON",
  "HELMET",
  "SHOULDERS",
  "CHEST",
  "PANTS",
  "GLOVES",
];
const STAGES: readonly TranscendenceStage[] = [1, 2, 3, 4, 5, 6, 7];
const PART_NAMES: Readonly<Record<EquipmentPart, string>> = {
  WEAPON: "무기",
  HELMET: "투구",
  SHOULDERS: "견갑",
  CHEST: "상의",
  PANTS: "하의",
  GLOVES: "장갑",
};
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
  const [config, setConfig] = useState<GameConfig>(DEFAULT_CONFIG);
  const [draftConfig, setDraftConfig] = useState<GameConfig>(DEFAULT_CONFIG);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aiThinking, setAiThinking] = useState(false);
  const [aiAnalysis, setAiAnalysis] =
    useState<readonly ChopagoWorkerRecommendation[]>([]);
  const [turnAnalyses, setTurnAnalyses] = useState<readonly TurnAnalysis[]>([]);
  const definition = useMemo(
    () => getBoardDefinition(config.equipmentPart, config.stage),
    [config],
  );
  const [battle, setBattle] = useState<BattleState>(() =>
    createInitialBattle(DEFAULT_CONFIG),
  );
  const [selectedIndex, setSelectedIndex] =
    useState<ActiveSpiritIndex>(0);
  const [playerPhase, setPlayerPhase] = useState<string>();
  const [aiPhase, setAiPhase] = useState<string>();
  const [message, setMessage] = useState(
    "정령을 고른 뒤 파괴할 석판을 선택하세요.",
  );
  const playerRandom = useRef(new SeededRandom(11_031));
  const aiRandom = useRef(new SeededRandom(91_117));
  const aiRecommendationRandom = useRef(new SeededRandom(73_331));
  const aiWorker = useRef<Worker | null>(null);
  const aiRequestId = useRef(0);

  const recommendations = useMemo(
    () =>
      battle.player.status === "PLAYING"
        ? rankHeuristicActions(definition, battle.player)
        : [],
    [battle.player, definition],
  );
  const bestPlayerAction = recommendations[0]?.action;
  const legalActions = useMemo(
    () => getLegalActions(definition, battle.player),
    [battle.player, definition],
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
  const cumulativeAnalysis = useMemo(
    () => aggregateTurnAnalyses(turnAnalyses),
    [turnAnalyses],
  );

  useEffect(() => {
    if (battle.phase !== "ROUND_SUMMARY") return;
    const timer = window.setTimeout(() => {
      setPlayerPhase(undefined);
      setAiPhase(undefined);
    }, 1_800);
    return () => window.clearTimeout(timer);
  }, [battle.phase]);

  useEffect(() => {
    if (!settingsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSettingsOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [settingsOpen]);

  useEffect(
    () => () => {
      aiWorker.current?.terminate();
    },
    [],
  );

  const requestAiAction = (calculatingBattle: BattleState) => {
    aiWorker.current?.terminate();
    const worker = new Worker(
      new URL("../src/workers/chopago.worker.ts", import.meta.url),
      { type: "module" },
    );
    const requestId = aiRequestId.current + 1;
    aiRequestId.current = requestId;
    aiWorker.current = worker;
    setAiThinking(true);
    setAiAnalysis([]);
    setMessage(
      `초파고가 ${MONTE_CARLO_SAMPLE_COUNT}개의 미래를 계산하고 있습니다.`,
    );

    const useRecommendation = (
      action: GameAction,
      analysis: readonly ChopagoWorkerRecommendation[],
      playerRecommendations: readonly ChopagoWorkerRecommendation[],
    ) => {
      if (requestId !== aiRequestId.current) return;
      worker.terminate();
      aiWorker.current = null;
      setAiThinking(false);
      setAiAnalysis(analysis);
      const aiLocked = lockAiAction(definition, calculatingBattle, action);
      if (!aiLocked.ok) {
        setMessage(aiLocked.error);
        return;
      }
      const resolving = beginRoundResolution(aiLocked.state);
      if (!resolving.ok) {
        setMessage(resolving.error);
        return;
      }
      resolveAndDisplay(resolving.state, playerRecommendations);
    };

    const useHeuristicFallback = () => {
      const fallback = rankHeuristicActions(
        definition,
        calculatingBattle.ai,
      )[0];
      if (fallback === undefined) {
        setAiThinking(false);
        setMessage("초파고가 선택 가능한 행동을 찾지 못했습니다.");
        return;
      }
      setMessage("정밀 계산을 완료하지 못해 빠른 추천으로 진행합니다.");
      useRecommendation(fallback.action, [], []);
    };

    worker.onmessage = (event: MessageEvent<ChopagoWorkerResponse>) => {
      if (event.data.requestId !== requestId) return;
      if (event.data.type === "ERROR") {
        useHeuristicFallback();
        return;
      }
      const best = event.data.recommendations[0];
      if (best === undefined) {
        useHeuristicFallback();
        return;
      }
      useRecommendation(
        best.action,
        event.data.recommendations,
        event.data.playerRecommendations,
      );
    };
    worker.onerror = useHeuristicFallback;

    const request: ChopagoWorkerRequest = {
      requestId,
      definition,
      state: calculatingBattle.ai,
      seed: aiRecommendationRandom.current.nextUint32(),
      ...(calculatingBattle.pendingPlayerAction === undefined
        ? {}
        : {
            playerState: calculatingBattle.player,
            playerSeed: aiRecommendationRandom.current.nextUint32(),
          }),
      sampleCount: MONTE_CARLO_SAMPLE_COUNT,
      maxRolloutTurns: MONTE_CARLO_MAX_TURNS,
      timeBudgetMs: MONTE_CARLO_TIME_BUDGET_MS,
    };
    worker.postMessage(request);
  };

  const submitAction = (action: GameAction) => {
    if (battle.phase !== "PLAYER_DECIDING") return;
    if (battle.ai.status === "CLEARED") {
      const revealed = revealPlayerOnlyAction(definition, battle, action);
      if (!revealed.ok) {
        setMessage(revealed.error);
        return;
      }
      resolveAndDisplay(revealed.state);
      return;
    }
    const playerLocked = lockPlayerAction(definition, battle, action);
    if (!playerLocked.ok) {
      setMessage(playerLocked.error);
      return;
    }
    const calculating = beginAiCalculation(playerLocked.state);
    if (!calculating.ok) return;
    setBattle(calculating.state);
    requestAiAction(calculating.state);
  };

  const resolveAndDisplay = (
    resolvingBattle: BattleState,
    playerRecommendations: readonly ChopagoWorkerRecommendation[] = [],
  ) => {
    const resolved = resolveBattleRound(
      definition,
      resolvingBattle,
      playerRandom.current,
      aiRandom.current,
    );
    if (!resolved.ok) {
      setMessage(resolved.error);
      return;
    }

    setBattle(resolved.state);
    const latestRound = resolved.state.latestRound;
    if (
      latestRound?.playerAction !== undefined &&
      playerRecommendations.length > 0
    ) {
      const analysis = analyzeTurn(
        latestRound.playerBefore,
        latestRound.playerAfter,
        latestRound.playerAction,
        latestRound.playerEvents,
        rankHeuristicActions(definition, latestRound.playerBefore),
        playerRecommendations,
      );
      setTurnAnalyses((current) => [...current, analysis]);
    }
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
      setBattle(advanced.state);
      requestAiAction(advanced.state);
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
    cancelAiCalculation();
    playerRandom.current = new SeededRandom(11_031);
    aiRandom.current = new SeededRandom(91_117);
    aiRecommendationRandom.current = new SeededRandom(73_331);
    setBattle(createInitialBattle(config));
    setSelectedIndex(0);
    setPlayerPhase(undefined);
    setAiPhase(undefined);
    setAiAnalysis([]);
    setTurnAnalyses([]);
    setMessage("새 대전을 시작했습니다.");
  };

  const openSettings = () => {
    setDraftConfig(config);
    setSettingsOpen(true);
  };

  const startConfiguredBattle = () => {
    cancelAiCalculation();
    const nextBattle = createInitialBattle(draftConfig);
    playerRandom.current = new SeededRandom(11_031);
    aiRandom.current = new SeededRandom(91_117);
    aiRecommendationRandom.current = new SeededRandom(73_331);
    setConfig(draftConfig);
    setBattle(nextBattle);
    setSelectedIndex(0);
    setPlayerPhase(undefined);
    setAiPhase(undefined);
    setAiAnalysis([]);
    setTurnAnalyses([]);
    setSettingsOpen(false);
    setMessage(
      `${PART_NAMES[draftConfig.equipmentPart]} ${draftConfig.stage}단계 · 가호 ${draftConfig.graceLevel}로 시작합니다.`,
    );
  };

  const cancelAiCalculation = () => {
    aiRequestId.current += 1;
    aiWorker.current?.terminate();
    aiWorker.current = null;
    setAiThinking(false);
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
        <div className="header-actions">
          <div className="current-config">
            <span>{PART_NAMES[config.equipmentPart]}</span>
            <strong>{config.stage}단계 · 가호 {config.graceLevel}</strong>
          </div>
          <button className="ghost-button" onClick={reset}>
            다시 시작
          </button>
          <button className="ghost-button settings-button" onClick={openSettings}>
            설정
          </button>
        </div>
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
          definition={definition}
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
          definition={definition}
          animationPhase={aiPhase}
          selectedIndex={0}
          onSelectCard={() => undefined}
          legalTargetKeys={new Set()}
          recommendedAction={
            battle.ai.status === "PLAYING"
              ? rankHeuristicActions(definition, battle.ai)[0]?.action
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
            <span className={`live-badge ${aiThinking ? "badge-thinking" : ""}`}>
              {aiThinking
                ? "CALCULATING"
                : aiAnalysis.length > 0
                  ? "MONTE CARLO"
                  : "QUICK READ"}
            </span>
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
          <AiAnalysis analysis={aiAnalysis} thinking={aiThinking} state={battle.ai} />
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

      <DecisionLuckReport
        latest={turnAnalyses.at(-1)}
        cumulative={cumulativeAnalysis}
      />

      {settingsOpen && (
        <GameSettings
          config={draftConfig}
          onChange={setDraftConfig}
          onClose={() => setSettingsOpen(false)}
          onStart={startConfiguredBattle}
        />
      )}
    </main>
  );
}

type BoardPanelProps = {
  side: "PLAYER" | "AI";
  title: string;
  subtitle: string;
  state: GameState;
  definition: BoardDefinition;
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

      <div
        className={`board animation-${props.animationPhase ?? "idle"}`}
        style={{ "--board-size": props.definition.size } as CSSProperties}
      >
        {Array.from({ length: props.definition.size ** 2 }, (_, index) => {
          const position = {
            row: Math.floor(index / props.definition.size),
            column: index % props.definition.size,
          };
          const playable = isPositionInShape(
            position,
            props.definition.size,
            props.definition.shape,
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

function AiAnalysis({
  analysis,
  thinking,
  state,
}: {
  analysis: readonly ChopagoWorkerRecommendation[];
  thinking: boolean;
  state: GameState;
}) {
  if (thinking) {
    return (
      <div className="ai-analysis ai-analysis-loading" aria-live="polite">
        <span className="analysis-spinner" />
        <div>
          <strong>미래 수 탐색 중</strong>
          <p>게임 화면과 애니메이션은 계산 중에도 계속 반응합니다.</p>
        </div>
      </div>
    );
  }
  if (analysis.length === 0) return null;

  return (
    <div className="ai-analysis">
      <div className="analysis-title">
        <span>초파고가 실제로 검토한 선택</span>
        <small>{analysis[0]?.metrics.completedSamples ?? 0}회씩 시뮬레이션</small>
      </div>
      <div className="analysis-grid">
        {analysis.map((item) => (
          <div className="analysis-card" key={actionKey(item.action)}>
            <span>#{item.rank}</span>
            <strong>{actionLabel(item.action, state)}</strong>
            <div>
              <small>완주 {(item.metrics.clearProbability * 100).toFixed(0)}%</small>
              <small>평균 잔여 {item.metrics.expectedRemainingAncient.toFixed(1)}</small>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DecisionLuckReport({
  latest,
  cumulative,
}: {
  latest: TurnAnalysis | undefined;
  cumulative: CumulativeAnalysis;
}) {
  return (
    <section className="judgment-report">
      <div className="report-heading">
        <div>
          <p className="eyebrow">DECISION × LUCK</p>
          <h2>판단과 운 리포트</h2>
        </div>
        <p>
          판단은 결과가 나오기 전 선택의 품질, 운은 기대값보다 실제로 더 부순
          정도입니다.
        </p>
      </div>

      {latest === undefined ? (
        <div className="report-empty">
          첫 선택을 완료하면 초파고가 판단과 결과 운을 따로 분석합니다.
        </div>
      ) : (
        <div className="report-grid">
          <article className="report-card decision-card">
            <div className="report-card-title">
              <span>판단</span>
              <strong>{decisionLabel(latest)}</strong>
            </div>
            <div className="report-number">
              <strong>{latest.decision.qualityPercentile.toFixed(0)}</strong>
              <span>점</span>
            </div>
            <div className="report-meter">
              <span
                style={{
                  width: `${Math.max(latest.decision.qualityPercentile, 2)}%`,
                }}
              />
            </div>
            <dl>
              <div>
                <dt>선택 순위</dt>
                <dd>
                  {latest.decision.chosenRank} / {latest.decision.legalActionCount}
                </dd>
              </div>
              <div>
                <dt>판단 손실</dt>
                <dd>{latest.decision.decisionLoss.toFixed(2)}</dd>
              </div>
            </dl>
          </article>

          <article className={`report-card luck-card luck-${latest.luck.label.toLowerCase()}`}>
            <div className="report-card-title">
              <span>운</span>
              <strong>{luckLabel(latest.luck.label)}</strong>
            </div>
            <div className="report-number">
              <strong>{signed(latest.luck.netRemovalDelta)}</strong>
              <span>석판</span>
            </div>
            <div className="expectation-row">
              <div>
                <span>기대 제거</span>
                <strong>{latest.luck.expectedNetRemoval.toFixed(2)}</strong>
              </div>
              <span>→</span>
              <div>
                <span>실제 제거</span>
                <strong>{latest.luck.actualNetRemoval}</strong>
              </div>
            </div>
            <p>
              확률 타격 {latest.luck.probabilisticHits}회 중{" "}
              {latest.luck.successfulProbabilisticHits}회 성공
            </p>
          </article>

          <article className="report-card cumulative-card">
            <div className="report-card-title">
              <span>누적</span>
              <strong>{cumulative.analyzedTurns}라운드</strong>
            </div>
            <div className="cumulative-stats">
              <div>
                <span>평균 판단</span>
                <strong>{cumulative.averageQualityPercentile.toFixed(0)}점</strong>
              </div>
              <div>
                <span>평균 순위</span>
                <strong>{cumulative.averageChosenRank.toFixed(1)}위</strong>
              </div>
              <div>
                <span>누적 운</span>
                <strong>{signed(cumulative.cumulativeLuckDelta)}</strong>
              </div>
              <div>
                <span>행운 / 불운</span>
                <strong>{cumulative.luckyTurns} / {cumulative.unluckyTurns}</strong>
              </div>
            </div>
          </article>
        </div>
      )}
    </section>
  );
}

function GameSettings({
  config,
  onChange,
  onClose,
  onStart,
}: {
  config: GameConfig;
  onChange: (config: GameConfig) => void;
  onClose: () => void;
  onStart: () => void;
}) {
  return (
    <div className="settings-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="settings-heading">
          <div>
            <p className="eyebrow">BATTLE SETUP</p>
            <h2 id="settings-title">새 초월 설정</h2>
          </div>
          <button onClick={onClose} aria-label="설정 닫기">×</button>
        </div>

        <fieldset>
          <legend>장비 부위</legend>
          <div className="choice-grid part-choices">
            {EQUIPMENT_PARTS.map((part) => (
              <button
                key={part}
                className={config.equipmentPart === part ? "choice-active" : ""}
                onClick={() => onChange({ ...config, equipmentPart: part })}
              >
                {PART_NAMES[part]}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>초월 단계</legend>
          <div className="choice-grid stage-choices">
            {STAGES.map((stage) => (
              <button
                key={stage}
                className={config.stage === stage ? "choice-active" : ""}
                onClick={() => onChange({ ...config, stage })}
              >
                {stage}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <div className="grace-label">
            <legend>엘조윈의 가호</legend>
            <strong>{config.graceLevel}</strong>
          </div>
          <input
            type="range"
            min="0"
            max="10"
            step="1"
            value={config.graceLevel}
            onChange={(event) =>
              onChange({ ...config, graceLevel: Number(event.target.value) })
            }
            aria-label="엘조윈의 가호 단계"
          />
          <div className="range-scale"><span>0</span><span>10</span></div>
        </fieldset>

        <div className="settings-summary">
          <span>선택한 대전</span>
          <strong>
            {PART_NAMES[config.equipmentPart]} {config.stage}단계 · 가호 {config.graceLevel}
          </strong>
          <p>양측은 같은 초기 판에서 시작하고, 파괴 결과는 각자 독립적으로 계산됩니다.</p>
        </div>
        <button className="primary-button settings-start" onClick={onStart}>
          이 조건으로 대전 시작
        </button>
      </section>
    </div>
  );
}

function createInitialBattle(config: GameConfig): BattleState {
  const definition = getBoardDefinition(config.equipmentPart, config.stage);
  const setup = createGame(
    definition,
    config.graceLevel,
    new SeededRandom(2_024),
  );
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

function decisionLabel(analysis: TurnAnalysis) {
  const score = analysis.decision.qualityPercentile;
  if (score >= 90) return "초파고급 선택";
  if (score >= 70) return "좋은 판단";
  if (score >= 40) return "아쉬운 판단";
  return "위험한 선택";
}

function luckLabel(label: LuckLabel) {
  const labels: Readonly<Record<LuckLabel, string>> = {
    VERY_UNLUCKY: "매우 불운",
    UNLUCKY: "불운",
    EXPECTED: "기대 범위",
    LUCKY: "행운",
    VERY_LUCKY: "매우 행운",
  };
  return labels[label];
}

function signed(value: number) {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
}
