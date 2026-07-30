# 클래식 초월 턴 상태 전이 명세

> 상태: 구현 기준 명세 초안
> 규칙 버전: `classic-2024-07-24`
> 기준 구현: 초월 시뮬레이터 ver 1.8.0 (2024-10-07)

이 문서는 여러 조사 문서에 나뉜 규칙을 엔진이 실행할 한 가지 순서로 합친다.
정령별 공격 범위와 확률은 데이터로 제공하며, 여기서는 한 명령이 상태와 이벤트로
변환되는 절차를 정의한다.

## 1. 엔진 경계

엔진은 세 종류의 함수로 나눈다.

```ts
function createGame(
  setup: GameSetup,
  setupRandom: RandomSource,
): TransitionResult<GameState>;

function getLegalActions(state: GameState): GameAction[];

function applyAction(
  state: GameState,
  action: GameAction,
  gameplayRandom: RandomSource,
): TransitionResult<GameState>;

type TransitionResult<T> =
  | { ok: true; state: T; events: GameEvent[] }
  | { ok: false; error: RuleError };
```

- `createGame`은 보드, 가호, 최초 카드와 초기 자동 합성을 해결한다.
- `getLegalActions`은 UI와 AI가 공유하는 유일한 합법 행동 생성기다.
- `applyAction`은 공격 또는 교체를 원자적으로 끝까지 처리한다.
- 엔진 함수는 입력 상태를 변경하지 않는다.
- 실패한 명령은 난수를 소비하거나 일부 상태를 적용하지 않는다.
- 애니메이션은 반환된 이벤트를 재생할 뿐 상태를 계산하지 않는다.

## 2. 핵심 상태

```ts
type GameStatus = "PLAYING" | "CLEARED";

type GameState = {
  schemaVersion: number;
  rulesVersion: "classic-2024-07-24";
  boardId: TranscendenceBoardId;
  board: BoardState;
  hand: {
    active: [SpiritCard, SpiritCard];
    preview: [SpiritCard, SpiritCard, SpiritCard];
  };
  rerollsRemaining: number;
  actionCount: number;
  summonCount: number;
  graceLevel: number;
  status: GameStatus;
  clearGrade?: 0 | 1 | 2 | 3;
};

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
```

`actionCount`는 공격과 교체를 모두 센다. `summonCount`는 등급 계산에 쓰며 정령
사용 때만 증가한다. 축복이 발동한 정령 사용은 `actionCount`만 증가하고 최종
`summonCount`는 증가하지 않는다.

클래식 미니게임에는 턴 제한으로 인한 `FAILED` 상태가 없다. 플레이어가 중단하거나
대전에서 기권하는 것은 단일 게임 엔진 밖의 경기 명령으로 처리한다.

## 3. 공통 불변조건

모든 공개 상태 전이가 끝날 때 다음 조건을 만족해야 한다.

- `status === "PLAYING"`일 때 활성 정령 2장과 미리보기 3장이 존재한다.
- 정령 레벨은 1~3이며 신비 정령은 강화되지 않는다.
- 합성 가능한 동일 정령 두 장이 활성 슬롯에 남아 있지 않는다.
- 활성 특수 석판은 최대 하나다.
- 한 좌표에는 석판이 최대 하나만 존재한다.
- 왜곡 석판 복구는 활성 영역의 빈 좌표에만 일반 석판을 만든다.
- `rerollsRemaining`, `actionCount`, `summonCount`는 음수가 아니다.
- `CLEARED` 상태에는 일반 석판이 없고 `clearGrade`가 존재한다.
- 규칙 버전이 다른 상태와 데이터는 한 전이에서 혼합하지 않는다.

개발 빌드와 테스트에서는 각 공개 전이 뒤 `assertGameState()`를 호출한다.

## 4. 게임 초기화

`createGame`은 다음 순서를 반드시 지킨다.

1. `BoardDefinition`의 크기와 모양으로 활성 좌표를 만든다.
2. 모든 활성 좌표를 일반 석판으로 채운다.
3. 정의된 좌표를 왜곡 석판으로 바꾼다.
4. 가호 단계 `g`를 검증한다. 허용 범위는 0~10이다.
5. 왜곡 석판 중 최대 `g`개를 중복 없이 추첨해 일반 석판으로 바꾼다.
6. 교체 가능 횟수를 `2 + g`로 설정한다.
7. 일반 정령 풀에서 활성 2장과 미리보기 3장을 순서대로 생성한다.
8. 활성 카드의 자동 합성을 연쇄적으로 처리한다.
9. 상태 불변조건을 검사한다.

초기 자동 합성으로 미리보기 끝에 새 카드가 필요하면 계속 `setupRandom`을 사용한다.
사람 대 AI 대전에서는 이 과정이 끝난 완성 상태 하나를 양쪽에 복사한다.

초기화 이벤트에는 최소한 다음 값을 남긴다.

```ts
type SetupEvent =
  | { type: "BOARD_CREATED"; boardId: TranscendenceBoardId }
  | { type: "GRACE_APPLIED"; level: number; normalized: Position[] }
  | { type: "INITIAL_HAND_DEALT"; cards: FiveVisibleCards }
  | SpiritMergeEvent
  | { type: "GAME_READY" };
```

## 5. 합법 행동 생성

`status !== "PLAYING"`이면 합법 행동은 없다.

### 정령 사용

- 활성 슬롯 0과 1을 각각 검사한다.
- 정령의 타겟 규칙을 만족하는 모든 활성 보드 좌표를 열거한다.
- 모든 비엘조윈 계열 정령은 왜곡 석판 좌표를 중심 목표에서 제외한다.
- 정화와 세계수의 공명만 왜곡 석판을 중심 목표로 선택할 수 있다.
- 범위 안에 빈칸이 포함되는 것은 허용할 수 있지만, 정령별 중심 선택 제한은
  `TargetingRule` 데이터가 결정한다.

### 정령 교체

- `rerollsRemaining > 0`일 때만 두 활성 슬롯의 교체 행동을 생성한다.
- 교체는 공격 목표를 갖지 않는다.

UI와 AI가 별도로 행동 가능 여부를 재구현해서는 안 된다.

## 6. 정령 사용 전이

`USE_SPIRIT(i, target)`은 다음 단계 전체를 하나의 원자적 전이로 처리한다.

### A. 검증과 비용 예약

1. 게임이 `PLAYING`인지 검사한다.
2. 활성 슬롯과 목표가 합법인지 검사한다.
3. 사용 시점의 정령 카드를 `usedSpirit`로 복사해 보관한다.
4. `actionCount += 1`, `summonCount += 1`을 적용한다.
5. `SPIRIT_CAST` 이벤트를 기록한다.

### B. 공격 스냅샷과 타격 추첨

1. 사용 시점 보드로 공격 대상과 각 대상의 확률을 모두 계산한다.
2. 고정된 좌표 순서 `(row, column)`로 각 파괴 여부를 추첨한다.
3. 추첨 도중 보드를 변경하지 않는다.
4. 일반·특수 석판 성공 타격, 왜곡 타격, 왜곡 실제 파괴를 분류한다.
5. 분류가 끝난 뒤 일반·특수 석판과 엘조윈 계열이 파괴한 왜곡 석판을 제거한다.

타일별로 `TILE_HIT_ROLLED`을 남기고 실제 제거에는 `TILE_DESTROYED`를 남긴다.
비엘조윈 정령이 성공 타격한 왜곡 석판은 제거하지 않고 `DISTORTED_HIT`을 남긴다.
3레벨 일반 비엘조윈 정령이 무시한 왜곡 석판에는 추첨을 하지 않는다.

### C. 왜곡 석판 복구

1. 비엘조윈 정령이 성공 타격한 왜곡 석판 수에 3을 곱한다.
2. 공격 결과가 반영된 보드의 모든 활성 빈칸을 수집한다.
3. 중복 없이 무작위 좌표를 선택한다.
4. 요청 수와 빈칸 수 중 작은 수만큼 일반 석판을 만든다.

새 석판은 같은 공격에 다시 맞지 않는다. 모든 생성 좌표를 하나의
`TILES_RESTORED` 이벤트에 기록한다.

### D. 정령 고유 후속 효과

일반 범위 공격이 아닌 정령 고유 효과를 처리한다. 현재 별도 단계가 필요한 정령은
벼락이다.

- 선택한 일반 석판의 확정 파괴를 먼저 반영한다.
- 왜곡 복구 단계 뒤 `-1` 또는 `0..2×레벨` 중 하나를 균등 추첨한다.
- `-1`이면 활성 빈칸 하나에 일반 석판을 생성한다.
- 0 이상이면 현재 남은 일반 석판 중 최대 해당 수만큼 중복 없이 무작위 파괴한다.

특수 석판은 별도 석판 종류가 아니라 일반 석판에 효과 표식이 붙은 상태이므로 벼락의
추가 무작위 파괴 대상이 될 수 있다. 이때 파괴된 표식도 E단계의 특수 효과 발동
대상에 포함한다.

### E. 파괴된 특수 석판 효과

공격 스냅샷에서 파괴된 특수 석판이 있다면 그 효과 하나를 적용한다.

- `추가`: `rerollsRemaining += 1`
- `재배치`: 활성 영역의 `Tile | null` 전체를 무작위 순열로 재배치
- `축복`: `summonCount -= 1`
- `강화`: 사용하지 않은 반대 슬롯의 정령을 최대 3레벨까지 +1
- `복제`: 반대 슬롯을 `usedSpirit`의 종류와 레벨로 교체
- `신비`: 반대 슬롯을 두 신비 정령 중 하나로 균등 교체

효과는 사용한 정령 슬롯을 대기 카드로 바꾸기 전에 실행한다. 정상 상태에는 특수
석판이 최대 하나뿐이므로 복수 효과의 우선순위 규칙은 두지 않는다. 비정상 상태에서
여러 효과가 검출되면 `INVARIANT_VIOLATION`으로 실패시킨다.

### F. 특수 석판 수명 갱신

1. 보드에 남은 기존 특수 석판의 효과 표식을 제거해 일반 석판으로 되돌린다.
2. 남은 일반 석판이 있다면 그중 하나를 무작위로 선택한다.
3. 가중치 `47:34:23:32:32:32`로 새 효과를 뽑아 해당 석판에 부여한다.

파괴된 특수 석판은 이미 빈칸이므로 이 단계의 후보가 아니다. 재배치가 발동했다면
재배치된 결과를 기준으로 기존 표식을 정리한다.

### G. 사용 슬롯과 대기열 갱신

1. 사용한 활성 슬롯을 미리보기 0으로 교체한다.
2. 미리보기 1·2를 앞으로 이동한다.
3. 일반 정령 풀에서 새 1레벨 정령을 뽑아 미리보기 끝에 넣는다.
4. 두 활성 카드가 합성 가능하면 연쇄 합성을 수행한다.
5. 합성으로 빈 활성 슬롯이 생길 때마다 같은 대기열 전진 절차를 반복한다.

특수 효과 `강화`, `복제`, `신비`는 E단계에서 이미 반대 슬롯에 반영되어 있으므로
갱신된 카드 조합을 기준으로 합성한다.

### H. 성공과 등급

1. 모든 후속 효과와 카드 갱신이 끝난 보드에서 일반 석판 수를 센다.
2. 하나라도 남아 있으면 `PLAYING`을 유지한다.
3. 일반 석판이 0개면 `CLEARED`로 바꾼다.
4. 완료한 공격을 포함한 최종 `summonCount`와 보드의 기준선으로 등급을 계산한다.
5. `GAME_CLEARED` 이벤트에 등급과 소환 횟수를 기록한다.

왜곡 석판과 빈칸만 남은 보드는 성공이다. 특수 석판은 일반 석판에 표식이 붙은
상태이므로 남아 있다면 아직 성공이 아니다.

## 7. 정령 교체 전이

`REROLL_SPIRIT(i)`은 공격 턴과 별개로 다음 순서를 따른다.

1. 게임 상태, 활성 슬롯, 남은 교체 횟수를 검증한다.
2. `rerollsRemaining -= 1`, `actionCount += 1`을 적용한다.
3. 선택한 활성 정령을 제거한다.
4. 해당 슬롯을 미리보기 0으로 교체한다.
5. 미리보기 큐를 전진시키고 새 일반 정령을 끝에 생성한다.
6. 활성 정령의 자동 합성을 연쇄적으로 처리한다.
7. 불변조건을 검사하고 `PLAYING` 상태를 유지한다.

교체는 다음 항목을 변경하지 않는다.

- 보드와 특수 석판
- `summonCount`
- 성공 여부와 등급

## 8. 자동 합성 보조 전이

자동 합성은 독립적인 사용자 행동이 아니다.

```ts
while (canMerge(active[0], active[1])) {
  const keep = higherLevelIndexOrSecondOnTie(active);
  const consume = opposite(keep);

  active[keep].level += 1;
  replaceActiveFromPreview(consume);
  emit("SPIRITS_MERGED");
}
```

- 같은 종류이며 양쪽 모두 강화 가능한 일반 정령일 때 합성한다.
- 높은 레벨 카드를 남기고 한 단계만 올린다.
- 동레벨이면 기준 구현과 동일하게 두 번째 슬롯을 남긴다.
- 3레벨 카드와 신비 정령은 합성하지 않는다.
- 합성으로 대기 0이 들어온 뒤 조건이 다시 성립하면 계속한다.

무한 반복을 막기 위해 한 번의 전이에서 생성 가능한 카드 수를 기준으로 안전 한도를
두되, 한도 도달은 정상 결과가 아니라 엔진 오류로 취급한다.

## 9. 이벤트의 표준 순서

UI는 아래 순서를 바꾸지 않고 필요한 이벤트를 생략해 재생할 수 있다.

```text
ACTION_ACCEPTED
SPIRIT_CAST
TILE_HIT_ROLLED*
TILE_DESTROYED*
DISTORTED_HIT*
TILES_RESTORED?
SPIRIT_SPECIAL_RESOLVED?
SPECIAL_TILE_ACTIVATED?
BOARD_SHUFFLED?
SUMMON_REFUNDED?
OLD_SPECIAL_CLEARED?
NEW_SPECIAL_ASSIGNED?
ACTIVE_SPIRIT_REPLACED
QUEUE_ADVANCED+
SPIRITS_MERGED*
TURN_COMPLETED
GAME_CLEARED?
```

`*`는 0회 이상, `?`는 0~1회, `+`는 1회 이상이다. 구체 이벤트 이름은 구현 중
확정할 수 있지만 의미와 상대적 순서는 규칙 버전 안에서 바꾸지 않는다.

`TurnResult.nextState`는 모든 이벤트가 적용된 최종 권위 상태다. UI가 애니메이션을
재생하는 동안 별도 `displayedState`를 운영해도 다음 명령은 권위 상태와 애니메이션
잠금 여부를 기준으로 받는다.

## 10. 사람 대 초파고 경기 상태 전이

한 경기 라운드는 다음 단계로 진행한다.

```text
PLAYER_DECIDING
→ PLAYER_LOCKED
→ AI_CALCULATING
→ BOTH_REVEALED
→ RESOLVING
→ ROUND_SUMMARY
→ 다음 라운드 또는 BATTLE_FINISHED
```

1. 플레이어는 자신의 상태에서 행동을 선택하고 확정한다.
2. 확정한 행동은 AI 계산이 끝날 때까지 공개하지 않는다.
3. AI는 자신의 상태와 `getLegalActions(aiState)`만 사용해 행동을 선택한다.
4. 두 행동을 동시에 공개한다.
5. 플레이어 행동은 `playerGameplayRandom`, AI 행동은 `aiGameplayRandom`으로
   각각 독립 실행한다.
6. 양쪽 애니메이션을 병렬 또는 같은 단계별로 재생한다.
7. 각자 완료 여부와 등급을 기록한 뒤 다음 라운드를 시작한다.

한쪽이 먼저 완료하면 그쪽은 더 이상 행동하지 않고 다른 쪽만 계속 진행한다.
경기 승패 기준과 동률 판정은 제품 규칙에서 별도로 정하되, 완료 시점의
`summonCount`, `actionCount`, 등급, 잔여 석판 수를 모두 기록한다.

AI의 Monte Carlo 난수는 `aiSimulationRandom`만 사용하며 실제 AI 판의
`aiGameplayRandom`을 절대 미리 소비하지 않는다.

## 11. 오류와 원자성

```ts
type RuleErrorCode =
  | "GAME_ALREADY_FINISHED"
  | "ILLEGAL_ACTIVE_INDEX"
  | "ILLEGAL_TARGET"
  | "NO_REROLLS_REMAINING"
  | "RULESET_MISMATCH"
  | "INVALID_DATA"
  | "INVARIANT_VIOLATION";
```

검증 오류가 발생하면 입력 상태와 난수 상태를 그대로 유지한다. 구현에서는 먼저
결정론적 검증을 끝내고, 복제한 임시 상태에서 난수를 사용하는 해결 단계를 수행한 뒤,
모든 불변조건을 통과한 경우에만 결과를 반환한다.

## 12. 구현 순서와 테스트 기준

전이 한 단계마다 예제 기반 테스트와 시드 기반 테스트를 함께 둔다.

1. 보드와 가호 초기화
2. 카드 생성·교체·연쇄 합성
3. 일반 범위 공격
4. 왜곡 석판 복구와 엘조윈 예외
5. 벼락 후속 효과
6. 특수 석판 6종
7. 성공·등급 판정
8. 독립 난수 대전

필수 회귀 테스트:

- 같은 규칙 버전, 시드, 초기 설정, 행동열은 같은 이벤트와 상태 해시를 만든다.
- 합법하지 않은 행동은 상태와 난수를 바꾸지 않는다.
- 공격 추첨 순서는 배열 저장 순서가 달라도 좌표 순서로 동일하다.
- 왜곡 석판 여러 개의 복구 요청 수가 누적되고 빈칸 수를 넘지 않는다.
- 축복 턴에도 `actionCount`는 오르고 `summonCount`는 오르지 않는다.
- 복제·강화·신비가 반대 슬롯에 적용된 뒤 사용 슬롯과 큐가 갱신된다.
- 자동 합성은 연쇄 중간 이벤트를 모두 남긴다.
- 일반 석판이 0개인 경우에만 완료되며 등급 기준이 정확하다.
- AI 탐색 횟수를 바꿔도 실제 양쪽 결과는 변하지 않는다.

## 관련 세부 문서

- [정령 목록과 공격 형태](./spirits.md)
- [정령이 머무른 석판](./special-tiles.md)
- [왜곡된 고대 석판](./distorted-tiles.md)
- [정령 카드·대기열·합성 흐름](./spirit-card-flow.md)
- [부위·단계별 보드와 등급 기준](./boards-and-grades.md)
- [엘조윈의 가호](./elzowins-grace.md)
