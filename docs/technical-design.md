# 기술 설계

## 설계 원칙

- 규칙 엔진은 React, DOM, CSS, 타이머를 사용하지 않는다.
- UI는 규칙을 계산하지 않고 엔진의 결과를 표현한다.
- 게임 상태는 직접 변경하지 않고 새로운 상태로 반환한다.
- 모든 게임 결과 난수는 재현 가능한 시드 기반 난수를 사용한다.
- 애니메이션과 AI 계산은 실제 경기 난수를 소비하지 않는다.
- 단계와 확률 수치는 코드 분기보다 데이터로 정의한다.

## 권장 모듈 구조

```text
src/
├── game-core/
│   ├── state.ts
│   ├── actions.ts
│   ├── simulator.ts
│   ├── effects.ts
│   ├── events.ts
│   ├── random.ts
│   └── grading.ts
├── game-data/
│   ├── spirits/
│   ├── stages/
│   └── rulesets/
├── battle/
│   ├── state.ts
│   ├── reducer.ts
│   └── result.ts
├── recommendation/
│   ├── interface.ts
│   ├── heuristic.ts
│   ├── monte-carlo.ts
│   └── worker.ts
├── animation/
│   ├── player.ts
│   └── timing.ts
├── ui/
└── tests/
```

## 핵심 상태

```ts
type GameState = {
  schemaVersion: number;
  rulesVersion: string;
  stageId: string;
  board: BoardState;
  spiritQueue: SpiritQueueState;
  actionCount: number;
  summonCount: number;
  graceLevel: number;
  status: "PLAYING" | "CLEARED";
};

type BattleState = {
  setup: InitialSetup;
  player: GameInstance;
  ai: GameInstance;
  phase: BattlePhase;
  history: BattleTurn[];
};
```

## 타일 모델

타일의 정체성과 위치를 구분한다. 재배치 시 ID는 유지하고 위치만 변경한다.

```ts
type Tile = {
  id: string;
  position: Position;
  kind: "ANCIENT" | "DISTORTED";
  status: "ACTIVE" | "DESTROYED";
  specialEffect?: SpecialEffect;
};
```

파괴된 타일도 즉시 배열에서 제거하지 않는다. 상태를 변경해야 파괴 애니메이션,
리플레이, 상태 비교가 가능하다.

## 행동과 이벤트

행동은 플레이어 또는 AI의 의도이고, 이벤트는 규칙 엔진이 계산한 결과다.

```ts
type GameAction =
  | {
      type: "USE_SPIRIT";
      activeIndex: 0 | 1;
      target: Position;
    }
  | {
      type: "REROLL_SPIRIT";
      activeIndex: 0 | 1;
    };

type GameEvent =
  | {
      type: "SPIRIT_CAST";
      activeIndex: 0 | 1;
      spiritId: string;
      target: Position;
    }
  | { type: "TILE_HIT"; tileId: string; probability: number }
  | { type: "TILE_DESTROYED"; tileId: string }
  | { type: "TILES_SPAWNED"; tileIds: string[] }
  | { type: "SPECIAL_ACTIVATED"; effect: SpecialEffect }
  | { type: "SPIRIT_CLONED"; spiritId: string }
  | { type: "SPIRIT_ENHANCED"; spiritId: string; level: number }
  | { type: "TILES_RELOCATED"; movements: TileMovement[] }
  | { type: "TURN_COMPLETED"; actionCount: number; summonCount: number }
  | { type: "GAME_CLEARED"; grade: ClearGrade };
```

```ts
type TurnResult = {
  nextState: GameState;
  events: GameEvent[];
};
```

## 특수 효과 해결 경계

특수 효과를 보드 공격과 카드 갱신 사이의 독립된 이벤트 경계로 처리한다.

```ts
type PendingEffect = {
  sourceTileId: string;
  effect: SpecialEffect;
};
```

정상 보드에는 활성 특수 석판이 최대 하나다. 해결 경계는 애니메이션 이벤트 순서를
유지하기 위한 구조이며, 여러 특수 효과가 동시에 들어오면 우선순위를 임의로 정하지
않고 불변조건 오류를 반환한다. 전체 처리 순서는
[턴 상태 전이 통합 명세](./rules/turn-state-machine.md)를 단일 기준으로 사용한다.

## 난수 스트림

초기 환경, 실제 경기, AI의 가상 계산, 애니메이션 난수를 분리한다.

```ts
type BattleSeeds = {
  setupSeed: number;
  playerGameplaySeed: number;
  aiGameplaySeed: number;
  aiSimulationSeed: number;
  animationSeed: number;
};
```

- `setupSeed`: 동일한 최초 보드와 최초 정령 생성
- `playerGameplaySeed`: 플레이어 판의 실제 확률 결과
- `aiGameplaySeed`: AI 판의 실제 확률 결과
- `aiSimulationSeed`: 추천을 위한 가상 실행
- `animationSeed`: 파티클 방향 등 결과와 무관한 연출

같은 행동을 선택해도 플레이어와 AI의 실제 결과는 독립적이다.

## 규칙 엔진 인터페이스

```ts
function getLegalActions(state: GameState): GameAction[];

function simulateAction(
  state: GameState,
  action: GameAction,
  random: RandomSource,
): TurnResult;
```

`simulateAction`은 전달받은 상태를 변경하지 않는다.

## AI 추천 인터페이스

AI 구현은 나중에 교체할 수 있도록 비동기 경계만 먼저 고정한다.

```ts
interface RecommendationEngine {
  recommend(
    state: GameState,
    options: RecommendationOptions,
  ): Promise<Recommendation[]>;
}

type Recommendation = {
  action: GameAction;
  score: number;
  clearProbability: number;
  grade3Probability: number;
  expectedRemainingTiles: number;
  expectedSummonCount: number;
};
```

발전 단계:

```text
무작위
→ 즉시 기대 파괴량 휴리스틱
→ 1턴 Monte Carlo
→ 다중 턴 탐색
→ 단계별 최적화
→ 필요 시 학습 모델
```

현재 `즉시 기대 파괴량 휴리스틱` 단계까지 구현했다. 이 단계의 클리어 확률은
추가 무작위 파괴를 낙관적으로 포함하지 않는 즉시 클리어 확률 하한이며, 공식
초파고의 계산 결과를 재현한다고 주장하지 않는다.

계산량이 커지면 동일 인터페이스를 유지한 채 Web Worker 또는 서버 계산으로 옮긴다.

## 애니메이션

규칙 엔진은 최종 상태와 이벤트 배열을 즉시 반환한다. UI는 이벤트를 순서대로 재생한다.

```text
입력 잠금
→ SPIRIT_CAST
→ TILE_HIT
→ TILE_DESTROYED
→ SPECIAL_ACTIVATED
→ TILES_RELOCATED
→ TURN_COMPLETED
→ 입력 해제
```

UI에는 계산 완료 상태와 현재 표시 상태를 분리할 수 있다.

```ts
type UIState = {
  authoritativeState: GameState;
  displayedState: GameState;
  isAnimating: boolean;
};
```

초기 버전은 이벤트를 즉시 재생해도 되며, 이후 CSS 또는 애니메이션 라이브러리로 교체한다.

## 저장과 리플레이

```ts
type SavedBattle = {
  schemaVersion: number;
  rulesVersion: string;
  seeds: BattleSeeds;
  setup: InitialSetup;
  turns: BattleTurn[];
};
```

각 턴에는 양쪽 행동, 이벤트, 상태 해시를 저장한다. 같은 규칙 버전과 시드로 결과를
재현할 수 있어야 한다.

## 테스트 원칙

최소 검증 항목:

- 동일 시드와 행동은 동일 결과를 만든다.
- 플레이어와 AI의 경기 난수는 서로 영향을 주지 않는다.
- AI 시뮬레이션 횟수가 실제 AI 판의 결과를 바꾸지 않는다.
- 원본 상태가 변경되지 않는다.
- 정령별 공격 범위와 가장자리 처리가 정확하다.
- 왜곡 석판의 생성 및 예외 처리가 정확하다.
- 활성 특수 석판이 둘 이상인 비정상 상태를 거부한다.
- 축복 시 행동 턴은 증가하고 소환 횟수는 증가하지 않는다.
- 재배치 전후 타일 ID가 유지된다.
- 성공과 등급 판정이 단계 데이터와 일치한다.
