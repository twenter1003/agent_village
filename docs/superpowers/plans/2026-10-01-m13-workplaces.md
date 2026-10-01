# M13 일터 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 작업마다 건물 1채 대신 팀원마다 일터 하나가 생기고, 끝난 서브에이전트 실행의 일 점수(도구 호출 × 품질)로 1층 → 2층 → 3층 → 큰 건물(3×3)로 자란다. 자재비·대기 이유·두 번째 일터·얼굴 간판·이름표·일터 상세까지 (06 문서 5장, D18·D19). 완료 기준: 작업 30건 재생에서 일터 수 = 일한 팀원 수.

**Architecture:** `VillageState.buildings`를 팀원 일터(`Building` 새 모양)로 바꾸고, 새 규칙 파일 `packages/core/src/rules/workplace.ts`가 세 군데에 붙는다 — 실행 시작(`project.ts` step: 부지·현장), 실행 끝(`economy.ts` `finishRun`: 일 점수·층), 하루 정산(`settle`: 다시 확인, 자재비 대기 중엔 가구 자동 구매 쉼). 작업 → 건물 묶기(`tasks.ts`의 burst·hold·단계·자동 이름·완공)와 `predict.ts`는 지운다. 웹은 `sceneFromState`가 층·임시 그림·비계·게이지를 장면으로 만들고, `BuildingScreen`을 일터 상세로 다시 쓴다 (주소 `&building=` 그대로).

**Tech Stack:** TypeScript (strict, noUncheckedIndexedAccess), pnpm workspace, Vitest (+ happy-dom), React SVG, Playwright, `node:sqlite` (보정 재생), tsx.

**Spec:** `docs/06-도시와-경제.md` 5장(5.1~5.8), 6.1(레벨 게이트), 7장(간판·이름표), 12~16장. 프로젝트 규칙 `CLAUDE.md`.

## Open decisions (컨트롤러가 Task 1 전에 정한다)

| # | 무엇 | 추천 (기본값) | 다른 선택지 | 왜 추천 |
|---|---|---|---|---|
| O1 | M13의 레벨 게이트 (레벨은 M14가 만듦) | `VillageState.level` = 1 고정으로 게이트를 그대로 건다 → 일터는 2층에서 멈추고 "Lv.4 필요", 점수는 계속 쌓임 | ① 게이트 없이 M13에서 큰 건물까지 ② 점수로 레벨을 임시 계산 | ①은 M14 재생 때 3층·큰 건물이 2층으로 되돌아가 보인다(사용자에겐 "건물이 줄어듦"). ②는 M14 일(기금 공사비)을 반쪽만 미리 만드는 중복. 06 문서 6.1 "기금이 늘 0인 마을은 Lv.1, 일터는 2층까지"와도 같다 |
| O2 | `state.buildings`의 운명 | 이름 그대로 두고 **`Building` 모양만 일터로** 바꾼다 (이름 바꾸기 API·`BuildingRenamed`·ui 줄·`&building=`·e2e 선택자 그대로) | `workplaces`로 이름을 바꿈 | 바꿀 곳이 35파일 → 모양이 바뀌는 곳만. 옛 원본 ui 줄(`buildingId`)은 불변이라 이벤트 이름도 그대로가 맞다 |
| O3 | 일터 id | `w<n>:<팀원 id>` (n = 그 팀원의 몇 번째 일터) | `nextId(s, 'w')` 순번 | 순번은 규칙이 바뀌어 토스트 수가 달라지면 밀려서, 사용자가 지은 이름이 **다른 일터로 옮겨 붙는다**. 팀원 기준 id는 재생해도 같다. 대가: 작업 건물 시절 이름(`b1`…)은 가리킬 곳이 없어 재생 뒤 사라진다 |
| O4 | 옛 `&building=b3` 주소 | 지금 있는 "건물을 찾을 수 없어요 + 마을로" 그대로 | 그 작업의 팀원 일터로 돌려보냄 | 옛 건물은 새 상태에 없고 주인도 기여 합으로만 정해졌던 것 — 억지로 잇지 않는다 |
| O5 | 외부인 실행·팀장 | 외부인 실행은 아무것도 만들지 않는다(5.2·5.7). 공사 돕는 외부인과 **일하는 팀장은 가장 최근에 일을 시작한 팀원의 일터**로 (팀장은 M14 시청이 생기면 시청으로) | 팀장은 일할 때 집 앞 | 지금 "진행 중 현장으로 가는" 동작과 같아 코드가 늘지 않는다 |
| O6 | 일터 종류가 직업 변경을 따르나 | 주인의 **지금 직업**을 따른다 (상태에 저장 안 함) | 부지를 잡을 때 고정 | 주인이 처음부터 정해져 고정할 이유가 없고, 설정 화면에서 직업을 바꾸면 일터도 바뀌는 게 자연스럽다 |
| O7 | 1층 완공 알림 | 활동 기록만 (입주처럼), 2층부터 층 올림은 활동 기록 + 토스트 | 1층도 토스트 | 새 팀원마다 토스트가 뜨면 시끄럽다. 13장 알림 목록은 "층 올림" |
| O8 | 임시 그림 (M15 전) | 3층 = 2층 그림 + 배지 "3층", **큰 건물 = 2층 그림을 3×3 가운데 + 배지 "큰 건물"**, 주인이 일하는 동안 비계(`site.scaffold-*`)·자재 더미·게이지 | 큰 건물은 배지 없이 (14장 문구 그대로), 비계 없음 | 배지가 없으면 큰 건물이 2층과 위치만 다르다. 비계는 "지금 이 일터에 점수가 쌓이는 중"을 보여 주는 있는 그림 |
| O9 | 자재비 수치 | 어림값 700 · 1,400 · 2,100으로 시작 → Task 6에서 **DB 복사본 재생으로 보정**한 값을 06 5.3에 적고 컨트롤러가 승인 | 06 5.3의 400·800·1,200 그대로 | 400·800·1,200은 급여 16 시절 값. 급여 26이면 보통 팀원 순이익이 1점당 약 10.5라 게이지가 찰 때 자재비가 이미 남아 "자재비 대기"가 거의 안 생긴다 (5.3 의도 위반) |

## Global Constraints

- 스펙은 `docs/06-도시와-경제.md` 5장. 다르게 가야 하면 코드 전에 06 문서를 먼저 고친다 (CLAUDE.md).
- 일터 층 표 `workplace.levels` (i번째 줄 = i+1층 조건, 마지막 = 큰 건물): 누적 일 점수 **0 · 75 · 225 · 450**, 필요한 마을 레벨 **1 · 1 · 4 · 7**, 자재비 어림 **0 · 700 · 1,400 · 2,100** (Task 6이 바꿈).
- 층 번호: `floor` 0 = 첫 일 공사 중, 1·2·3층, **4 = 큰 건물 = `cfg.workplace.levels.length`**.
- 일 점수 = 끝난 실행의 `toolCalls × economy.quality[품질]` (`runPoints`, 급여와 같은 실행 단위). 외부인·팀장 몫은 없음. 점수·층·낸 자재비는 내려가지 않는다. 일터는 지우지 않는다.
- 급여 `economy.wagePerCall` = 26, 세금 `economy.taxRate` = 0.2 (바꾸지 않음).
- M13의 마을 레벨 `VillageState.level` = 1 (M14가 올린다).
- 일터 id = `w<n>:<memberId>`. 부지 = `{ x, y, size: 3 }` (3×3 예약), 건물(2×2)은 부지 왼쪽 위 `(x, y)`, 큰 건물은 3×3 전부. 부지 사이 1칸. 구역 남 → 동, 모자라면 섬 넓힘(`layout.maxRing` 상한).
- 알림: 1층 = 활동 기록만, 2층 이상 = 활동 기록 + 토스트 `complete`, 자재비 대기 = 들어갈 때 한 번 활동 기록 + 토스트 `tokens`. "Lv.N 필요"는 알림 없음.
- 프로젝터는 순수: `Date.now()`·`Math.random()` 금지, 시각은 이벤트, id는 결정적.
- 상태엔 정본(잔디) id만. 화면 글자(일터 기본 이름·층 이름)는 이름 사전 `packages/web/src/i18n.ts`에서. 색·선·글꼴은 `design/tokens.css` 토큰만, 새 토큰 없음. 배율 s로 넣는 에셋은 선 `3 / s` (`Building`의 `scale` 그대로).
- `packages/core/src/rules/runs.ts`는 다른 작업(이어 받은 실행 구간 id `<agent_id>#n`, 시작 없는 실행의 암묵 시작)이 고치는 중 — **읽기만**. 그 작업이 `economy.ts`·`project.ts`도 건드리므로 Task 3·5는 두 파일을 다시 읽고 시작한다. 일터는 `finishRun`이 부르는 쪽에만 붙는다.
- 저장소에서 `pnpm dev`를 켜지 않는다. `~/.subagent-tycoon/app`(보는 용 복사본)과 실제 DB는 건드리지 않는다 — 재생은 `~/.subagent-tycoon/tycoon.db*`를 임시 폴더에 복사해 `TYCOON_DB=<복사본>`으로. e2e는 4798·5174.
- Task 3부터 Task 8 끝까지 `pnpm lint`(tsc -b)는 웹·서버 컴파일 오류로 빨간 게 정상이다. 태스크마다 자기 범위(`pnpm vitest run <경로>`, `pnpm exec tsc -b packages/core|server`)만 초록으로, **Task 8 끝에서 `pnpm test`·`pnpm lint` 전부 초록**.
- 골든 다시 만들기: `pnpm vitest run -u packages/core/src/projector/replay.test.ts` 뒤 diff를 눈으로 본다.
- git 저장소가 아니다 — 커밋 단계 없음. 마지막에 `docs/04-작업계획.md` 체크 + 작업 기록 한 줄.

## File Structure

| 파일 | 책임 |
|---|---|
| `docs/06-도시와-경제.md` | 5.9 구현 메모(O1~O8 결정), 5.3 자재비 보정 결과 |
| `packages/core/src/layout/lots.ts` (+ test) | 부지 크기(`size?: 3`), `lotSize`, `lotTiles`, `findLot(…, size)` 섞인 크기 간격 |
| `packages/core/src/rules/growth.ts` | `placeLot(…, size)` |
| `packages/core/src/projector/types.ts` | `Building` = 일터, `Task.buildingId` 뺌, `VillageState.level` |
| `design/game.default.json` | `workplace.levels` 추가, `buildings.*` 묶기 키 뺌 |
| `packages/core/src/rules/workplace.ts` (새) | 부지·현장, 1층, 점수, 층 올리기, 자재비·레벨 대기, 두 번째 일터, 정산 재확인, 자동 구매 쉼 판단 |
| `packages/core/src/rules/workplace.test.ts` (새) | 일터 규칙·이름 바꾸기·불변·30건 완료 기준·성장 시뮬레이션 |
| `packages/core/src/rules/tasks.ts` (+ test) | 작업·기여만 (묶기·단계·완공·자동 이름 뺌) |
| `packages/core/src/rules/predict.ts`, `buildings.test.ts` | 지움 |
| `packages/core/src/rules/economy.ts` (+ test) | `finishRun` → `accrue`, `settle` → `raiseAll` + 자동 구매 쉼, `runPoints` export |
| `packages/core/src/projector/project.ts` | `applyWorkplaces` 한 줄, `applyTasks(s, e)`, `level: 1` |
| `packages/core/src/index.ts` | predict 빼고 workplace export |
| `packages/core/src/projector/replay.test.ts`, `recorded.test.ts`, `rules/growth.test.ts` | 일터 기대값 |
| `fixtures/sample-session.golden.json` | 재생 결과 다시 |
| `packages/server/src/http.ts` (+ `collector.test.ts`) | 이름 바꾸기 `:bid` URL 디코드 |
| `packages/web/src/assets/sea/Building.tsx` | `scaffold` (완공 몸통 위 비계) |
| `packages/web/src/live/sceneFromState.ts` (+ test) | 일터 장면(층·임시 배지·큰 건물 3×3·비계·자재·게이지), `activeSite`, `workplaceName`, `frontTiles(…, n)` |
| `packages/web/src/live/movement.ts` (+ test) | 자기 일터로, `workSite` export |
| `packages/web/src/world/WorldUi.tsx`, `LiveVillage.tsx` (+ test), `constructionFx.ts` (+ test) | 게이지·층 배지, 층 거품, 골조 트윈 제거 |
| `packages/web/src/screens/TopBar.tsx`, `TeamPanel.tsx`, `screens.test.ts`, `i18n.ts`, `i18n.test.ts`, `dev/Ui.tsx`, `dev/Gallery.tsx`, `live/LiveDemo.tsx` | 글자·데모 |
| `packages/web/src/screens/building/BuildingScreen.tsx`, `building.css` (+ test) | 일터 상세 |
| `packages/web/src/screens/grid/GridScreen.tsx`, `grid.css` (+ test), `screens/LiveApp.test.ts` | 격자 일터 카드, 주소 |
| `e2e/workplaces.spec.ts` (새, `e2e/buildings.spec.ts` 대신), `live.spec.ts`, `grid.spec.ts`, `growth.spec.ts`, `economy.spec.ts`, `a11y.spec.ts` | 화면 확인 |
| `docs/01-기획서.md` 3.3·4·5·8.5·10장, `docs/02-구현설계서.md` 6·8·9장, `docs/03-디자인-핸드오프.md` 3.1, `README.md`, `docs/HANDOFF.md`, `docs/04-작업계획.md` | 문서 |

---

### Task 1: 결정 기록 (문서 먼저)

**Files:**
- Modify: `docs/06-도시와-경제.md` (5.8 뒤에 5.9 추가)

**Interfaces:** 없음 (문서).

- [ ] **Step 1: 컨트롤러 결정 확인** — Open decisions O1~O9의 결정을 받는다. 추천과 다르게 정해진 줄은 아래 글에서 그 줄만 결정대로 바꿔 쓴다.

- [ ] **Step 2: 06 문서 5.8 바로 뒤에 추가**

```markdown
### 5.9 M13 구현 메모 (2026-10-01)

- **레벨 게이트:** 마을 레벨은 M14가 만든다. M13에서는 `VillageState.level` = 1이라 일터는 2층에서 멈추고("Lv.4 필요") 점수는 계속 쌓인다. M14가 레벨을 올리면 그 하루 정산에서 다시 확인해 오른다.
- **상태 이름:** `VillageState.buildings`가 이제 팀원 일터다 (`Building` 모양을 바꿈). 이름 바꾸기 API·`BuildingRenamed`·주소 `&building=`은 그대로.
- **일터 id = `w<n>:<팀원 id>`** (n = 그 팀원의 몇 번째 일터). 규칙이 바뀌어 재생해도 같은 id라 사용자가 지은 이름이 따라간다. 작업 건물 시절 이름(`b1`…)은 가리킬 건물이 없어 재생하면 사라지고, 옛 `&building=b3` 주소는 "건물을 찾을 수 없어요".
- **부지:** 3×3을 잡고 건물(2×2)은 부지 왼쪽 위(뒤쪽)에 선다. 앞줄·오른쪽 줄은 앞마당(일하는 자리·자재 더미). 큰 건물은 3×3을 다 쓴다.
- **종류·이름:** 종류는 주인의 지금 직업(상태에 저장하지 않음). 이름 기본값은 화면이 이름 사전으로 만든다 ("<팀원>의 <종류>", 두 번째부터 뒤에 번호). 사용자가 지은 이름만 상태에 남는다.
- **알림:** 1층 완공은 활동 기록만(입주처럼). 2층부터 층 올림은 활동 기록 + 토스트, 자재비 대기는 들어갈 때 한 번 활동 기록 + 토스트, "Lv.N 필요"는 알림 없음.
- **외부인·팀장:** 외부인 실행은 일터를 만들지 않는다. 공사 돕는 외부인과 일하는 팀장은 가장 최근에 일을 시작한 팀원의 일터로 간다 (팀장은 M14 시청이 생기면 시청으로).
- **임시 그림 (14장):** 3층 = 2층 그림 + 층 배지, 큰 건물 = 2층 그림을 3×3 가운데 + 배지 "큰 건물". 주인이 일하는 동안 완공 몸통 위에 비계(`site.scaffold-*`)와 앞마당 자재 더미, 머리 위에 게이지(일 점수 ÷ 다음 층 점수).
```

- [ ] **Step 3: 확인** — Run: `grep -n "5.9 M13 구현 메모" docs/06-도시와-경제.md` → Expected: 한 줄.

---

### Task 2: 부지 3×3 (layout)

**Files:**
- Modify: `packages/core/src/layout/lots.ts`
- Modify: `packages/core/src/rules/growth.ts:16-27` (`placeLot`)
- Test: `packages/core/src/layout/lots.test.ts`

**Interfaces:**
- Produces: `interface Lot { x: number; y: number; size?: 3 }` (없으면 2×2), `lotSize(l: Lot): 2 | 3`, `lotTiles(l: Lot): [number, number][]`, `findLot(zone: Zone, occupied: Lot[], ring = 0, size: 2 | 3 = 2): Lot | null`, `placeLot(s: VillageState, zones: Zone[], cfg: GameConfig, size: 2 | 3 = 2): Lot | null`.

- [ ] **Step 1: 실패하는 테스트 쓰기** — `lots.test.ts` import를 `import { findLot, isPlaza, isRoad, lotTiles, type Lot } from './lots';`로 바꾸고 끝에 추가:

```ts
test('3×3 부지 (06 문서 5.1): 남쪽 첫 자리는 광장에 가장 가까운 (10, 10), 1칸 띄워야 해서 ring 0 남쪽엔 하나뿐, 동쪽은 (10, 3)', () => {
  expect(findLot('south', [], 0, 3)).toEqual({ x: 10, y: 10, size: 3 });
  expect(findLot('south', [{ x: 10, y: 10, size: 3 }], 0, 3)).toBeNull();
  expect(findLot('east', [], 0, 3)).toEqual({ x: 10, y: 3, size: 3 });
  expect(lotTiles({ x: 10, y: 10, size: 3 })).toHaveLength(9);
  expect(lotTiles({ x: 1, y: 1 })).toEqual([
    [1, 1],
    [2, 1],
    [1, 2],
    [2, 2],
  ]);
});

test('크기가 섞여도 겹치지 않고 1칸 이상 떨어진다 (ring 2, 3×3과 2×2 번갈아)', () => {
  const lots: Lot[] = [];
  for (let i = 0; i < 12; i++) {
    const l = findLot('south', lots, 2, i % 2 ? 2 : 3);
    if (l) lots.push(l);
  }
  expect(lots.length).toBeGreaterThan(4);
  for (const a of lots)
    for (const b of lots) {
      if (a === b) continue;
      const touch = lotTiles(a).some(([ax, ay]) =>
        lotTiles(b).some(([bx, by]) => Math.abs(ax - bx) <= 1 && Math.abs(ay - by) <= 1),
      );
      expect(touch, `${JSON.stringify(a)} ${JSON.stringify(b)}`).toBe(false);
    }
});
```

- [ ] **Step 2: 실패 확인** — Run: `pnpm vitest run packages/core/src/layout/lots.test.ts` → Expected: FAIL (`lotTiles is not a function` / `size`가 무시돼 `{ x: 10, y: 10 }`).

- [ ] **Step 3: 구현** — `lots.ts`의 `Lot`·`tiles`·`findLot`를 이걸로 바꾼다 (`tiles`는 지움):

```ts
export interface Lot {
  x: number; // 부지의 왼쪽 위 타일
  y: number;
  size?: 3; // 한 변 칸 수. 없으면 2 (집·시설). 일터는 3×3을 예약한다 (06 문서 5.1)
}
export const lotSize = (l: Lot): 2 | 3 => l.size ?? 2;

/** 부지가 덮는 칸 (왼쪽 위부터 줄마다) */
export function lotTiles(l: Lot): [number, number][] {
  const n = lotSize(l);
  const out: [number, number][] = [];
  for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) out.push([l.x + dx, l.y + dy]);
  return out;
}

/** 구역 안에서 광장에 가까운 순서로 첫 빈 size×size 칸. 다른 부지(크기 섞임)와 1칸 이상 간격. ring = 섬 넓힘 단계. 없으면 null */
export function findLot(zone: Zone, occupied: Lot[], ring = 0, size: 2 | 3 = 2): Lot | null {
  const cands: Lot[] = [];
  const lo = -mapOffset(ring);
  const hi = MAP + mapOffset(ring);
  for (let y = lo; y <= hi - size; y++)
    for (let x = lo; x <= hi - size; x++) {
      const l: Lot = size === 3 ? { x, y, size } : { x, y };
      if (!lotTiles(l).every(([tx, ty]) => inZone[zone](tx, ty) && !isRoad(tx, ty) && !isPlaza(tx, ty))) continue;
      // 간격 1칸: 두 부지 사이에 빈 줄이 하나 이상
      const near = (o: Lot) =>
        x < o.x + lotSize(o) + 1 && o.x < x + size + 1 && y < o.y + lotSize(o) + 1 && o.y < y + size + 1;
      if (occupied.some(near)) continue;
      cands.push(l);
    }
  const d = (l: Lot) => Math.hypot(l.x + size / 2 - MID, l.y + size / 2 - MID);
  cands.sort((a, b) => d(a) - d(b) || a.y - b.y || a.x - b.x);
  return cands[0] ?? null;
}
```

`growth.ts` `placeLot`에 `size: 2 | 3 = 2` 인자를 더하고 `findLot(z, occupied, s.ring, size)`로 넘긴다. 주석 "이미 잡힌 부지 (집·시설·작업 건물)" → "(집·시설·일터)".

- [ ] **Step 4: 통과 확인** — Run: `pnpm vitest run packages/core && pnpm exec tsc -b packages/core` → Expected: 모두 PASS (2×2 기존 기대값 `{ x: 10, y: 10 }`·`{ x: 4, y: 4 }` 그대로 — 간격·거리 식이 2×2에서 예전과 같다).

---

### Task 3: 일터 상태·첫 일 (core) + 작업 → 건물 묶기 제거

**Files:**
- Create: `packages/core/src/rules/workplace.ts`, `packages/core/src/rules/workplace.test.ts`
- Modify: `packages/core/src/projector/types.ts` (`Member.cheerUntil` 주석, `Task`, `Building`, `VillageState`)
- Modify: `design/game.default.json` (`buildings`, 새 `workplace`)
- Modify: `packages/core/src/rules/tasks.ts` (전부 다시), `packages/core/src/rules/tasks.test.ts`
- Modify: `packages/core/src/rules/economy.ts` (`runPoints` export, `finishRun` 끝 한 줄)
- Modify: `packages/core/src/projector/project.ts` (`initialState`, `step`)
- Modify: `packages/core/src/index.ts`
- Delete: `packages/core/src/rules/predict.ts`, `packages/core/src/rules/buildings.test.ts`
- Modify tests: `packages/core/src/rules/growth.test.ts:136`, `packages/core/src/projector/replay.test.ts:33-44`, `packages/core/src/projector/recorded.test.ts:31-45`
- Regenerate: `fixtures/sample-session.golden.json`

**Interfaces:**
- Consumes: `placeLot(s, zones, cfg, 3)` (Task 2), `runPoints(r: AgentRun, cfg: GameConfig): number` (economy).
- Produces (types):
  ```ts
  export interface Building {
    id: string; memberId: string; n: number; name: string; lot: Lot;
    floor: number; points: number; paid: number;
    waiting: 'materials' | 'level' | null; startedAt: number; floorAt: number | null;
  }
  // VillageState에 level: number, Task에서 buildingId 뺌
  ```
- Produces (functions): `currentWorkplace(s: VillageState, memberId: string): Building | undefined`, `applyWorkplaces(s: VillageState, e: DomainEvent, cfg: GameConfig): void`, `accrue(s: VillageState, m: Member, points: number, at: number, cfg: GameConfig): void`, `applyTasks(s: VillageState, e: DomainEvent): void` (cfg 인자 없음), `cleanBuildingName`·`NAME_MAX`·`shares`·`completedBy` 그대로.
- Config: `cfg.workplace.levels: { points: number; cost: number; level: number }[]`.

- [ ] **Step 1: 실패하는 테스트 쓰기** — `packages/core/src/rules/workplace.test.ts`:

```ts
// 팀원 일터 (06 문서 5장, D18·D19): 처음 일할 때 3×3 부지 + 현장, 그 일이 끝나면 1층, 일 점수 = 끝난 실행의 도구 호출 × 품질
import { describe, expect, test } from 'vitest';
import { defaultConfig as cfg, type GameConfig } from '../config/config';
import { normalize, type DomainEvent } from '../events/normalize';
import { initialState, project, replay } from '../projector/project';
import type { VillageState } from '../projector/types';
import { cleanBuildingName } from './tasks';

const T0 = Date.parse('2026-10-01T00:00:00.000Z');
const at = (sec: number) => T0 + sec * 1000;
const JOBS: Record<string, string> = { 'backend-dev': 'backend', 'frontend-dev': 'frontend', 'qa-reviewer': 'qa' };
const roster: DomainEvent = {
  t: 'RosterLoaded',
  at: at(0),
  agents: Object.keys(JOBS).map((name) => ({ name, description: '' })),
  tycoon: { members: Object.fromEntries(Object.entries(JOBS).map(([n, job]) => [n, { job }])) },
};
/** 실행 하나: 시작 → 도구 tools번 → 끝. tokens = 비용 환산 입력 토큰 (모델 모름 = 배율 1, 진주 = ÷1,000) */
function work(
  runId: string,
  who: string,
  sec: number,
  tools: number,
  o: { ok?: boolean; tokens?: number } = {},
): DomainEvent[] {
  const ev: DomainEvent[] = [{ t: 'AgentRunStarted', at: at(sec), runId, agentType: who }];
  for (let k = 0; k < tools; k++)
    ev.push({ t: 'ToolUsed', at: at(sec + 1), runId, tool: 'Read', phase: 'post', ok: true, kind: 'read', isTest: false });
  ev.push({
    t: 'AgentRunEnded',
    at: at(sec + 2),
    runId,
    ok: o.ok ?? true,
    ...(o.tokens ? { tokens: { input: o.tokens, output: 0, cacheWrite: 0, cacheRead: 0 } } : {}),
  });
  return ev;
}
const play = (events: DomainEvent[], c: GameConfig = cfg, s: VillageState = initialState('p', c)) =>
  events.reduce((x, e) => project(x, e, c), s);

describe('생기는 때 (5.1)', () => {
  test('첫 실행이 시작되면 3×3 부지에 공사 현장(0층), 끝나면 1층 — 자재비 없음, 도구 0번이어도, 활동 기록만', () => {
    const s1 = play([roster, { t: 'AgentRunStarted', at: at(1), runId: 'a1', agentType: 'backend-dev' }]);
    expect(Object.values(s1.buildings)).toEqual([
      {
        id: 'w1:backend-dev',
        memberId: 'backend-dev',
        n: 1,
        name: '',
        lot: { x: 10, y: 10, size: 3 },
        floor: 0,
        points: 0,
        paid: 0,
        waiting: null,
        startedAt: at(1),
        floorAt: null,
      },
    ]);
    expect(s1.level).toBe(1);
    const s2 = play([{ t: 'AgentRunEnded', at: at(5), runId: 'a1', ok: true }], cfg, s1);
    expect(s2.buildings['w1:backend-dev']).toMatchObject({ floor: 1, points: 0, paid: 0, floorAt: at(5) });
    expect(s2.members['backend-dev']?.balance).toBe(0);
    expect(s2.feed.at(-1)).toMatchObject({ kind: 'task', text: 'backend-dev 일터 1층 완공', ref: 'w1:backend-dev' });
    expect(s2.toasts).toEqual([]);
  });

  test('일 점수 = 도구 호출 × 품질, 급여와 같은 실행 단위 — 실패로 끝난 실행은 0 (5.2)', () => {
    const s = play([
      roster,
      ...work('a1', 'backend-dev', 1, 10),
      ...work('a2', 'backend-dev', 10, 5, { ok: false }),
      ...work('a3', 'backend-dev', 20, 4),
    ]);
    expect(s.buildings['w1:backend-dev']?.points).toBe(14);
    expect(Object.values(s.runs).map((r) => r.wage)).toEqual([260, 0, 104]); // 급여 = 일 점수 × 26
  });

  test('외부인·이름 없는 실행·팀장은 일터가 없다, 외부인 종류 이름으로 등록된 팀원은 팀원 (5.2·5.7)', () => {
    const s = play([
      roster,
      ...work('x1', 'Explore', 1, 3),
      ...work('x2', '', 5, 3),
      { t: 'PromptSubmitted', at: at(9), sessionId: 's', preview: 'go' },
      { t: 'ToolUsed', at: at(10), runId: null, tool: 'Edit', phase: 'post', ok: true, kind: 'edit', isTest: false },
    ]);
    expect(s.buildings).toEqual({});
    const gp: DomainEvent = { t: 'RosterLoaded', at: at(0), agents: [{ name: 'general-purpose', description: '' }], tycoon: null };
    expect(Object.keys(play([gp, ...work('g1', 'general-purpose', 1, 2)]).buildings)).toEqual(['w1:general-purpose']);
  });

  test('완료 기준 (16장): 작업 30건 재생 → 일터 수 = 일한 팀원 수, 작업은 그대로 (5.8)', () => {
    const who = ['backend-dev', 'frontend-dev', 'qa-reviewer', 'Explore', 'backend-dev', 'general-purpose'];
    const ev: DomainEvent[] = [roster];
    for (let i = 0; i < 30; i++) {
      const sec = 10 + i * 20;
      ev.push(
        { t: 'TaskCreated', at: at(sec), taskId: `t${i}`, subject: `작업 ${i}` },
        { t: 'TaskStatusChanged', at: at(sec), taskId: `t${i}`, status: 'in_progress' },
        ...work(`r${i}`, who[i % who.length] ?? '', sec, 1 + (i % 7)),
        { t: 'TaskStatusChanged', at: at(sec + 3), taskId: `t${i}`, status: 'completed' },
      );
    }
    const s = play(ev);
    const workers = new Set(Object.values(s.runs).flatMap((r) => (r.memberId ? [r.memberId] : [])));
    expect([...workers].sort()).toEqual(['backend-dev', 'frontend-dev', 'qa-reviewer']);
    expect(Object.values(s.buildings).map((b) => b.memberId).sort()).toEqual([...workers].sort());
    expect(Object.values(s.buildings).every((b) => b.floor >= 1)).toBe(true);
    expect(Object.values(s.tasks).filter((t) => t.status === 'completed')).toHaveLength(30);
  });
});

describe('이름 (5.6)', () => {
  test('ui 줄 → BuildingRenamed → 정리해서 저장, 없는 id·옛 작업 건물 id(b1)·프로토타입 키는 버린다, 재생해도 같다', () => {
    const _t = '2026-10-01T00:01:00.000Z';
    const ui = (extra: object) => normalize({ _t, hook_event_name: 'ui', kind: 'rename', ...extra });
    expect(ui({ buildingId: 'w1:backend-dev', name: '  새   공방 ' })).toEqual([
      { t: 'BuildingRenamed', at: Date.parse(_t), buildingId: 'w1:backend-dev', name: '  새   공방 ' },
    ]);
    expect(ui({ buildingId: '__proto__', name: 'x' })).toEqual([]);
    const renamed = (buildingId: string, name: unknown, sec: number): DomainEvent => ({
      t: 'BuildingRenamed',
      at: at(sec),
      buildingId,
      name: name as string,
    });
    const events: DomainEvent[] = [
      roster,
      ...work('a1', 'backend-dev', 1, 2),
      renamed('w1:backend-dev', '  새   공방 ', 5),
      renamed('w1:backend-dev', '', 6),
      renamed('w1:backend-dev', 'x'.repeat(25), 7),
      renamed('w1:backend-dev', 42, 8),
      renamed('b1', '옛 건물', 9),
      renamed('constructor', '프로토타입', 10),
    ];
    const s = replay('p', events, cfg);
    expect(Object.keys(s.buildings)).toEqual(['w1:backend-dev']);
    expect(s.buildings['w1:backend-dev']?.name).toBe('새 공방');
    expect(replay('p', events, cfg)).toEqual(s);
    expect(cleanBuildingName('🏠'.repeat(24))).toBe('🏠'.repeat(24)); // 24자(코드 포인트)까지
    expect(cleanBuildingName('가'.repeat(25))).toBeNull();
  });
});
```

그리고 `buildings.test.ts`의 "사용자 이름: 보이지 않는 글자만이면 거절 …" 테스트(238~247줄)를 `describe('이름 (5.6)')` 안으로 글자 그대로 옮긴다.

- [ ] **Step 2: 실패 확인** — Run: `pnpm vitest run packages/core/src/rules/workplace.test.ts` → Expected: FAIL (`s1.buildings`가 비어 있음 / `level` undefined).

- [ ] **Step 3: 상태·설정 모양** — `types.ts`:
  - `Member.cheerUntil` 주석 → `// 일터 층이 오를 때 주인 환호 (cheerMs, 06 문서 5.4)`.
  - `Task`에서 `buildingId: string;` 줄을 지운다.
  - `Building` 인터페이스 전체를 바꾼다:

```ts
/** 팀원 일터 (06 문서 5장, D18·D19). 절대 삭제 안 함. 층·점수·낸 자재비는 내려가지 않는다 */
export interface Building {
  id: string; // `w<n>:<memberId>` — 규칙이 바뀌어 재생해도 같은 id라 사용자 이름(ui rename 줄)이 따라간다 (5.9)
  memberId: string; // 주인. 처음부터 정해진다 (5.6)
  n: number; // 그 팀원의 몇 번째 일터 (1부터, 5.5)
  name: string; // 사용자가 지은 이름. '' = 기본 이름 (화면이 이름 사전으로 "<팀원>의 <종류>", 05 문서 3장)
  lot: Lot; // 3×3 예약 (size 3). 큰 건물 전에는 왼쪽 위 2×2에 서고 나머지는 앞마당
  floor: number; // 0 = 첫 일 공사 중, 1~3층, 4 = 큰 건물 (= workplace.levels.length)
  points: number; // 쌓인 일 점수 (끝난 실행의 도구 호출 × 품질, 5.2)
  paid: number; // 낸 자재비 합 (5.3)
  waiting: 'materials' | 'level' | null; // 게이지는 찼는데 모자란 것 (5.4). 게이지가 덜 찼거나 큰 건물이면 null
  startedAt: number; // 부지를 잡은 시각
  floorAt: number | null; // 마지막으로 층이 오른 시각 (1층 완공 포함) — 반짝임·거품
}
```
  - `VillageState`: `buildings` 주석 → `// 팀원 일터 (06 문서 5장). 절대 삭제 안 함`, `ring` 줄 뒤에 `level: number; // 마을 레벨 (06 문서 6.1). M14가 올린다 — M13에선 늘 1 (일터는 2층까지, 5.9)`.

`design/game.default.json`의 `buildings`를 이걸로 바꾸고 바로 뒤에 `workplace`를 넣는다:

```json
  "buildings": {
    "completeFxMs": 3000,
    "cheerMs": 2000,
    "$cheerMs": "일터 층이 오를 때 주인 환호 포즈 길이 (06 문서 5.4)"
  },

  "workplace": {
    "levels": [
      { "points": 0, "cost": 0, "level": 1 },
      { "points": 75, "cost": 700, "level": 1 },
      { "points": 225, "cost": 1400, "level": 4 },
      { "points": 450, "cost": 2100, "level": 7 }
    ],
    "$levels": "일터 층 (06 문서 5.3): i번째 줄 = i+1층 조건(마지막 = 큰 건물 3×3) — 누적 일 점수, 자재비(주인 잔고에서 한 번), 필요한 마을 레벨. 1층은 첫 일이 끝나면. 자재비는 M13 보정 전 어림"
  },
```

`project.ts` `initialState`: `ring: 0,` 뒤에 `level: 1,`.

- [ ] **Step 4: 일터 규칙** — `packages/core/src/rules/workplace.ts`:

```ts
// 팀원 일터 (06 문서 5장, D18·D19): 처음 일할 때 3×3 부지 + 공사 현장, 그 일이 끝나면 1층, 끝난 실행의 일 점수를 쌓는다.
// 순수: 시각은 이벤트, id는 주인·순번 (5.9)
import type { GameConfig } from '../config/config';
import type { DomainEvent } from '../events/normalize';
import type { Building, Member, VillageState } from '../projector/types';
import { placeLot } from './growth';

/** 그 팀원의 가장 최근 일터 (n이 가장 큰 것) */
export function currentWorkplace(s: VillageState, memberId: string): Building | undefined {
  let cur: Building | undefined;
  for (const b of Object.values(s.buildings)) if (b.memberId === memberId && (!cur || b.n > cur.n)) cur = b;
  return cur;
}

/** 일이 쌓일 일터: 지금 일터, 없거나 큰 건물이 됐으면 새 부지를 잡는다 (5.1·5.5) */
function siteFor(s: VillageState, m: Member, at: number, cfg: GameConfig): Building {
  const cur = currentWorkplace(s, m.id);
  if (cur && cur.floor < cfg.workplace.levels.length) return cur;
  const n = (cur?.n ?? 0) + 1;
  const id = `w${n}:${m.id}`;
  let lot = placeLot(s, ['south', 'east'], cfg, 3);
  if (!lot) {
    lot = { x: -1, y: -1, size: 3 }; // maxRing까지 넓혀도 없으면 맵 밖
    s.feed.push({ at, kind: 'task', text: `일터 지을 자리가 없음: ${m.name}`, ref: id });
  }
  const b: Building = {
    id,
    memberId: m.id,
    n,
    name: '',
    lot,
    floor: 0,
    points: 0,
    paid: 0,
    waiting: null,
    startedAt: at,
    floorAt: null,
  };
  s.buildings[id] = b;
  if (n > 1) s.feed.push({ at, kind: 'task', text: `${m.name} ${n}번째 일터 부지를 잡았어요`, ref: id });
  return b;
}

/** 팀원 실행이 시작되면 그 팀원 일터 (첫 일이면 공사 현장). 외부인·팀장·이름 없는 실행은 없음 (5.2·5.7).
 *  applyGrowth(입주·등록) 뒤, applyRuns 앞에 돈다. 같은 시작이 또 와도 같은 일터 */
export function applyWorkplaces(s: VillageState, e: DomainEvent, cfg: GameConfig): void {
  if (e.t !== 'AgentRunStarted') return;
  const m = Object.hasOwn(s.members, e.agentType) ? s.members[e.agentType] : undefined;
  if (m && !m.isLeader) siteFor(s, m, e.at, cfg);
}

/** 팀원 실행이 끝나 급여를 준 뒤 (economy finishRun): 첫 일이면 1층 완공(자재비 없음), 일 점수를 쌓는다 */
export function accrue(s: VillageState, m: Member, points: number, at: number, cfg: GameConfig): void {
  const b = siteFor(s, m, at, cfg);
  b.points += points;
  if (b.floor === 0) {
    b.floor = 1;
    b.floorAt = at;
    s.feed.push({ at, kind: 'task', text: `${m.name} 일터 1층 완공`, ref: b.id }); // 1층은 활동 기록만 (5.9)
  }
}
```

`project.ts`: `import { applyWorkplaces } from '../rules/workplace';`, `step`에서 `applyGrowth(s, e, cfg);` 바로 뒤에 `applyWorkplaces(s, e, cfg);`, `applyTasks(s, e, cfg);` → `applyTasks(s, e);`. step 주석 순서를 "등록 → 성장(입주·시설) → 일터(현장) → 실행 → …"으로.

`economy.ts`: `const runPoints = …` → `export const runPoints = …`, `import { accrue } from './workplace';`, `finishRun` 맨 끝(효율 줄 뒤)에:

```ts
  accrue(s, m, runPoints(r, cfg), r.endedAt ?? r.lastAt, cfg); // 일터 게이지 (06 문서 5.2) — 급여와 같은 실행 단위
```

`index.ts`: `export * from './rules/predict';` 줄을 `export * from './rules/workplace';`로.

- [ ] **Step 5: 작업 → 건물 묶기 제거** — `tasks.ts`를 이 내용으로 바꾼다 (지우는 것: `openBuilding`·`accepts`·`newBuilding`·`restage`·`RANK`·`autoName`·`tallyOwner`·`finish`, `placeLot`·`nextId` import):

```ts
// 작업·기여 (01 문서 5장, 06 문서 5.8). 작업은 급여 기록·효율·회의·활동 기록·신문의 단위이고 건물을 만들지 않는다 —
// 건물은 팀원 일터 (rules/workplace.ts). 순수: 시각은 e.at
import type { DomainEvent, TaskStatus } from '../events/normalize';
import { LEADER_ID, type AgentRun, type Task, type VillageState } from '../projector/types';

export function applyTasks(s: VillageState, e: DomainEvent): void {
  if (e.t === 'TaskCreated') s.taskTool = true; // 이제 Agent 호출은 작업이 아니다 (5.1-5)
  if (e.t === 'TaskCreated' && !s.tasks[e.taskId]) create(s, e.taskId, e.subject, e.at);
  if (e.t === 'TaskStatusChanged') changeStatus(s, e.taskId, e.status, e.at);
  agentTasks(s, e);
  if (e.t === 'BuildingRenamed') {
    // 없는 일터·규칙에 안 맞는 이름은 버린다 (서버가 400으로 먼저 막는다). own 키만 (constructor 같은 이름으로 프로토타입을 집지 않게)
    const b = Object.hasOwn(s.buildings, e.buildingId) ? s.buildings[e.buildingId] : undefined;
    const name = cleanBuildingName(e.name);
    if (b && name !== null) b.name = name;
  }
  // 실행 중인 팀원은 자기 실행의 작업(Agent 호출 대체), 없으면 가장 최근에 시작된 진행 중 작업에 붙인다
  let cur: Task | undefined;
  for (const t of Object.values(s.tasks))
    if (t.status === 'in_progress' && (!cur || (t.startedAt ?? 0) >= (cur.startedAt ?? 0))) cur = t;
  for (const m of Object.values(s.members)) {
    const own = s.runs[m.currentRunId ?? '']?.taskId;
    m.currentTaskId = !m.currentRunId ? null : own && s.tasks[own]?.status === 'in_progress' ? own : (cur?.id ?? null);
  }
}
```

그 아래 `completedBy`는 그대로, `agentTasks(s, e)`는 `cfg` 인자를 빼고 안의 `create(…, cfg)`·`changeStatus(…, cfg)` 호출에서 `cfg`를 뺀다. `NAME_MAX`·`INVISIBLE`·`cleanBuildingName`·`shares`는 그대로. `create`·`changeStatus`는:

```ts
function create(s: VillageState, id: string, subject: string, at: number) {
  s.tasks[id] = {
    id,
    subject,
    status: 'pending',
    createdAt: at,
    contributions: {},
    quality: 'noTests',
    toolCalls: 0,
    salaryPaid: 0,
  };
}

function changeStatus(s: VillageState, id: string, status: TaskStatus, at: number) {
  const t = s.tasks[id];
  // 지운 작업은 끝: 늦은 갱신이 되살리지 않는다 (01 문서 5.4 M7)
  if (!t || t.status === status || t.status === 'deleted') return;
  t.status = status;
  if (status === 'in_progress') t.startedAt ??= at;
  if (status !== 'completed') return;
  t.completedAt = at;
  const sh = shares(s, t, at);
  t.contributions = {};
  for (const x of sh) t.contributions[x.key] = (t.contributions[x.key] ?? 0) + x.ms;
  const runs = sh.flatMap((x) => (x.run ? [x.run] : []));
  t.toolCalls = runs.reduce((n, r) => n + r.toolCalls, 0);
  // 6.1: 실행 중 테스트 명령이 한 번이라도 성공 → testsPassed (실패 뒤 고쳐서 통과도)
  t.quality = runs.some((r) => r.ok === false)
    ? 'failed'
    : runs.some((r) => r.testsPassed > 0)
      ? 'testsPassed'
      : 'noTests';
}
```

`shares` 주석의 "완공(finish)·건물 상세 예상(predictOwner)" 언급을 "성격 표본(7장)·작업 기여"로. `predict.ts`와 `buildings.test.ts`(Step 1에서 옮긴 이름 테스트 빼고)를 지운다.

- [ ] **Step 6: 기존 테스트 맞추기**
  - `tasks.test.ts`: `play`를 `function play(events: DomainEvent[], s: VillageState = initialState('p')) { for (const e of events) applyTasks(s, e); return s; }`로, `buildings` 헬퍼와 `defaultConfig`·`makeConfig` import를 지운다. 테스트 지움: "5초 안에 만든 작업 6개는 건물 1채…", "3개 미만이면 5분까지…", "N=4 완료 0~4 → 단계…", "완공: 주인은 기여 합이…", "완공 건물의 작업을 지워도…", "건물은 남쪽부터…", "만들고 끝내고 또 만들면 같은 건물…", "작업이 다 지워진 빈 부지는…". "기여 = …" 테스트에서 `expect(buildings(s)[0]).toMatchObject({ n: 6, stage: 'foundation' });` 한 줄을 지운다. 마지막 테스트를 이걸로 바꾼다:

```ts
test('지운 작업은 끝: 늦은 갱신이 되살리지 않는다 (5.4 M7), 작업은 건물을 만들지 않는다 (06 문서 5.8)', () => {
  const s = play([created('a', 0), created('b', 1), status('a', 'deleted', 50), status('b', 'deleted', 51)]);
  play([status('a', 'in_progress', 60), status('a', 'completed', 61), status('b', 'pending', 62)], s);
  expect([s.tasks.a?.status, s.tasks.b?.status]).toEqual(['deleted', 'deleted']);
  expect(s.buildings).toEqual({});
});
```
  - `growth.test.ts:136` → `expect(Object.keys(s.buildings)).toEqual(['w1:backend-dev']); // 작업이 아니라 일한 팀원마다 일터 (06 문서 5장)`.
  - `replay.test.ts` 첫 테스트의 35~37줄을 이걸로 (제목 "sample-session 재생 → M4 완료 기준 + M13 일터"):

```ts
  const workers = new Set(Object.values(s.runs).flatMap((r) => (r.memberId ? [r.memberId] : [])));
  expect(new Set(Object.values(s.buildings).map((b) => b.memberId))).toEqual(workers); // 일터 수 = 일한 팀원 수 (06 문서 16장)
  expect(s.buildings['w1:qa-reviewer']).toMatchObject({ floor: 1, lot: { x: 10, y: 10, size: 3 } }); // 끝낸 실행 → 1층 (남)
  expect(s.buildings['w1:backend-dev']).toMatchObject({ floor: 0, lot: { x: 10, y: 3, size: 3 } }); // 권한 기다리는 첫 실행 → 현장 (동)
```
  - `recorded.test.ts` 제목 끝 "Agent 호출 = 작업 → 건물" → "Agent 호출 = 작업, 일한 팀원 = 일터", 40줄 → `expect(Object.values(s.buildings).map((b) => [b.id, b.floor, b.points])).toEqual([['w1:claude', 1, 13]]); // 도구 5 + 8번, 자재비 전 (75점)`.

- [ ] **Step 7: 골든 다시 만들기** — Run: `pnpm vitest run -u packages/core/src/projector/replay.test.ts`. diff에서 확인: `buildings`가 `w1:qa-reviewer`(1층)·`w1:backend-dev`(0층) 둘, `tasks.*.buildingId` 없음, `"level": 1`, 작업 건물 id(`b1`)가 없어져 `seq`와 토스트 id가 하나씩 당겨짐. 그 밖의 차이가 있으면 멈추고 원인을 적는다.

- [ ] **Step 8: 통과 확인** — Run: `pnpm vitest run packages/core && pnpm exec tsc -b packages/core` → Expected: 모두 PASS. (서버·웹은 Task 4·8까지 컴파일 오류가 정상)

---

### Task 4: 서버 — 일터 이름 바꾸기 (`:bid` 디코드)

**Files:**
- Modify: `packages/server/src/http.ts` (`rename` 주석, 라우팅 `rename(…, decode(bid))`)
- Test: `packages/server/src/collector.test.ts`

**Interfaces:**
- Consumes: `state.buildings` (Task 3), 일터 id `w1:<memberId>` (콜론 포함 → 화면은 `encodeURIComponent`로 보낸다).
- Produces: `PUT /api/projects/:id/buildings/:bid/name`, `:bid`는 URL 디코드 (`w1%3Aqa-reviewer`), 204 / 400 / 404 그대로.

- [ ] **Step 1: 실패하는 테스트로 바꾸기** — `collector.test.ts`:
  - 첫 테스트 제목 "…작업 6개, 건물 1채" → "…작업 6개, 일터 2곳 (일한 팀원 qa-reviewer·backend-dev)", 89줄 → `expect(Object.keys((await state()).buildings).sort()).toEqual(['w1:backend-dev', 'w1:qa-reviewer']);`
  - SSE 설정 테스트: `tycoon({ visitorsCountForType: true })` → `tycoon({ cheerMs: 1500 })`, 정규식 `"visitorsCountForType":true` → `"cheerMs":1500`, `tycoon({ visitorsCountForType: false })` → `tycoon({ cheerMs: 2500 })`, 마지막 `toContain('"visitorsCountForType":false')` → `toContain('"cheerMs":2500')`.
  - 이름 바꾸기 테스트: `const bid = 'w1:qa-reviewer';`, `put`의 주소를 `` url(`/api/projects/${id}/buildings/${encodeURIComponent(b)}/name`) ``로, `expect(seen).toContain('"nameByUser":true');` 줄을 지우고, `toMatchObject({ name: '로그인 마을', nameByUser: true })` → `toMatchObject({ name: '로그인 마을' })`, 403 검사 주소도 `encodeURIComponent(bid)`.
  - 재시작 테스트(`Object.values(before.buildings)[0]).toMatchObject({ name: '로그인 마을', nameByUser: true })`) → `nameByUser` 빼기.

- [ ] **Step 2: 실패 확인** — Run: `pnpm vitest run packages/server/src/collector.test.ts` → Expected: FAIL — 이름 바꾸기가 `204` 대신 `404` (`w1%3Aqa-reviewer`를 디코드하지 않아 없는 일터).

- [ ] **Step 3: 구현** — `http.ts`: `case 'PUT :id/buildings/:bid/name': return rename(req, res, id ?? '', decode(bid));`, `rename` 위 주석 → `/** 일터 이름 바꾸기 (02 문서 9장, 06 문서 5.6): 본문 { name }, 규칙은 01 문서 5.3. bid는 URL 디코드 (w1%3Abackend-dev) */`.

- [ ] **Step 4: 통과 확인** — Run: `pnpm vitest run packages/server && pnpm exec tsc -b packages/server` → Expected: PASS.

---

### Task 5: 게이지·층·자재비·대기·레벨 게이트·두 번째 일터 (core)

**Files:**
- Modify: `packages/core/src/rules/workplace.ts` (`raise`, `raiseAll`, `waitingMaterials`, `accrue` 끝에 `raise`)
- Modify: `packages/core/src/rules/economy.ts` (`settle`: `raiseAll` + 자동 구매 쉼)
- Test: `packages/core/src/rules/workplace.test.ts` (추가), `packages/core/src/rules/economy.test.ts:305-338` (불변식)

**Interfaces:**
- Consumes: `VillageState.level`, `cfg.workplace.levels`, `cfg.buildings.cheerMs`, `nextId(s, 'toast')`.
- Produces: `raiseAll(s: VillageState, at: number, cfg: GameConfig): void`, `waitingMaterials(s: VillageState, memberId: string): boolean`. `Building.waiting`·`paid`·`floorAt`·`floor` 갱신, `Member.balance −= cost`, `Member.cheerUntil`.

- [ ] **Step 1: 실패하는 테스트 쓰기** — `workplace.test.ts`의 config import에 `makeConfig`를 더하고 끝에 추가:

```ts
/** 빠른 층 (시험용): 2층 10점 · 3층 20점(Lv.4) · 큰 건물 30점(Lv.7), 자재비 300씩. 도구 10번 = 급여 260, 세금 52 → +208 */
const quick = makeConfig({
  overrides: {
    workplace: {
      levels: [
        { points: 0, cost: 0, level: 1 },
        { points: 10, cost: 300, level: 1 },
        { points: 20, cost: 300, level: 4 },
        { points: 30, cost: 300, level: 7 },
      ],
    },
  },
});
const wp = (s: VillageState, id = 'w1:backend-dev') => s.buildings[id];
const tick = (day: number, sec: number): DomainEvent => ({ t: 'GameDayTick', at: at(sec), day });

describe('층 올리기 (5.3·5.4)', () => {
  test('게이지가 차도 자재비가 모자라면 대기 (들어갈 때 한 번 알림), 급여로 모이면 자재비를 내고 2층 + 환호 + 알림', () => {
    const s1 = play([roster, ...work('a1', 'backend-dev', 1, 10)], quick); // 잔고 208 < 300
    expect(wp(s1)).toMatchObject({ floor: 1, points: 10, waiting: 'materials', paid: 0 });
    expect(s1.toasts.map((x) => [x.kind, x.text])).toEqual([['tokens', 'backend-dev 일터 2층 자재비 대기 · 300']]);
    const s2 = play(work('a2', 'backend-dev', 10, 1), quick, s1); // +21 → 229, 또 모자람 → 알림 없음
    expect(wp(s2)).toMatchObject({ floor: 1, points: 11, waiting: 'materials' });
    expect(s2.toasts).toHaveLength(1);
    const s3 = play(work('a3', 'backend-dev', 20, 4), quick, s2); // +83 → 312 ≥ 300
    expect(wp(s3)).toMatchObject({ floor: 2, points: 15, waiting: null, paid: 300, floorAt: at(22) });
    expect(s3.members['backend-dev']).toMatchObject({ balance: 12, cheerUntil: at(22) + quick.buildings.cheerMs });
    expect(s3.toasts.at(-1)).toMatchObject({ kind: 'complete', text: 'backend-dev 일터 2층 완공', sticky: false });
    expect(s3.feed.at(-1)).toMatchObject({ kind: 'task', text: 'backend-dev 일터 2층 완공', ref: 'w1:backend-dev' });
  });

  test('하루 정산에서도 다시 본다 (자동 구매보다 먼저), 자재비를 기다리는 동안은 가구 자동 구매를 쉰다', () => {
    const s1 = play([roster, ...work('a1', 'frontend-dev', 1, 10)], quick); // 대기
    const fe1 = s1.members['frontend-dev'];
    if (!fe1) throw new Error('frontend-dev');
    fe1.balance = 250; // ENFP(꾸미기): 예산 125면 화분(80)을 살 수 있지만 쉰다
    const s2 = play([tick(1, 100)], quick, s1);
    expect(s2.members['frontend-dev']).toMatchObject({ balance: 250, furniture: [] });
    expect(wp(s2, 'w1:frontend-dev')?.waiting).toBe('materials');
    const fe2 = s2.members['frontend-dev'];
    if (!fe2) throw new Error('frontend-dev');
    fe2.balance = 500;
    const s3 = play([tick(2, 200)], quick, s2); // 정산: 2층(−300) → 자동 구매 (예산 100 → 화분 80)
    expect(wp(s3, 'w1:frontend-dev')).toMatchObject({ floor: 2, waiting: null, paid: 300, floorAt: at(200) });
    expect(s3.members['frontend-dev']?.furniture.map((f) => f.kind)).toEqual(['plant']);
    expect(s3.members['frontend-dev']?.balance).toBe(120);
  });

  test('마을 레벨이 모자라면 "Lv.N 필요" 대기 (알림 없음), 점수는 그 일터에 계속 — M13은 Lv.1이라 2층에서 멈춤, 레벨이 오르면 정산에서 오른다', () => {
    const s1 = play(
      [roster, ...work('a1', 'backend-dev', 1, 10), ...work('a2', 'backend-dev', 10, 10), ...work('a3', 'backend-dev', 20, 10)],
      quick,
    );
    expect(s1.level).toBe(1);
    expect(wp(s1)).toMatchObject({ floor: 2, points: 30, waiting: 'level', paid: 300 });
    expect(Object.keys(s1.buildings)).toEqual(['w1:backend-dev']);
    expect(s1.toasts.map((x) => x.kind)).toEqual(['tokens', 'complete']);
    const up = structuredClone(s1);
    up.level = 4; // M14가 레벨을 올린 셈
    const s2 = play([tick(1, 100)], quick, up);
    expect(wp(s2)).toMatchObject({ floor: 3, waiting: 'level', paid: 600 }); // 큰 건물은 Lv.7
    expect(s2.members['backend-dev']?.balance).toBe(24);
  });

  test('큰 건물(Lv.7)이 되면 다음 일은 두 번째 일터 (새 부지, 0층부터) — 첫 일터는 3×3 그대로', () => {
    const s0 = initialState('p', quick);
    s0.level = 7;
    const s1 = play([roster, ...work('a1', 'backend-dev', 1, 60)], quick, s0); // +1,248, 층 셋 900
    expect(wp(s1)).toMatchObject({ floor: 4, points: 60, paid: 900, waiting: null });
    expect(s1.members['backend-dev']?.balance).toBe(348);
    const [start, ...rest] = work('a2', 'backend-dev', 10, 5);
    if (!start) throw new Error('start');
    const s2 = play([start], quick, s1);
    expect(wp(s2, 'w2:backend-dev')).toMatchObject({ n: 2, floor: 0, points: 0, lot: { size: 3 } });
    expect(wp(s2, 'w2:backend-dev')?.lot).not.toEqual(wp(s2)?.lot);
    expect(s2.feed.at(-1)?.text).toBe('backend-dev 2번째 일터 부지를 잡았어요');
    const s3 = play(rest, quick, s2);
    expect(wp(s3, 'w2:backend-dev')).toMatchObject({ floor: 1, points: 5 });
    expect(wp(s3)).toMatchObject({ floor: 4, points: 60, paid: 900 });
  });

  test('큰 건물이 Lv.7을 기다리는 동안은 점수가 그 일터에 계속 쌓인다 (5.5)', () => {
    const s0 = initialState('p', quick);
    s0.level = 4;
    const s = play([roster, ...work('a1', 'backend-dev', 1, 60), ...work('a2', 'backend-dev', 10, 5)], quick, s0);
    expect(Object.keys(s.buildings)).toEqual(['w1:backend-dev']);
    expect(wp(s)).toMatchObject({ floor: 3, points: 65, waiting: 'level' });
  });
});

/** 시험 전용 seed 난수 (mulberry32). 프로젝터는 난수를 쓰지 않는다 */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('불변 (5.2, CLAUDE.md "완공된 건물은 지우지 않는다")', () => {
  test('진주가 새지 않는다: 잔고 + 기금 + 광장 + 가구 + 낸 토큰 + 자재비 = 급여', () => {
    const ev = [
      roster,
      ...work('a1', 'backend-dev', 1, 12, { tokens: 50_000 }),
      ...work('a2', 'qa-reviewer', 5, 30),
      tick(1, 100),
      ...work('a3', 'backend-dev', 200, 8),
      tick(2, 300),
    ];
    const s = play(ev, quick);
    const wages = Object.values(s.runs).reduce((a, r) => a + (r.wage ?? 0), 0);
    const balances = Object.values(s.members).reduce((a, m) => a + m.balance, 0);
    const furniture = Object.values(s.members)
      .flatMap((m) => m.furniture)
      .reduce((a, f) => a + (f.paid ?? f.price), 0);
    const plaza = s.economy.plaza.reduce((a, p) => a + p.cost, 0);
    const days = [...s.economy.history, s.economy.today];
    const tokens = days.reduce((a, r) => a + r.tokens + r.leaderTokens, 0);
    const materials = Object.values(s.buildings).reduce((a, b) => a + b.paid, 0);
    expect(materials).toBeGreaterThan(0);
    expect(balances + s.economy.fund + plaza + furniture + tokens + materials).toBe(wages);
  });

  test('무작위 순서(seed 12개 × 300 이벤트): 일터는 사라지지 않고 층·점수·낸 자재비는 내려가지 않으며 주인·부지는 안 바뀐다', () => {
    const who = ['backend-dev', 'frontend-dev', 'qa-reviewer', 'Explore', 'general-purpose'];
    for (let seed = 1; seed <= 12; seed++) {
      const r = rng(seed);
      const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
      let s = play([roster], quick);
      s.level = 1 + Math.floor(r() * 10);
      const open: string[] = [];
      let n = 0;
      for (let i = 0; i < 300; i++) {
        const sec = 10 + i;
        const x = r();
        let e: DomainEvent;
        if (x < 0.25 || !open.length) {
          const id = `r${seed}-${n++}`;
          open.push(id);
          e = { t: 'AgentRunStarted', at: at(sec), runId: id, agentType: pick(who) ?? '' };
        } else if (x < 0.6)
          e = { t: 'ToolUsed', at: at(sec), runId: pick(open) ?? '', tool: 'Read', phase: 'post', ok: r() > 0.1, kind: 'read', isTest: false };
        else if (x < 0.8)
          e = { t: 'AgentRunEnded', at: at(sec), runId: open.splice(Math.floor(r() * open.length), 1)[0] ?? '', ok: r() > 0.2 };
        else if (x < 0.85) e = { t: 'GameDayTick', at: at(sec), day: s.clock.day + 1 };
        else if (x < 0.9)
          e = { t: 'BuildingRenamed', at: at(sec), buildingId: pick(Object.keys(s.buildings)) ?? 'w9:x', name: `이름 ${i}` };
        else if (x < 0.95) e = { t: 'TaskCreated', at: at(sec), taskId: `t${i}`, subject: 'x' };
        else e = { t: 'SessionStarted', at: at(sec), project: 'p', sessionId: `s${i}` };
        const prev = s;
        s = project(prev, e, quick);
        if (e.t === 'SessionStarted') open.length = 0;
        for (const [id, a] of Object.entries(prev.buildings)) {
          const b = s.buildings[id];
          const why = `seed ${seed} #${i} ${e.t} ${id}`;
          expect([b?.id, b?.memberId, b?.n, b?.lot, b?.startedAt], why).toEqual([a.id, a.memberId, a.n, a.lot, a.startedAt]);
          expect((b?.floor ?? -1) >= a.floor && (b?.points ?? -1) >= a.points && (b?.paid ?? -1) >= a.paid, why).toBe(true);
        }
      }
    }
  });
});
```

`economy.test.ts`의 "잔고 + 기금 + 광장 + 가구 + 낸 토큰…" 테스트 마지막 식에 자재비를 더한다: `const materials = Object.values(s.buildings).reduce((a, b) => a + b.paid, 0);` 그리고 `expect(balances + s.economy.fund + plaza + furniture + sum('tokens') + sum('leaderTokens') + materials).toBe(wages);` (제목 끝에 "· 자재비").

- [ ] **Step 2: 실패 확인** — Run: `pnpm vitest run packages/core/src/rules/workplace.test.ts` → Expected: FAIL (층이 1에서 안 오르고 `waiting`이 늘 null).

- [ ] **Step 3: 구현** — `workplace.ts`에 `import { nextId } from '../projector/project';`를 더하고:

```ts
/** 활동 기록·토스트 글자의 층 이름 (화면 글자는 이름 사전 workplace.floor) */
const FLOOR = ['공사 중', '1층', '2층', '3층', '큰 건물'];

/** 층 올리기 (5.4): 게이지 ≥ 다음 층 점수, 마을 레벨 충족, 잔고 ≥ 자재비가 다 맞으면 자재비를 내고 +1 (여러 층도 한 번에).
 *  하나라도 모자라면 대기 이유 — 자재비 대기는 들어갈 때 한 번 알림, 레벨 대기는 알림 없음. 0층 → 1층은 accrue가 올린다 */
function raise(s: VillageState, b: Building, at: number, cfg: GameConfig) {
  const m = s.members[b.memberId];
  if (!m || b.floor < 1) return;
  for (;;) {
    const next = cfg.workplace.levels[b.floor];
    if (!next || b.points < next.points) return void (b.waiting = null);
    if (s.level < next.level) return void (b.waiting = 'level');
    if (m.balance < next.cost) {
      if (b.waiting !== 'materials') {
        const text = `${m.name} 일터 ${FLOOR[b.floor + 1] ?? ''} 자재비 대기 · ${next.cost}`;
        s.feed.push({ at, kind: 'economy', text, ref: b.id });
        s.toasts.push({ id: nextId(s, 'toast'), at, kind: 'tokens', text, sticky: false, ref: m.id });
      }
      return void (b.waiting = 'materials');
    }
    m.balance -= next.cost;
    b.paid += next.cost;
    b.floor++;
    b.floorAt = at;
    b.waiting = null;
    m.cheerUntil = at + cfg.buildings.cheerMs;
    const text = `${m.name} 일터 ${FLOOR[b.floor] ?? ''} 완공`;
    s.feed.push({ at, kind: 'task', text, ref: b.id });
    s.toasts.push({ id: nextId(s, 'toast'), at, kind: 'complete', text, sticky: false });
  }
}

/** 하루 정산 때 (economy settle, 자동 구매 전): 모든 일터를 다시 본다 — 레벨이 오른 뒤(M14)도 여기서 (5.4) */
export function raiseAll(s: VillageState, at: number, cfg: GameConfig): void {
  for (const b of Object.values(s.buildings)) raise(s, b, at, cfg);
}

/** 자재비를 기다리는 팀원 → 가구 자동 구매를 쉰다 (돈이 일터로 먼저 가게, 5.4) */
export const waitingMaterials = (s: VillageState, memberId: string) =>
  Object.values(s.buildings).some((b) => b.memberId === memberId && b.waiting === 'materials');
```

`accrue` 끝(1층 블록 뒤)에 `raise(s, b, at, cfg);`.

`economy.ts`: `import { accrue, raiseAll, waitingMaterials } from './workplace';`. `settle`의 자동 구매 앞을:

```ts
  // 일터 층 (06 문서 5.4): 자동 구매보다 먼저 — 돈이 일터로 먼저 가게
  raiseAll(s, at, cfg);
  // 자동 구매 (6.4): 팀장은 사지 않는다 (D21 — 사용자가 사 주면 기금에서), 자재비를 기다리는 팀원은 쉰다 (5.4)
  for (const m of Object.values(s.members)) m.boughtToday = 0;
  if (cfg.economy.autoBuy.enabled)
    for (const m of Object.values(s.members))
      if (!m.isLeader && !m.departed && s.houses[m.id] && !waitingMaterials(s, m.id)) autoBuy(s, m, day, at, cfg);
```

`settle` 위 주석을 "하루 정산 (6.2 순서): 일터 층 → 자동 구매 → 광장 소품 → 기록 → today 비우기"로.

- [ ] **Step 4: 통과 확인** — Run: `pnpm vitest run packages/core packages/server && pnpm exec tsc -b packages/core` → Expected: PASS. 골든은 바뀌지 않아야 한다 (골든 일터 점수는 75 미만). 다른 경제·수집기 시험의 잔고가 바뀌면 그 시험에서 팀원이 75점·700진주를 넘어 자재비를 낸 것 — 그 경우만 기대값에서 자재비를 빼 고치고 까닭을 주석으로 적는다. 그 밖의 차이는 멈추고 원인을 본다.

---

### Task 6: 자재비 보정 (DB 복사본 재생) + 성장 시뮬레이션

**Files:**
- Create (저장소 밖, 남기지 않음): `<임시 폴더>/calibrate.ts`
- Modify: `design/game.default.json` (`workplace.levels[].cost`, `$levels`), `docs/06-도시와-경제.md` 5.3 (표 자재비 칸 + 둘째 줄 문단)
- Test: `packages/core/src/rules/workplace.test.ts` (describe '성장 시뮬레이션' 추가)

**Interfaces:**
- Consumes: `openDb(path).rows()` (`packages/server/src/db.ts`), `normalize`, `project`, `initialState`, `makeConfig` (core).
- Produces: 자재비 세 값 `cost₂ · cost₃ · cost₄` (100 단위 반올림), 06 5.3 기록. 컨트롤러 승인 뒤 확정.

- [ ] **Step 1: DB 복사** — Run: `D=$(mktemp -d) && cp ~/.subagent-tycoon/tycoon.db* "$D"/ && ls "$D"` → Expected: `tycoon.db` (+ `-wal`·`-shm`이 있으면 같이). 실제 DB·4777 수집기는 건드리지 않는다.

- [ ] **Step 2: 보정 스크립트** — `"$D"/calibrate.ts`:

```ts
// M13 자재비 보정 (06 문서 5.3): DB 복사본을 새 규칙으로 재생하며 일터 층이 오르는 순간 주인의 잔고를 모은다.
// 자재비 0 · 마을 레벨 10으로 돌려 "게이지가 찼을 때 모여 있는 돈"을 본다 (가구 자동 구매·토큰 비용은 평소대로)
import { openDb } from '/Users/kimtaewoo/brain/projects/agent_village/packages/server/src/db';
import {
  defaultConfig,
  initialState,
  makeConfig,
  normalize,
  project,
  type GameConfig,
  type Raw,
  type TycoonConfig,
  type VillageState,
} from '/Users/kimtaewoo/brain/projects/agent_village/packages/core/src/index';

const FREE = { workplace: { levels: defaultConfig.workplace.levels.map((l) => ({ ...l, cost: 0 })) } };
const conf = (t?: TycoonConfig): GameConfig =>
  makeConfig({ ...(t ?? {}), overrides: { ...(t?.overrides ?? {}), ...FREE } });
const med = (xs: number[]) => {
  const a = [...xs].sort((x, y) => x - y);
  const k = a.length >> 1;
  return a.length === 0 ? NaN : a.length % 2 ? (a[k] ?? NaN) : ((a[k - 1] ?? 0) + (a[k] ?? 0)) / 2;
};

const db = openDb(process.env.TYCOON_DB ?? '');
const villages = new Map<string, { s: VillageState; cfg: GameConfig }>();
const hits: { village: string; member: string; floor: number; balance: number; points: number }[] = [];
for (const row of db.rows()) {
  const p = JSON.parse(row.payload) as Raw;
  let v = villages.get(row.project);
  if (!v) {
    const cfg = conf(p.hook_event_name === 'roster' ? (p.tycoon as TycoonConfig | undefined) : undefined);
    v = { s: { ...initialState(row.project, cfg), level: 10 }, cfg };
    villages.set(row.project, v);
  }
  if (p.hook_event_name === 'roster') v.cfg = conf((p.tycoon ?? undefined) as TycoonConfig | undefined);
  for (const e of normalize(p)) {
    const before = v.s;
    try {
      v.s = project(before, e, v.cfg);
    } catch {
      continue; // 수집기와 같이: 규칙 하나가 터져도 계속
    }
    for (const b of Object.values(v.s.buildings))
      for (let f = Math.max((before.buildings[b.id]?.floor ?? 0) + 1, 2); f <= b.floor; f++)
        hits.push({ village: row.project, member: b.memberId, floor: f, balance: v.s.members[b.memberId]?.balance ?? 0, points: b.points });
  }
}
const members = [...villages.entries()].flatMap(([village, { s, cfg }]) =>
  Object.values(s.members)
    .filter((m) => !m.isLeader)
    .flatMap((m) => {
      const runs = Object.values(s.runs).filter((r) => r.memberId === m.id && r.wage !== undefined);
      const points = Object.values(s.buildings).filter((b) => b.memberId === m.id).reduce((a, b) => a + b.points, 0);
      if (runs.length < 3 || points <= 0) return [];
      const net = runs.reduce((a, r) => a + (r.wage ?? 0) - Math.round((r.wage ?? 0) * cfg.economy.taxRate), 0);
      const tokens = runs.reduce((a, r) => a + Math.round((r.tokens ?? 0) / cfg.economy.tokens.perPearl), 0);
      const furniture = m.furniture.filter((f) => f.by === 'auto').reduce((a, f) => a + (f.paid ?? f.price), 0);
      return [{ village, member: m.id, runs: runs.length, points: Math.round(points), perPoint: (net - tokens) / points, afterFurniture: (net - tokens - furniture) / points }];
    }),
);
const byFloor = [2, 3, 4].map((floor) => {
  const xs = hits.filter((h) => h.floor === floor).map((h) => h.balance);
  return { floor, n: xs.length, median: med(xs) };
});
console.log(JSON.stringify({ byFloor, k: med(members.map((r) => r.afterFurniture)), members, hits }, null, 2));
```

- [ ] **Step 3: 실행** — Run: `TYCOON_DB="$D/tycoon.db" pnpm exec tsx "$D/calibrate.ts" > "$D/calibrate.json" && head -40 "$D/calibrate.json"` → Expected: `byFloor` 세 줄(층마다 n·median), `k`(일 점수 1점당 순이익 — 세금·토큰·자동 구매 가구 뒤, 중앙값), `members` 목록.

- [ ] **Step 4: 값 정하기 (규칙)** — `r100 = (x) => Math.round(x / 100) * 100`.
  - `cost₂ = byFloor[2].n ≥ 3 ? r100(byFloor[2].median) : r100(75 × k)`
  - `cost₃ = byFloor[3].n ≥ 3 ? r100(byFloor[3].median − cost₂) : r100(150 × k)`
  - `cost₄ = byFloor[4].n ≥ 3 ? r100(byFloor[4].median − cost₂ − cost₃) : r100(225 × k)`
  - "높을수록 비싸다"(5.3): `cost₃ ≥ cost₂`, `cost₄ ≥ cost₃`가 아니면 앞 값으로 올린다. 모든 값은 100 이상 (`k`가 0 이하로 나오면 멈추고 보고 — 보통 팀원이 적자라는 뜻). 150·225 = 층 사이 점수 차이.
  - 세 값과 `byFloor`·`k`·쓴 식(실측/어림)을 컨트롤러 보고용으로 적어 둔다.

- [ ] **Step 5: 시뮬레이션 테스트 쓰기** — `workplace.test.ts` 끝에 추가 (기본 설정 `cfg` = 보정할 값):

```ts
describe('성장 시뮬레이션 (15장, 5.3 보정 확인)', () => {
  /** 팀원 셋이 도구 15번짜리 실행을 번갈아. 호출 1번당 토큰값(진주): 절약 6.1 · 보통 10.3 · 낭비 20 (06 문서 3.4 실측 분위수). 3바퀴마다 하루 */
  function simulate(rounds: number, level = 1) {
    const perCall: Record<string, number> = { 'qa-reviewer': 6.1, 'backend-dev': 10.3, 'frontend-dev': 20 };
    let s = initialState('p', cfg);
    s.level = level;
    s = project(s, roster, cfg);
    const reached: Record<string, number | null> = { 'qa-reviewer': null, 'backend-dev': null, 'frontend-dev': null };
    let sec = 10;
    let day = 0;
    for (let i = 1; i <= rounds; i++) {
      for (const who of Object.keys(perCall)) {
        for (const e of work(`${who}-${i}`, who, sec, 15, { tokens: Math.round((perCall[who] ?? 0) * 15 * 1000) }))
          s = project(s, e, cfg);
        sec += 5;
        if (reached[who] === null && (s.buildings[`w1:${who}`]?.floor ?? 0) >= 2) reached[who] = i;
      }
      if (i % 3 === 0) s = project(s, { t: 'GameDayTick', at: at(sec), day: ++day }, cfg);
    }
    return { s, reached };
  }

  test('30건(팀원당 10번): 보통 팀원은 게이지가 찬 뒤(5번째) 2번 안에 2층, 절약형은 그보다 늦지 않고, 낭비형은 더 늦거나 대기', () => {
    const { s, reached } = simulate(10);
    expect(reached['backend-dev']).not.toBeNull();
    expect(reached['backend-dev'] ?? 99).toBeLessThanOrEqual(7);
    expect(reached['qa-reviewer'] ?? 99).toBeLessThanOrEqual(reached['backend-dev'] ?? 99);
    expect(reached['frontend-dev'] === null || (reached['frontend-dev'] ?? 0) > (reached['backend-dev'] ?? 0)).toBe(true);
    expect(Object.keys(s.buildings).sort()).toEqual(['w1:backend-dev', 'w1:frontend-dev', 'w1:qa-reviewer']);
  });

  test('100건(팀원당 33번) · Lv.1: 모두 2층 이하에서 멈추고 점수는 쌓인다 (M14 전)', () => {
    const { s } = simulate(33);
    for (const b of Object.values(s.buildings)) expect(b.floor).toBeLessThanOrEqual(2);
    expect(s.buildings['w1:backend-dev']).toMatchObject({ floor: 2, points: 495, waiting: 'level' });
  });

  test('100건 · Lv.7 (M14 뒤 가늠): 절약형은 큰 건물을 지나 두 번째 일터, 보통 팀원은 3층 이상', () => {
    const { s } = simulate(33, 7);
    expect(s.buildings['w2:qa-reviewer']).toBeDefined();
    expect(s.buildings['w1:backend-dev']?.floor ?? 0).toBeGreaterThanOrEqual(3);
  });
});
```

- [ ] **Step 6: 어림값으로 한 번 돌리기** — Run: `pnpm vitest run packages/core/src/rules/workplace.test.ts -t 성장` → Expected: 결과를 적어 둔다 (어림값 700·1,400·2,100에서 통과할 수도, 실패할 수도 있다 — 보정 전 기준선).

- [ ] **Step 7: 보정값 넣기** — `game.default.json` `workplace.levels`의 `cost`를 Step 4의 세 값으로, `$levels` 끝의 "자재비는 M13 보정 전 어림"을 "자재비 = 2026-10-01 두 마을 DB 복사본 재생 보정 (06 문서 5.3)"으로. 06 문서 5.3 표 자재비 칸(2층·3층·큰 건물)을 같은 값으로 바꾸고, 표 아래 둘째 줄("보통 팀원은 게이지가 찰 즈음 …(작업당 순이익 약 90)…")의 괄호를 "(M13 보정 2026-10-01: 급여 26 기준 일 점수 1점당 순이익 약 `k`(세금·토큰·가구 자동 구매 뒤, 팀원 `members.length`명 중앙값), 게이지가 찬 순간 잔고 중앙값 2층 `byFloor[2].median`(n명) … )"로 — Step 3 출력의 숫자를 그대로 적고, 층마다 실측(n ≥ 3)인지 어림(k × 점수 차이)인지 밝힌다.

- [ ] **Step 8: 통과 확인** — Run: `pnpm vitest run packages/core` → Expected: PASS. **성장 시뮬레이션 세 테스트 중 하나라도 보정값에서 실패하면 기대값을 느슨하게 하거나 값을 몰래 고치지 말고 멈춰서**, `byFloor`·`k`·실패한 줄을 컨트롤러에게 보고한다 (06 5.3 의도 "보통은 게이지가 찰 즈음 모임, 낭비형은 대기"와 실측이 어긋난다는 뜻).

---

### Task 7: 웹 — 마을 장면 (일터·임시 그림·비계·게이지·이동)

**Files:**
- Modify: `packages/web/src/assets/sea/Building.tsx`, `packages/web/src/dev/Gallery.tsx`
- Modify: `packages/web/src/live/sceneFromState.ts` (+ `sceneFromState.test.ts`)
- Modify: `packages/web/src/live/movement.ts` (+ `movement.test.ts`)
- Modify: `packages/web/src/world/WorldUi.tsx`, `LiveVillage.tsx` (+ `LiveVillage.test.ts`), `constructionFx.ts` (+ `constructionFx.test.ts`)
- Modify: `packages/web/src/screens/TopBar.tsx`, `TeamPanel.tsx`, `screens.test.ts:61,84`, `packages/web/src/i18n.ts`, `i18n.test.ts:13`, `packages/web/src/dev/Ui.tsx:280`, `packages/web/src/live/LiveDemo.tsx`

**Interfaces:**
- Consumes: `Building`, `currentWorkplace`, `lotTiles`, `cfg.workplace.levels` (core).
- Produces:
  - `BuildingProps.scaffold?: boolean` — `stage === 'done'`일 때 몸통·지붕·간판 위에 `site.scaffold-1f|2f`.
  - `LiveScene = { map; off; buildings: (SceneBuilding & { id: string; floor?: number; badge?: string; foot?: 3 })[]; props; blocked; gauges: { building: number; pct: number; label: string }[]; founded }` (`sites` 없어짐).
  - `activeSite(s: VillageState): Building | undefined` — 일하는 팀원 중 실행을 가장 늦게 시작한 팀원의 지금 일터.
  - `workplaceName(s: VillageState, cfg: GameConfig, b: Building): string`.
  - `frontTiles(l: Lot, M = MAP, n = 2)`.
  - `workSite(s: VillageState, id: string, site = activeSite(s)): Building | undefined` (movement.ts, export).
  - WorldUi: `Gauge({ x, y, pct, label })`, `FloorBadge({ x, y, text })`.
- i18n (이 태스크): `world.gauge: '{name} 일 점수 {points} / {next}'`, `workplace.name: '{owner}의 {type}'`, `workplace.nameN: '{owner}의 {type} {n}'`, `workplace.floor: { 0: '공사 중', 1: '1층', 2: '2층', 3: '3층', 4: '큰 건물' }`, `topbar.progressText: '작업 {done} / {total} · 일터 {built}곳'`, `status.at.site: '일터'`.

- [ ] **Step 1: 실패하는 테스트 쓰기** — `sceneFromState.test.ts`:
  - import에 `slotTone`, `type AgentRun`, `type Building`(from `@tycoon/core`)을 더한다.
  - "골든 상태: 시설 북쪽, 집 서쪽, 공사 건물 1채는 기초"의 `const works = …`부터 끝(40~45줄)을 이걸로 바꾸고 제목을 "골든 상태: 시설 북쪽, 집 서쪽, 일한 팀원마다 일터 (qa-reviewer 1층 남, backend-dev 공사 현장 동)"로:

```ts
  const qa = sc.buildings.find((b) => b.id === 'work:w1:qa-reviewer');
  const be = sc.buildings.find((b) => b.id === 'work:w1:backend-dev');
  expect(qa).toMatchObject({ x: 10, y: 10, stage: 'done', floor: 1, slot: slotTone(s.members['qa-reviewer']?.slot ?? 0) });
  expect(qa?.owner).toMatchObject({ memberId: 'qa-reviewer', tag: 'qa-reviewer' });
  expect(be).toMatchObject({ x: 10, y: 3, floor: 0, owner: undefined });
  expect(['planned', 'foundation']).toContain(be?.stage);
  expect(sc.gauges).toEqual([]); // 게이지는 1층 이상 + 주인이 일하는 동안만
  expect(sc.props.some((p) => p.kind === 'materials')).toBe(be?.stage === 'foundation');
```
  - "건물이 들어오면 그 칸 장식만 치운다"의 68~71줄을 바꾼다: `const lot = { x: 13, y: 13, size: 3 as const };`, `s.buildings['w1:frontend-dev'] = { ...(s.buildings['w1:qa-reviewer'] as Building), id: 'w1:frontend-dev', memberId: 'frontend-dev', lot, startedAt: 9e12 };`, `const inLot = (p: { x: number; y: number }) => p.x >= 13 && p.x <= 15 && p.y >= 13 && p.y <= 15; // 3×3 예약 전부`.
  - "완공 건물은 주인 직업 프리셋을 바다 id로, 떠난 팀원 집은 흐리게"를 이걸로 바꾼다:

```ts
test('일터 종류 = 주인의 지금 직업 (바다 id), 떠난 팀원은 집·일터 모두 흐리게 (06 문서 5.6·5.9)', () => {
  const s = golden();
  const m = s.members['qa-reviewer'];
  if (!m) throw new Error('qa-reviewer');
  m.job = 'frontend';
  m.departed = true;
  const sc = sceneFromState(s, cfg);
  // frontend: plaster-1f / flat / cafe → shell-1f / conch
  expect(sc.buildings.find((x) => x.id === 'work:w1:qa-reviewer')).toMatchObject({
    body: 'shell-1f',
    roof: 'conch',
    sign: 'cafe',
    slot: slotTone(m.slot),
    stage: 'done',
    departed: true,
  });
  const gone = sc.buildings.find((x) => x.id === 'house:qa-reviewer');
  expect(gone?.departed).toBe(true);
  expect(gone?.ghost).toBeUndefined();
  expect(actorsFromState(s, cfg, s.clock.now).map((a) => a.id)).not.toContain('qa-reviewer');
});

test('층 모양: 2층부터 2층 몸통, 3층·큰 건물은 임시 배지, 큰 건물은 3×3 가운데·3×3 막힘, 주인이 일하면 비계·게이지·자재 더미', () => {
  const s = golden();
  const qa = s.buildings['w1:qa-reviewer'];
  if (!qa) throw new Error('w1:qa-reviewer');
  const look = (floor: number) => {
    qa.floor = floor;
    return sceneFromState(s, cfg).buildings.find((b) => b.id === 'work:w1:qa-reviewer');
  };
  expect(look(1)?.body.endsWith('1f')).toBe(true);
  expect(look(2)?.body.endsWith('2f')).toBe(true);
  expect(look(2)?.badge).toBeUndefined();
  expect(look(3)).toMatchObject({ badge: '3층', x: 10, y: 10 });
  expect(look(4)).toMatchObject({ badge: '큰 건물', x: 10.5, y: 10.5, foot: 3 });
  const big = sceneFromState(s, cfg);
  for (let y = 10; y < 13; y++) for (let x = 10; x < 13; x++) expect(big.blocked[y * big.map + x], `${x},${y}`).toBe(1);

  qa.floor = 2;
  qa.points = 100;
  const m = s.members['qa-reviewer'];
  const done = Object.values(s.runs).find((r) => r.memberId === 'qa-reviewer') as AgentRun;
  if (!m) throw new Error('qa-reviewer');
  s.runs.q9 = { ...done, runId: 'q9', endedAt: null };
  m.currentRunId = 'q9';
  const busy = sceneFromState(s, cfg);
  const i = busy.buildings.findIndex((b) => b.id === 'work:w1:qa-reviewer');
  expect(busy.buildings[i]).toMatchObject({ scaffold: true, stage: 'done' });
  expect(busy.gauges).toEqual([{ building: i, pct: 44, label: 'qa-reviewer의 초소 일 점수 100 / 225' }]);
  expect(busy.props).toContainEqual({ x: 12, y: 12, kind: 'materials' });
});
```
  - "캐릭터: 정본 id → 바다 id…"의 `// 공사 돕기 (짓는 중인 b2가 있다)` 주석 → `// 공사 돕기 (일하는 backend-dev의 일터)`.
  - "집 주인 표시…" 마지막 두 줄(215~217)을:

```ts
  // 시설은 지금 간판 그대로, 1층 이상 일터는 집과 같은 주인 표시 (M13)
  for (const b of sceneFromState(s, cfg).buildings.filter((b) => b.id.startsWith('facility:')))
    expect(b.owner).toBeUndefined();
  expect(sceneFromState(s, cfg).buildings.find((b) => b.id === 'work:w1:qa-reviewer')?.owner).toEqual(qa?.owner);
```
  - "마을 기금 광장 소품" 테스트의 `added` 기대 목록이 바뀌면(일터 3×3 예약 칸에 장식이 안 생겨 seed 장식이 달라짐) 새 목록으로 적고, 아래 루프(길·광장·부지 밖)가 통과하는지만 본다.

`movement.test.ts`:
  - "목적지: 작업 = 현장 앞 칸…" 71~72줄 → `// backend-dev: 막힘 → 자기 일터(동 10,3) 앞마당 첫 칸 (10,5), stay` + `expect(t.get('backend-dev')).toEqual({ x: 10.5, y: 5.5, stay: true });`, 78~86줄 → `// 일하러 가면 각자 자기 일터 앞 (06 문서 5장)` + `expect(t2.get('backend-dev')).toEqual({ x: 10.5, y: 5.5 });` + `expect(t2.get('qa-reviewer')).toEqual({ x: 10.5, y: 12.5 });`.
  - "외부인 = …" 128줄 → `expect(t.get('v3')).toEqual({ x: 11.5, y: 5.5 }); // 일하는 backend-dev의 일터 앞. backend-dev가 첫 칸 → 두 번째 칸`.
  - "A*: 부지를 피한다" 21줄 주석 "공사 현장 앞" → "qa-reviewer 일터 앞마당".

`LiveVillage.test.ts`:
  - import에 `type Building`(from `@tycoon/core`). `b2` 헬퍼를 지운다.
  - "공사 건물·집을 누르면 onBuildingClick…"의 101~105줄을:

```ts
  expect(ids.filter((id) => !id?.startsWith('house:'))).toEqual(['work:w1:qa-reviewer', 'work:w1:backend-dev']);
  const label = (id: string) => hits.find((b) => b.dataset.buildingHit === id)?.getAttribute('aria-label');
  expect(label('work:w1:qa-reviewer')).toBe('qa-reviewer의 초소 건물 보기');
  expect(label('work:w1:backend-dev')).toBe('backend-dev의 공방 공사 현장 보기');
  act(() => hits.find((b) => b.dataset.buildingHit === 'work:w1:backend-dev')?.click());
  expect(onBuildingClick).toHaveBeenCalledWith('work:w1:backend-dev');
```
  - "누르기 칸은 그림과 같은 앞뒤 순서" 본문(115~124줄)을:

```ts
  const z = (sel: string) => Number(div.querySelector<HTMLElement>(sel)?.style.zIndex || NaN);
  const sides = new Set<boolean>();
  for (const bid of ['w1:qa-reviewer', 'w1:backend-dev']) {
    const drawn = [...div.querySelectorAll(`svg [data-building="work:${bid}"], svg [data-walker]`)].map(
      (e) => e.getAttribute('data-walker') ?? 'b',
    );
    const hit = z(`[data-building-hit="work:${bid}"]`);
    const at = drawn.indexOf('b');
    for (const id of drawn.filter((x) => x !== 'b')) {
      sides.add(drawn.indexOf(id) > at);
      expect(z(`[data-walker-ui="${id}"]`) > hit, `${bid} ${id}`).toBe(drawn.indexOf(id) > at);
    }
  }
  expect([...sides].sort()).toEqual([false, true]); // 건물 뒤 캐릭터와 앞 캐릭터를 둘 다 봤다
```
  - "골조는 DOM 트윈으로 올라가고…"를 이걸로 바꾼다:

```ts
test('층이 오르면 거품이 잠깐, 새 일터 부지도 (처음 그린 장면은 조용히, 06 문서 5.4)', () => {
  const { div, root, render } = mount(golden());
  const pops = () => div.querySelectorAll('[data-layer="fx-site"] > g').length;
  expect(pops()).toBe(0);
  const s1 = golden();
  Object.assign(s1.buildings['w1:qa-reviewer'] ?? {}, { floor: 2, floorAt: 1 });
  render(s1);
  expect(pops()).toBe(1);
  run(15);
  expect(pops()).toBe(0);
  const s2 = structuredClone(s1);
  s2.buildings['w1:frontend-dev'] = {
    ...(s1.buildings['w1:qa-reviewer'] as Building),
    id: 'w1:frontend-dev',
    memberId: 'frontend-dev',
    lot: { x: 13, y: 13, size: 3 },
    floor: 0,
  };
  render(s2);
  expect(pops()).toBe(1);
  act(() => root.unmount());
});
```
  - "완공 반짝임(fx.complete)…"은 `Object.assign(b2(s), {…})` → `Object.assign(s.buildings['w1:qa-reviewer'] ?? {}, { floorAt: T })`, 선택자 `work:b2` → `work:w1:qa-reviewer`, 제목 "층이 오른 반짝임(fx.complete)은 floorAt부터 completeFxMs(3초) 동안만".
  - "집 간판 = …" 188줄 → `expect(tags.sort()).toEqual(['backend-dev', 'frontend-dev', 'qa-reviewer', 'qa-reviewer', '팀장의 집']); // 집 넷 + 1층 일터 (qa-reviewer)`.

`constructionFx.test.ts`: `revealAt`·`nextReveal`·`REVEAL_MS` 테스트를 지운다 (`completeFxOn`·`stageUp`·`popBubbles` 테스트는 그대로).
`screens.test.ts`: 61줄 → `toContain('backend-dev의 공방 공사 중')`, 84줄 → `toBe('작업 중 · 일터')`, 80줄 주석 "작업 중 · 공사 현장" → "작업 중 · 일터".
`i18n.test.ts:13` → `toBe('작업 12 / 20 · 일터 3곳')`.

- [ ] **Step 2: 실패 확인** — Run: `pnpm vitest run packages/web/src/live packages/web/src/world packages/web/src/screens/screens.test.ts packages/web/src/i18n.test.ts` → Expected: FAIL (`work:w1:…` 장면 건물 없음, `gauges` undefined).

- [ ] **Step 3: 에셋 비계** — `Building.tsx`: props에 `scaffold?: boolean; // 완공 몸통 위 비계 — 주인이 일하는 동안 다음 층 공사 (06 문서 5.9)`, `stage === 'done'` 블록의 간판 줄 뒤에 `{scaffold && <AssetLayer id={`site.scaffold-${two ? 2 : 1}f`} params={p} />}`. `Gallery.tsx`의 완공 줄(120줄 근처)에 `<Building body="basalt-2f" roof="dome" sign="guard" slot={3} scaffold />` 한 칸을 더한다.

- [ ] **Step 4: 장면** — `sceneFromState.ts`:
  - import에 `currentWorkplace`, `lotTiles`, `type Building as Workplace`를 더하고 `type Building as BuildingState`를 지운다. `import type { Stage } from '../assets/sea/Building';`. 로컬 `lotTiles`를 지운다.
  - `LiveScene`:

```ts
export interface LiveScene {
  map: number;
  off: number;
  /** 장면 건물. 일터(`work:<일터 id>`)는 floor(0~4)·badge(임시 층 배지 글자)·foot 3(큰 건물: x·y = 3×3 가운데 − 1) */
  buildings: (SceneBuilding & { id: string; floor?: number; badge?: string; foot?: 3 })[];
  props: SceneProp[];
  blocked: Uint8Array;
  /** 일터 게이지 (06 문서 5.2): 1층 이상 + 주인이 일하는 중. building = buildings 인덱스, pct = 일 점수 ÷ 다음 층 점수 */
  gauges: { building: number; pct: number; label: string }[];
  founded: boolean;
}
```
  - `frontTiles`에 셋째 인자 `n = 2`를 두고 목록을 `[l.x, l.y + n], [l.x + 1, l.y + n], [l.x + n, l.y + 1], [l.x + n, l.y], [l.x - 1, l.y + 1], [l.x - 1, l.y], [l.x, l.y - 1], [l.x + 1, l.y - 1]`로.
  - `activeSite`·`workLook`을 바꾸고 `workplaceName`을 더한다:

```ts
/** 공사 돕는 외부인·일하는 팀장이 갈 곳 (06 문서 5.7·5.9): 일하는 팀원 중 실행을 가장 늦게 시작한 팀원의 지금 일터 */
export function activeSite(s: VillageState): Workplace | undefined {
  let best: { at: number; b: Workplace } | undefined;
  for (const m of Object.values(s.members)) {
    const r = m.currentRunId ? s.runs[m.currentRunId] : undefined;
    const b = r ? currentWorkplace(s, m.id) : undefined;
    if (r && b && (!best || r.startedAt > best.at)) best = { at: r.startedAt, b };
  }
  return best?.b;
}

/** 일터 이름 (06 문서 5.6): 사용자가 지은 이름, 없으면 "<팀원>의 <종류>", 두 번째부터 뒤에 번호. 종류 = 주인의 지금 직업 */
export function workplaceName(s: VillageState, cfg: GameConfig, b: Workplace): string {
  if (b.name) return b.name;
  const m = s.members[b.memberId];
  const p = cfg.jobPresets.find((x) => x.id === m?.job) ?? cfg.fallbackPreset;
  const vars = { owner: m?.name ?? b.memberId, type: t(`buildings.${p.building}`), n: b.n };
  return t(b.n > 1 ? 'workplace.nameN' : 'workplace.name', vars);
}

/** 일터 모양 (06 문서 5.3·14장): 2층부터 2층 몸통, 3층·큰 건물은 임시 배지, 주인이 일하면 비계, 1층부터 얼굴 간판·이름표 */
function workLook(b: Workplace, s: VillageState, cfg: GameConfig) {
  const m = s.members[b.memberId];
  const preset = cfg.jobPresets.find((p) => p.id === m?.job) ?? cfg.fallbackPreset;
  const working = !!m?.currentRunId;
  const big = b.floor >= cfg.workplace.levels.length;
  // 첫 일: 도구를 쓰기 전엔 예정 부지, 쓰면 기초 (5.1). 그 뒤는 완공 그림
  const first = (s.runs[m?.currentRunId ?? '']?.toolCalls ?? 0) > 0 ? 'foundation' : 'planned';
  const stage: Stage = b.floor > 0 ? 'done' : first;
  return {
    body: seaId('body', b.floor >= 2 ? preset.body2f : preset.body1f),
    roof: seaId('roof', preset.roof),
    sign: preset.sign,
    slot: m ? slotTone(m.slot) : ('x' as const),
    stage,
    scaffold: working && b.floor > 0 && !big ? true : undefined,
    departed: m?.departed ? true : undefined,
    owner: m && b.floor > 0 ? ownerOf(m, m.name) : undefined,
    badge: b.floor >= 3 ? t(`workplace.floor.${Math.min(b.floor, 4)}`) : undefined,
  };
}
```
  - 본문의 `const sites …`부터 작업 건물 루프(178~187줄)를:

```ts
  const gauges: LiveScene['gauges'] = [];
  const works = Object.values(s.buildings).sort((a, b) => a.startedAt - b.startedAt || (a.id < b.id ? -1 : 1));
  for (const b of works) {
    const big = b.floor >= cfg.workplace.levels.length;
    const p = sh(b.lot);
    // 큰 건물은 3×3 가운데 (x + 0.5): 그리기·누르기·간판·거품이 모두 (x + 1, y + 1)을 가운데로 쓴다
    const place = big ? { x: p.x + 0.5, y: p.y + 0.5, foot: 3 as const } : p;
    buildings.push({ id: `work:${b.id}`, ...place, floor: b.floor, ...workLook(b, s, cfg) });
    const next = cfg.workplace.levels[b.floor];
    if (b.floor > 0 && next && s.members[b.memberId]?.currentRunId)
      gauges.push({
        building: buildings.length - 1,
        pct: Math.min(100, Math.round((b.points / next.points) * 100)),
        label: t('world.gauge', { name: workplaceName(s, cfg, b), points: Math.round(b.points), next: next.points }),
      });
  }
```
  - 막힘 루프(194~197줄)를:

```ts
  for (const b of buildings) {
    // 큰 건물은 3×3, 나머지 2×2 (x·y가 가운데 − 1이라 0.5를 되돌림)
    const lot = b.foot ? { x: b.x - 0.5, y: b.y - 0.5, size: 3 as const } : { x: b.x, y: b.y };
    for (const [x, y] of lotTiles(lot)) mark(blocked, x, y);
    for (const [x, y] of frontTiles(lot, M, b.foot ?? 2).slice(0, 2)) mark(taken, x, y); // 문 앞·작업 자리는 비워 둔다
  }
  // 일터 3×3 예약 (06 문서 5.1): 앞마당엔 장식을 두지 않는다 (걸을 수는 있다)
  for (const w of works) for (const [x, y] of lotTiles({ ...sh(w.lot), size: 3 })) mark(taken, x, y);
```
  - 자재 더미 루프(220~226줄)를:

```ts
  // 주인이 일하는 일터 앞마당의 자재 더미 (캔버스 바다 09): 3×3 부지 앞 오른쪽 칸 (자기 부지라 늘 비어 있다). 예정 부지·큰 건물은 없음
  for (const b of buildings)
    if (b.id.startsWith('work:') && !b.foot && (b.scaffold || b.stage === 'foundation'))
      props.push({ x: b.x + 2, y: b.y + 2, kind: 'materials' });
```
  - 반환을 `return { map: M, off, buildings, props, blocked, gauges, founded };`로.

- [ ] **Step 5: 이동** — `movement.ts`: import에 `currentWorkplace`. `near`에 `n = 2` 인자를 두고 `frontTiles({ x: lot.x + off, y: lot.y + off }, M, n)`. 작업 갈래를:

```ts
    } else if (a.status === 'working' || a.status === 'blocked') {
      const b = workSite(s, a.id, site);
      const foot = scene.buildings.find((x) => x.id === `work:${b?.id ?? ''}`)?.foot ?? 2;
      t = b ? near(b.lot, b.id, foot) : null;
```
  `workSite`를 바꿔 export:

```ts
/** 일하는 곳 (06 문서 5장·5.9): 자기 일터, 일터가 없는 팀장·외부인은 지금 일하는 팀원의 일터 */
export const workSite = (s: VillageState, id: string, site = activeSite(s)) => currentWorkplace(s, id) ?? site;
```
  `memberViews`의 `workSite(s, a.taskId)` → `workSite(s, a.id)`. 213줄 주석 "작업 중 · 공사 현장" → "작업 중 · 일터".

- [ ] **Step 6: 월드 UI** — `WorldUi.tsx`: `Progress`의 첫 `<div aria-hidden>…망치 svg…</div>`를 `function Hammer({ x, y }: { x: number; y: number })`로 빼서 `Progress`가 `<Hammer x={x} y={y} />`로 쓰고, 추가:

```tsx
/** 일터 게이지 (06 문서 5.2): 망치 원 + 알약 막대. 채움 --coin = 일 점수 ÷ 다음 층 점수 */
export function Gauge({ x, y, pct, label }: { x: number; y: number; pct: number; label: string }) {
  return (
    <>
      <Hammer x={x} y={y} />
      <div
        role="img"
        aria-label={label}
        data-gauge=""
        style={{ ...box, borderWidth: 2, borderRadius: 999, left: x - 49, top: y - 70, width: 72, height: 14, overflow: 'hidden' }}
      >
        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--coin)' }} />
      </div>
    </>
  );
}

/** 임시 층 배지 (06 문서 14장): 3층·큰 건물. 지붕 오른쪽 위. M15 새 그림이 나오면 뺀다 */
export function FloorBadge({ x, y, text }: { x: number; y: number; text: string }) {
  return (
    <span
      data-floor-badge=""
      style={{
        ...box,
        left: x + 30,
        top: y - 196,
        padding: '0 var(--sp-2)',
        borderWidth: 2,
        borderRadius: 'var(--r-pill)',
        background: 'var(--coin)',
        color: 'var(--text)',
        fontFamily: 'var(--font-display)',
        fontSize: 'var(--fs-min)',
        lineHeight: 'var(--lh-min)',
        pointerEvents: 'none',
      }}
    >
      {text}
    </span>
  );
}
```
  맨 위 주석에 "일터 게이지·층 배지"를 더한다. 위치(`top: y − 196`)는 Task 9 스크린샷에서 2층 지붕 오른쪽 위에 오는지 보고 필요하면 이 한 값만 고친다.

- [ ] **Step 7: 실시간 마을** — `LiveVillage.tsx`:
  - import: `frameClipY` 빼기, `nextReveal`·`revealAt`·`type Reveal` 빼기, `Progress` 대신 `FloorBadge, Gauge`, `workplaceName` 더하기.
  - `reveals`·`drawnY`·`drawReveals`와 그 호출(rAF의 `drawReveals(tm)`, layout effect의 `drawnY.current.clear(); drawReveals(now);`)을 지운다. `const floors = useRef(new Map<string, number>());`를 둔다.
  - layout effect의 건물 루프를:

```ts
    for (const b of scene.buildings) {
      const fresh = !built.current.has(b.id);
      built.current.add(b.id);
      const stage = b.stage ?? 'done';
      const floor = b.floor ?? 0;
      // 새로 생긴 집·시설·일터 부지, 예정 → 기초, 층이 오른 일터 → 거품 (처음 그린 장면은 조용히, 01 문서 3.3·06 문서 5.4)
      const up = stageUp(stages.current.get(b.id), stage) || floor > (floors.current.get(b.id) ?? floor);
      if (painted.current && (fresh || up)) pop(b);
      stages.current.set(b.id, stage);
      floors.current.set(b.id, floor);
    }
    painted.current = true;
```
  - rAF의 반짝임: `.filter((b) => completeFxOn(b.floorAt ?? undefined, now, c.buildings.completeFxMs))`.
  - `BuildingHits`에 `cfg: GameConfig` prop을 더해 `<BuildingHits scene={scene} state={state} cfg={cfg} M={M} onClick={onBuildingClick} />`로 넘기고 `label`의 일터 이름을:

```ts
    const key = id.slice(WORK.length);
    const b = Object.hasOwn(state.buildings, key) ? state.buildings[key] : undefined;
    const name = b ? workplaceName(state, cfg, b) : t('world.unnamed');
    return t(stage === 'done' ? 'world.building' : 'world.construction', { name });
```
  - `Sites`를 지우고:

```tsx
/** 일터 게이지 (06 문서 5.2): 주인이 일하는 동안 */
function Gauges({ scene, M }: { scene: LiveScene; M: number }) {
  return scene.gauges.map((g) => {
    const b = scene.buildings[g.building];
    if (!b) return null;
    const p = iso(b.x + 1, b.y + 1, M);
    return <Gauge key={b.id} x={p.sx} y={p.sy} pct={g.pct} label={g.label} />;
  });
}

/** 임시 층 배지 (06 문서 14장) — 그림 몫이라 labels와 상관없이 늘 */
function Badges({ scene, M }: { scene: LiveScene; M: number }) {
  return scene.buildings.map((b) => {
    if (!b.badge) return null;
    const p = iso(b.x + 1, b.y + 1, M);
    return <FloorBadge key={b.id} x={p.sx} y={p.sy} text={b.badge} />;
  });
}
```
  렌더의 `{labels && <Sites scene={scene} M={M} />}` → `{labels && <Gauges scene={scene} M={M} />}` + `<Badges scene={scene} M={M} />`. 파일 맨 위·`onBuildingClick` 주석의 "공사 건물" → "일터".
  - `constructionFx.ts`: `REVEAL_MS`·`Reveal`·`ease`·`revealAt`·`nextReveal`를 지우고 맨 위 주석을 "공사 연출: 반짝임 창, 단계·층이 바뀔 때 거품"으로.

- [ ] **Step 8: 상단 바·팀원 패널·글자·데모**
  - `TopBar.tsx` `villageProgress`: `built: Object.values(s.buildings).filter((b) => b.floor > 0).length,`.
  - `TeamPanel.tsx` `taskLine` 29~31줄을:

```ts
  const b = currentWorkplace(s, m.id);
  const floor = b && t(`workplace.floor.${Math.min(b.floor, 4)}`);
  return { text: task.subject, where: b && `${workplaceName(s, defaultConfig, b)} ${floor}` };
```
  (import `currentWorkplace` from `@tycoon/core`, `workplaceName` from `../live/sceneFromState`; 18줄 주석 "건물 진행" → "자기 일터·층").
  - `i18n.ts`: `status.at.site: '일터'`, `world`에 `gauge: '{name} 일 점수 {points} / {next}',`, `topbar.progressText: '작업 {done} / {total} · 일터 {built}곳'`, `building` 앞에 새 묶음:

```ts
  // 팀원 일터 (06 문서 5장). 종류 이름은 위 buildings.* (주인의 지금 직업)
  workplace: {
    name: '{owner}의 {type}',
    nameN: '{owner}의 {type} {n}',
    floor: { 0: '공사 중', 1: '1층', 2: '2층', 3: '3층', 4: '큰 건물' },
  },
```
  - `dev/Ui.tsx:280` 글자 → `작업 12 / 20 · 일터 3곳`.
  - `LiveDemo.tsx`: `STAGES`·작업 만들기 블록(`bIds`·`s.tasks`·`s.buildings[id] = …`)을 지우고 `stressState`에서 섬을 한 단계 넓혀 일터를 둔다 (집 루프는 그대로, 팀원 `currentTaskId`는 `null`):

```ts
  s.ring = 1; // 일터 3×3이 여럿 들어가게 (남·동 8곳)
  s.level = 7; // 3층·큰 건물 임시 그림도 보이게
  const taken: Lot[] = Object.values(s.facilities);
  const lot = (z: Zone, size: 2 | 3 = 2) => {
    const l = findLot(z, taken, s.ring, size);
    if (l) taken.push(l);
    return l;
  };
```
  팀원 루프 뒤에:

```ts
  // 일터: 팀원 순서대로 남 → 동, 층은 0~4를 돌며 (06 문서 5장)
  for (let i = 1; i < members; i++) {
    const l = lot('south', 3) ?? lot('east', 3);
    if (!l) break;
    const id = `w1:m${i}`;
    s.buildings[id] = { id, memberId: `m${i}`, n: 1, name: '', lot: l, floor: i % 5, points: (i % 5) * 120, paid: 0, waiting: null, startedAt: i, floorAt: null };
  }
```
  `buildState(step, at)`를 일터 층 올리기로 (m3 = 일하는 팀원):

```ts
/** build 데모: stress 마을(팀원 4명)의 m3 일터가 예정 부지 → 기초 → 1층 → 2층 → 3층 → 큰 건물 (06 문서 5장) */
export function buildState(step: number, at: number): VillageState {
  const s = stressState(0, 4);
  const b = s.buildings['w1:m3'];
  const m = s.members.m3;
  const r = s.runs[m?.currentRunId ?? ''];
  if (!b || !m || !r) return s;
  const floor = Math.min(4, Math.max(0, step - 1));
  Object.assign(b, { floor, points: floor * 120, floorAt: floor > 0 ? at : null });
  r.toolCalls = step === 0 ? 0 : 5;
  if (floor > 0) m.cheerUntil = at + cfg.buildings.cheerMs;
  s.seq = step;
  return s;
}
```
  `LiveDemo`의 build 타이머 조건 `s.seq < 6` → `s.seq < 5`, 파일 맨 위 주석 build 설명 → "일터 하나가 1.5초마다 예정 부지 → 기초 → 1층 → … → 큰 건물".

- [ ] **Step 9: 통과 확인** — Run: `pnpm vitest run packages/web/src/live packages/web/src/world packages/web/src/screens/screens.test.ts packages/web/src/i18n.test.ts` → Expected: PASS. (`BuildingScreen`·`GridScreen`은 Task 8 — 그 두 테스트는 아직 빨강)

---

### Task 8: 웹 — 일터 상세 + 격자 일터 카드

**Files:**
- Modify: `packages/web/src/screens/building/BuildingScreen.tsx` (다시 씀), `building.css`, `BuildingScreen.test.ts` (다시 씀)
- Modify: `packages/web/src/screens/grid/GridScreen.tsx`, `grid.css`, `GridScreen.test.ts`
- Modify: `packages/web/src/screens/LiveApp.test.ts:177-238`, `packages/web/src/i18n.ts`

**Interfaces:**
- Consumes: `workplaceName`, `activeSite`(간접), `workSite`, `runPoints`, `VillageProgress`, `Chip`, `NameRow`(그대로), `renameBuilding`(그대로).
- Produces: `BuildingScreen(props: BuildingScreenProps)` (props 그대로), `FloorSteps({ floor }: { floor: number })`, `workplaceRuns(s: VillageState, b: Building): AgentRun[]` (새 것부터), `look(cfg: GameConfig, presetId: string | undefined, floor: number)`. `Stepper`·`contribution`·`assignees`·`Predict` 지움.
- i18n (이 태스크): `workplace`에 `floors: '일터 층'`, `started: '부지 {at} · ({x}, {y}) 3×3'`, `owner: '{type} · 주인'`, `gaugeLabel: '다음 층까지 일 점수'`, `gauge: '일 점수 {points} / {next}'`, `gaugeMax: '일 점수 {points} · 다 컸어요'`, `firstWork: '첫 일이 끝나면 1층이 올라가요'`, `next: '다음 층 조건'`, `cond: { points: '일 점수', cost: '자재비', level: '마을 레벨' }`, `lv: 'Lv.{n}'`, `waiting: { materials: '자재비 대기', level: 'Lv.{n} 필요' }`, `runs: '최근 일'`, `runsHint: '서브에이전트 실행 하나 = 도구 호출 × 품질만큼 점수'`, `noRuns: '아직 끝난 일이 없어요'`, `noTask: '{type} 실행'`, `plus: '+{n}점'`, `contrib: '쌓은 일'`, `contribText: '실행 {runs}번 · 일 점수 {points} · 자재비 {paid}'`. `grid.works: '팀원 일터'`, `grid.worksMeta: '{n}곳 · 공사 중 {site} · 대기 {waiting}'`, `grid.noWorks: '아직 일터가 없어요. 팀원이 처음 일하면 부지가 생겨요'`, `grid.gauge: '{points} / {next}'`, `grid.gaugeMax: '다 컸어요'`. 지우는 키: `building.{underway, steps, stage, stepsHint, started, completed, ownedBy, size, progress, tasks, tasksHint, task, unassigned, doing, contrib, contribNote, noContrib, predict, predictWho, predictNone}`, `grid.{underway, done, progress, progressLabel, contributors, more}`.

- [ ] **Step 1: 실패하는 테스트 쓰기** — `BuildingScreen.test.ts`에서 "공사 스텝…", "골든 상태 건물…", "외부인도 막대에…", `doneVillage`·"완공 건물…"·"완공 반짝임…"을 지우고 (import의 `Stepper`·`replay`·`DomainEvent`도), 이걸 넣는다 (import `FloorSteps`):

```ts
const open = (s: VillageState, id: string) =>
  render(h(BuildingScreen, { state: s, cfg, projectId: 'p', buildingId: id, onBack: () => {} }));

test('층 스텝: 1층·2층·3층·큰 건물, 지금 층이 현재 칸, 공사 중(0층)이면 현재 칸 없음', () => {
  [0, 1, 2, 3, 4].forEach((floor) => {
    const r = render(h(FloorSteps, { floor }));
    const cur = r.div.querySelectorAll('[aria-current="step"]');
    expect(cur).toHaveLength(floor === 0 ? 0 : 1);
    if (floor) expect(cur[0]?.textContent).toContain(['1층', '2층', '3층', '큰 건물'][floor - 1]);
    expect(r.div.querySelectorAll('.bd-step--done')).toHaveLength(Math.max(0, floor - 1));
    r.unmount();
  });
});

test('골든 qa-reviewer 1층 일터: 기본 이름·주인·게이지·다음 층 조건·최근 일·쌓은 일', () => {
  const s = golden();
  const r = open(s, 'w1:qa-reviewer');
  expect(r.div.querySelector('h1')?.textContent).toBe('qa-reviewer의 초소');
  expect(r.div.querySelector('.ui-chip--status')?.textContent).toBe('1층');
  expect(r.div.querySelector('.bd-owner')?.textContent).toBe('초소 · 주인qa-reviewer');
  expect(r.div.querySelector('[aria-current="step"]')?.textContent).toContain('1층');
  expect(r.div.querySelector('.bd-count')?.textContent).toBe('일 점수 4 / 75'); // 도구 3번 × 테스트 통과 1.2 = 3.6
  expect([...r.div.querySelectorAll('.bd-cond')].map((e) => [e.getAttribute('data-cond'), e.getAttribute('data-ok')])).toEqual([
    ['points', 'false'],
    ['cost', 'false'],
    ['level', 'true'],
  ]);
  expect(r.div.querySelector('[data-waiting]')).toBeNull();
  expect(r.div.querySelectorAll('.bd-task')).toHaveLength(1);
  expect(r.div.querySelector('.bd-task__subject')?.textContent).toBe('로그인 폼 입력 검증');
  expect(r.div.querySelector('[data-contrib]')?.textContent).toBe('실행 1번 · 일 점수 4 · 자재비 0');
  expect(r.div.querySelectorAll('[data-actor]')).toHaveLength(0); // 주인은 쉬는 중
  r.unmount();
});

test('공사 중(0층) 일터: 첫 일 안내, 주인이 현장에 (막힌 backend-dev), 기초 + 자재', () => {
  const r = open(golden(), 'w1:backend-dev');
  expect(r.div.querySelector('h1')?.textContent).toBe('backend-dev의 공방');
  expect(r.div.querySelector('.ui-chip--status')?.textContent).toBe('공사 중');
  expect(r.div.querySelector('[aria-current="step"]')).toBeNull();
  expect(r.div.textContent).toContain('첫 일이 끝나면 1층이 올라가요');
  expect([...r.div.querySelectorAll('[data-actor]')].map((e) => e.getAttribute('data-actor'))).toEqual(['backend-dev']);
  expect(r.div.querySelector('[data-floor="0"] [data-asset-id="site.foundation"]')).not.toBeNull();
  r.unmount();
});

test('대기 칩: 레벨 모자람 "Lv.4 필요"(조건 레벨 ✗), 자재비 모자람 "자재비 대기"', () => {
  const s = golden();
  Object.assign(s.buildings['w1:qa-reviewer'] ?? {}, { floor: 2, points: 300, waiting: 'level' });
  const r = open(s, 'w1:qa-reviewer');
  expect(r.div.querySelector('[data-waiting="level"]')?.textContent).toBe('Lv.4 필요');
  expect(r.div.querySelector('.bd-cond[data-cond="level"]')?.getAttribute('data-ok')).toBe('false');
  expect(r.div.querySelector('.bd-count')?.textContent).toBe('일 점수 300 / 225');
  r.unmount();
  Object.assign(s.buildings['w1:qa-reviewer'] ?? {}, { floor: 1, points: 80, waiting: 'materials' });
  const m = open(s, 'w1:qa-reviewer');
  expect(m.div.querySelector('[data-waiting="materials"]')?.textContent).toBe('자재비 대기');
  m.unmount();
});

test('층이 오른 반짝임은 floorAt부터 정확히 completeFxMs — 1초 시계를 기다리지 않는다', () => {
  const s = golden();
  const w = s.buildings['w1:qa-reviewer'];
  if (!w) throw new Error('w1:qa-reviewer');
  vi.useRealTimers();
  vi.useFakeTimers();
  vi.setSystemTime((w.floorAt ?? 0) + 500);
  const r = open(s, 'w1:qa-reviewer');
  const fx = () => !!r.div.querySelector('[data-floor="1"] [data-asset-id="fx.complete"]');
  expect(fx()).toBe(true);
  act(() => vi.advanceTimersByTime(cfg.buildings.completeFxMs - 500 - 10));
  expect(fx()).toBe(true);
  act(() => vi.advanceTimersByTime(70));
  expect(fx()).toBe(false);
  r.unmount();
});
```
  "없는 건물·프로토타입 키…"의 id 목록에 옛 작업 건물 id `'b2'`를 더하고 `toHaveBeenCalledTimes(5)`. "이름 바꾸기…"는 `buildingId: 'w1:qa-reviewer'`, 첫 값 기대 `'qa-reviewer의 초소'`, 마지막 주소 `'/api/projects/p%2F1/buildings/w1%3Aqa-reviewer/name'`.

`GridScreen.test.ts`: `work` 헬퍼·`state()`의 `b1`·`b2`·`b3`·`b4` 조작을 지우고:

```ts
const wp = (b: Partial<Building> & Pick<Building, 'id' | 'memberId' | 'floor'>): Building => ({
  n: 1,
  name: '',
  lot: { x: 13, y: 13, size: 3 },
  points: 0,
  paid: 0,
  waiting: null,
  startedAt: 0,
  floorAt: null,
  ...b,
});
```
  `state()`에서 `s.buildings['w1:frontend-dev'] = wp({ id: 'w1:frontend-dev', memberId: 'frontend-dev', floor: 2, points: 300, waiting: 'level', name: '결제 카페' });` (qa-reviewer 떠남·backend-dev 가구 줄은 그대로). 첫 테스트의 `['팀원 집', '작업 건물']` → `['팀원 집', '팀원 일터']`. "작업 건물: …" 테스트를 이걸로:

```ts
test('팀원 일터: 곳 수·공사 중·대기, 1층 이상은 카드(부지 잡은 순)·층·게이지·대기, 공사 중은 점선 칩', () => {
  const div = render(state());
  expect(div.querySelectorAll('.gs__head .gs-meta')[1]?.textContent).toBe('3곳 · 공사 중 1 · 대기 1');
  const cards = [...div.querySelectorAll('a.gs-card[data-building]')] as HTMLAnchorElement[];
  expect(cards.map((c) => c.dataset.building)).toEqual(['w1:frontend-dev', 'w1:qa-reviewer']);
  const [fe, qa] = cards;
  expect(fe?.querySelector('.gs-card__name')?.textContent).toBe('결제 카페');
  expect(fe?.querySelector('.ui-chip--job')?.textContent).toBe('카페');
  expect(fe?.querySelector('.gs-end')?.textContent).toBe('2층');
  expect(fe?.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('100');
  expect(fe?.querySelector('[data-waiting]')?.textContent).toBe('Lv.4 필요');
  expect(qa?.querySelector('.gs-card__name')?.textContent).toBe('qa-reviewer의 초소');
  expect(qa?.style.opacity).toBe('0.55'); // 떠난 팀원
  expect(texts(div, 'a.gs-chip')).toEqual(['공사 중 · backend-dev의 공방']);
});
```
  링크 테스트의 `a.gs-chip[data-building="b3"]` → `a.gs-chip[data-building="w1:backend-dev"]`, 주소 `'/?project=p&building=w1:backend-dev'`, onOpen `{ screen: 'building', id: 'w1:backend-dev' }`. 빈 마을 기대 둘째 줄 → `'아직 일터가 없어요. 팀원이 처음 일하면 부지가 생겨요'`.

`LiveApp.test.ts`: `'work:b2'` → `'work:w1:qa-reviewer'`, `'?project=alpha&building=b2'` → `'?project=alpha&building=w1%3Aqa-reviewer'` (5곳), `'로그인 폼'` → `'qa-reviewer의 초소'` (3곳), `beta.buildings.b2` → `beta.buildings['w1:qa-reviewer']`, 테스트 제목의 "건물 상세 (M6)" → "일터 상세 (M13)", "(건물 id는 마을마다 b1부터)" → "(일터 id는 팀원 기준이라 마을마다 겹친다)".

- [ ] **Step 2: 실패 확인** — Run: `pnpm vitest run packages/web/src/screens` → Expected: FAIL (`FloorSteps` 없음, `h1` 텍스트 불일치).

- [ ] **Step 3: 일터 상세** — `BuildingScreen.tsx`를 다시 쓴다. 남기는 것: `S`, `SPOTS`, `at`, `seaOf`, `dur`, `when`, `useNow`, `Face`, `Who`, `NameRow`, `BuildingScreenProps`, 장면의 빛줄기·경로(`bd-crumb`)·모래 판 svg. 지우는 것: `STAGES`, `assignees`, `contribution`, `Stepper`, `ST_ICON`, `Predict`, `predictOwner`·`LEADER_ID`·`Task` import. 새 코드:

```tsx
// 일터 상세 (06 문서 13장, 01 문서 8.5): 상단 바 아래 일터 장면 820 + 정보 패널 620 — 층·게이지·다음 층 조건(점수·자재비·레벨)·최근 일·쌓은 일, 이름 바꾸기
import {
  cleanBuildingName,
  runPoints,
  slotTone,
  type AgentRun,
  type Building as Workplace,
  type GameConfig,
  type VillageState,
} from '@tycoon/core';
import { poseFor, workSite } from '../../live/movement';
import { actorsFromState, toAccessory, toSpecies, workplaceName } from '../../live/sceneFromState';
import { Button, Chip, VillageProgress } from '../../ui';
// (나머지 import는 지금과 같다: react, sea, Prop, Building, t, Icon, Critter, Role, completeFxOn, renameBuilding, './building.css')

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR');
const FLOORS = [1, 2, 3, 4] as const;

/** 프리셋 → 바다 건물 모양 + 종류 이름. 마을(sceneFromState workLook)과 같은 규칙: 2층부터 2층 몸통 */
export function look(cfg: GameConfig, presetId: string | undefined, floor: number) {
  const p = cfg.jobPresets.find((x) => x.id === presetId) ?? cfg.fallbackPreset;
  const body = floor >= 2 ? p.body2f : p.body1f;
  return { body: seaOf('body', body), roof: seaOf('roof', p.roof), sign: p.sign, type: t(`buildings.${p.building}`) };
}

/** 이 일터에 쌓인 끝난 실행 (새 것부터): 주인의 실행 중 부지를 잡은 뒤 ~ 다음 일터를 잡기 전에 끝난 것 */
export function workplaceRuns(s: VillageState, b: Workplace): AgentRun[] {
  const next = Object.values(s.buildings).find((x) => x.memberId === b.memberId && x.n === b.n + 1);
  return Object.values(s.runs)
    .filter(
      (r) =>
        r.memberId === b.memberId &&
        r.endedAt !== null &&
        r.endedAt >= b.startedAt &&
        (!next || r.endedAt < next.startedAt),
    )
    .sort((x, y) => (y.endedAt ?? 0) - (x.endedAt ?? 0));
}

/** 실행의 작업 제목: 짝지어진 작업(Agent 호출 대체), 없으면 그 실행이 기여한 작업(01 문서 5.3 기여), 없으면 undefined */
function runTitle(s: VillageState, r: AgentRun): string | undefined {
  const own = r.taskId ? s.tasks[r.taskId] : undefined;
  const mid = r.memberId;
  const k =
    own ??
    Object.values(s.tasks).find(
      (x) =>
        mid !== null &&
        (x.contributions[mid] ?? 0) > 0 &&
        (x.startedAt ?? x.createdAt) <= (r.endedAt ?? Infinity) &&
        (x.completedAt ?? Infinity) >= r.startedAt,
    );
  return k?.subject;
}

/** 층 스텝 (03 문서 5장 스텝 모양): 1층·2층·3층·큰 건물. 지난 층은 체크, 공사 중(0)이면 현재 칸 없음 */
export function FloorSteps({ floor }: { floor: number }) {
  return (
    <ol className="bd-steps" aria-label={t('workplace.floors')}>
      {FLOORS.map((f) => (
        <li
          key={f}
          className={`bd-step bd-step--${f < floor ? 'done' : f === floor ? 'cur' : 'todo'}`}
          aria-current={f === floor ? 'step' : undefined}
        >
          <span className="bd-step__dot">{f <= floor ? <Icon name="done" size={16} strokeWidth={3} /> : f}</span>
          <span className="bd-step__name">{t(`workplace.floor.${f}`)}</span>
        </li>
      ))}
    </ol>
  );
}

/** 다음 층 조건 (06 문서 5.4): 셋 다 맞으면 다음 급여·정산 때 오른다 */
function Next({ s, cfg, b }: { s: VillageState; cfg: GameConfig; b: Workplace }) {
  const next = b.floor > 0 ? cfg.workplace.levels[b.floor] : undefined;
  if (!next)
    return (
      <p className="bd-meta">
        {b.floor > 0 ? t('workplace.gaugeMax', { points: fmt(b.points) }) : t('workplace.firstWork')}
      </p>
    );
  const bal = s.members[b.memberId]?.balance ?? 0;
  const rows = [
    ['points', `${fmt(b.points)} / ${fmt(next.points)}`, b.points >= next.points],
    ['cost', `${fmt(bal)} / ${fmt(next.cost)}`, bal >= next.cost],
    ['level', `${t('workplace.lv', { n: s.level })} / ${t('workplace.lv', { n: next.level })}`, s.level >= next.level],
  ] as const;
  return (
    <ul className="bd-conds">
      {rows.map(([k, v, ok]) => (
        <li key={k} className="bd-cond" data-cond={k} data-ok={String(ok)}>
          <Icon name={ok ? 'done' : 'close'} size={12} />
          <span>{t(`workplace.cond.${k}`)}</span>
          <span className="bd-cond__val">{v}</span>
        </li>
      ))}
    </ul>
  );
}
```

`BuildingScreen` 본문 (조기 반환·장면 틀은 지금과 같고, 바뀌는 곳만):

```tsx
export function BuildingScreen({ state: s, cfg, projectId, buildingId, onBack }: BuildingScreenProps) {
  // 주소에서 온 id → own 키만. 옛 작업 건물 id(b3)는 없다 → 안내 (06 문서 5.9)
  const b = Object.hasOwn(s.buildings, buildingId) ? s.buildings[buildingId] : undefined;
  const now = useNow((b?.floorAt ?? 0) + cfg.buildings.completeFxMs);
  const sh = `${useId().replace(/\W/g, '')}-sh`;
  if (!b) return /* 지금의 bd--missing 블록 그대로 */;

  const m = s.members[b.memberId];
  const name = workplaceName(s, cfg, b);
  const shape = look(cfg, m?.job, b.floor);
  const working = !!m?.currentRunId;
  const big = b.floor >= cfg.workplace.levels.length;
  const next = b.floor > 0 ? cfg.workplace.levels[b.floor] : undefined;
  const fx = completeFxOn(b.floorAt ?? undefined, now, cfg.buildings.completeFxMs);
  const runs = workplaceRuns(s, b);
  // 이 일터에서 일하는 캐릭터 (마을 targets와 같은 규칙: 주인은 자기 일터, 외부인·팀장은 지금 일하는 팀원의 일터)
  const crew = actorsFromState(s, cfg, now).filter(
    (a) => (a.status === 'working' || a.status === 'blocked') && workSite(s, a.id)?.id === b.id,
  );
  // placed = 지금 코드 그대로 (SPOTS)
  const chip = (
    <Chip className="ui-chip--status">
      <span className="ui-chip__dot" style={{ background: b.floor > 0 ? 'var(--slot4)' : 'var(--st-working)' }}>
        <Icon name={b.floor > 0 ? 'complete' : 'working'} size={12} />
      </span>
      {t(`workplace.floor.${Math.min(b.floor, 4)}`)}
    </Chip>
  );
  const waiting = b.waiting && next && (
    <Chip className="bd-wait" data-waiting={b.waiting}>
      {b.waiting === 'materials' ? t('workplace.waiting.materials') : t('workplace.waiting.level', { n: next.level })}
    </Chip>
  );
  // 반환 JSX: 장면(main.bd-scene)
  //  - 경로 마지막 칸 {name}
  //  - 자재 더미: {working && !big && (<div style={at(-64, 80)}><Prop kind="prop.materials" scale={S} /></div>)}
  //  - <div style={at(0, 0)} data-floor={b.floor}><Building {...shape} slot={m ? slotTone(m.slot) : 'x'}
  //      stage={b.floor > 0 ? 'done' : 'foundation'} scaffold={working && b.floor > 0 && !big} fx={fx} scale={S} /></div>
  //  - 캐릭터 placed 그대로
  //  - <section className="ui-card bd-stepcard"><FloorSteps floor={b.floor} /></section>
  // 정보 패널(aside.bd-info, aria-label t('building.info')):
  //  1) 카드: <NameRow key={b.id} name={name} projectId={projectId} buildingId={b.id} chip={chip} />
  //     <p className="bd-meta">{t('workplace.started', { at: when(b.startedAt), x: b.lot.x, y: b.lot.y })}</p>
  //     <div className="bd-owner"><span>{t('workplace.owner', { type: shape.type })}</span><Who s={s} cfg={cfg} id={b.memberId} /></div>
  //     <div className="bd-prog">{next && <VillageProgress done={b.points} total={next.points} label={t('workplace.gaugeLabel')} />}
  //       <span className="bd-count">{next ? t('workplace.gauge', { points: fmt(b.points), next: fmt(next.points) }) : t('workplace.gaugeMax', { points: fmt(b.points) })}</span>{waiting}</div>
  //  2) 카드: <h2 className="bd-h2">{t('workplace.next')}</h2> + <Next s={s} cfg={cfg} b={b} />
  //  3) 카드: <h2 className="bd-h2">{t('workplace.runs')}</h2><span className="bd-meta">{t('workplace.runsHint')}</span>
  //     runs.length === 0 ? <p className="bd-meta">{t('workplace.noRuns')}</p> :
  //     <ul className="bd-tasks">{runs.slice(0, 8).map((r) => (<li key={r.runId} className="bd-task" data-run={r.runId}>
  //       <span className="bd-task__subject">{runTitle(s, r) ?? t('workplace.noTask', { type: r.agentType })}</span>
  //       <span className="bd-task__time">{t('workplace.plus', { n: fmt(runPoints(r, cfg)) })} · {t('building.took', { d: dur((r.endedAt ?? r.startedAt) - r.startedAt) })}</span></li>))}</ul>
  //  4) 카드: <h2 className="bd-h2">{t('workplace.contrib')}</h2>
  //     <p className="bd-meta" data-contrib="">{t('workplace.contribText', { runs: runs.length, points: fmt(b.points), paid: fmt(b.paid) })}</p>
  //  5) <div className="bd-actions"><Button onClick={onBack}>{t('building.back')}</Button></div>
}
```
  (주석으로 적은 JSX는 지금 파일의 같은 자리 요소를 위 내용으로 바꾸는 것 — 클래스 이름·순서 그대로 쓴다.)

`building.css`에 (토큰만):

```css
.bd-conds { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--sp-2); }
.bd-cond { display: flex; align-items: center; gap: var(--sp-2); font-size: var(--fs-min); color: var(--text); }
.bd-cond[data-ok='false'] { color: var(--danger); }
.bd-cond__val { margin-left: auto; font-family: var(--font-display); }
.bd-wait { border-color: var(--danger); }
```
  (`--sp-2`·`--fs-min`·`--text`·`--danger`·`--font-display`는 `tokens.css`에 있다. 없는 이름이 보이면 새로 만들지 말고 있는 토큰으로.)

- [ ] **Step 4: 격자** — `GridScreen.tsx`: import에서 `contribution` 빼고 `workplaceName`, `Chip`, `VillageProgress` 더하기. 맨 위 주석 "작업 건물 카드 줄 + 기초·예정 부지 칩" → "팀원 일터 카드 줄 + 공사 중 칩". `works` 계산(58~67줄)과 작업 건물 절(137~204줄)을:

```tsx
  // 부지 잡은 순 = 마을 장면 순서
  const works = scene.buildings.flatMap((sb) => {
    const b = sb.id.startsWith('work:') ? s.buildings[sb.id.slice(5)] : undefined;
    return b ? [{ b, sb }] : [];
  });
  const cards = works.filter((w) => w.b.floor > 0);
  const sites = works.filter((w) => w.b.floor === 0);
```

```tsx
      <div className="gs__head gs__head--works">
        <h2>{t('grid.works')}</h2>
        <span className="gs-meta">
          {t('grid.worksMeta', { n: works.length, site: sites.length, waiting: works.filter((w) => w.b.waiting).length })}
        </span>
      </div>
      {works.length === 0 && <p className="gs-empty">{t('grid.noWorks')}</p>}
      {cards.length > 0 && (
        <div className="gs__cards">
          {cards.map(({ b, sb }) => {
            const m = s.members[b.memberId];
            const next = cfg.workplace.levels[b.floor];
            return (
              <a
                key={b.id}
                className="gs-card"
                data-building={b.id}
                style={m?.departed ? { opacity: DEPARTED_OPACITY } : undefined}
                {...link({ screen: 'building', id: b.id })}
              >
                <Illo b={sb} />
                <div className="gs-card__body">
                  <div className="gs-card__row">
                    <span className="gs-card__name">{workplaceName(s, cfg, b)}</span>
                    <JobChip slot={sb.slot ?? 'x'} sm>
                      {look(cfg, m?.job, b.floor).type}
                    </JobChip>
                    <span className="gs-meta gs-end">{t(`workplace.floor.${Math.min(b.floor, 4)}`)}</span>
                  </div>
                  <div className="gs-card__row">
                    {next && (
                      <VillageProgress className="gs-gauge" done={b.points} total={next.points} label={t('workplace.gaugeLabel')} />
                    )}
                    <span className="gs-meta">
                      {next ? t('grid.gauge', { points: fmt(Math.round(b.points)), next: fmt(next.points) }) : t('grid.gaugeMax')}
                    </span>
                    {b.waiting && next && (
                      <Chip sm data-waiting={b.waiting}>
                        {b.waiting === 'materials'
                          ? t('workplace.waiting.materials')
                          : t('workplace.waiting.level', { n: next.level })}
                      </Chip>
                    )}
                    <span className="gs-faces gs-end">
                      <Face s={s} cfg={cfg} id={b.memberId} />
                    </span>
                  </div>
                </div>
              </a>
            );
          })}
        </div>
      )}
      {sites.length > 0 && (
        <div className="gs__sites">
          {sites.map(({ b }) => (
            <a key={b.id} className="gs-chip" data-building={b.id} {...link({ screen: 'building', id: b.id })}>
              {t('grid.site', { stage: t('workplace.floor.0'), name: workplaceName(s, cfg, b) })}
            </a>
          ))}
        </div>
      )}
```
  `FACES` 상수를 지운다. `grid.css`에 `.gs-gauge { width: 120px; }`.

- [ ] **Step 5: 글자** — `i18n.ts`에 이 태스크의 `workplace.*`·`grid.*` 키를 넣고, 위 "지우는 키"를 지운다.

- [ ] **Step 6: 통과 확인 (전체)** — Run: `pnpm test && pnpm lint` → Expected: 모두 PASS. lint에서 남는 오류는 손으로 만든 옛 `Building`·`buildingId`를 쓰는 곳뿐이어야 한다 — 그 자리를 이 계획의 새 모양으로 고친다 (예: `grep -rn "buildingId\|taskIds\|ownerMemberId\|stage: 'frame'" packages/*/src`로 찾기).

---

### Task 9: e2e · 실제 두 마을 확인 · 문서 · 마감

**Files:**
- Create: `e2e/workplaces.spec.ts`; Delete: `e2e/buildings.spec.ts`
- Modify: `e2e/live.spec.ts:32-49,97`, `e2e/grid.spec.ts:42-91`, `e2e/growth.spec.ts:84`, `e2e/economy.spec.ts:15,80`, `e2e/a11y.spec.ts:115`
- Modify: `docs/01-기획서.md`, `docs/02-구현설계서.md`, `docs/03-디자인-핸드오프.md`, `README.md`, `docs/HANDOFF.md`, `docs/04-작업계획.md`, `docs/06-도시와-경제.md` 16장

**Interfaces:**
- Consumes: 수집기 :4798(임시 DB, `TYCOON_CLOCK_MS` 250) + 웹 :5174 (playwright.config.ts 그대로), 마을 설정 `overrides.workplace.levels`.

- [ ] **Step 1: e2e 쓰기** — `e2e/workplaces.spec.ts`:

```ts
// M13 완료 기준 (04 문서, 06 문서 5·16장): 훅 → 수집기(:4798) → 화면. 팀원이 처음 일하면 3×3 부지 + 현장 → 1층(얼굴 간판·이름표),
// 일 점수가 차고 자재비가 모이면 2층, 모자라면 "자재비 대기", 3층은 Lv.4라 M13에선 "Lv.4 필요". 일하는 동안 비계·게이지.
// 일터 상세(&building=)·이름 바꾸기(새로고침에도), 외부인은 일터를 만들지 않고, 일터 수 = 일한 팀원 수. 층 수치는 이 마을만 작게
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const COLLECTOR = 'http://127.0.0.1:4798'; // playwright.config.ts
const root = resolve(import.meta.dirname, '..');
const SHOTS = process.env.SHOTS;
const SESSION = 'm13';
/** 2층 3점 · 3층 6점(Lv.4) · 큰 건물 9점(Lv.7), 자재비 100씩. 도구 1번 = 급여 26, 세금 5 → 잔고 +21 (토큰 기록이 없어 비용 0) */
const LEVELS = [
  { points: 0, cost: 0, level: 1 },
  { points: 3, cost: 100, level: 1 },
  { points: 6, cost: 100, level: 4 },
  { points: 9, cost: 100, level: 7 },
];
interface State {
  runs: Record<string, { memberId: string | null }>;
  buildings: Record<string, { memberId: string; floor: number; points: number; waiting: string | null; name: string }>;
  members: Record<string, { balance: number }>;
  facilities: Record<string, unknown>;
}
let cwd = '';
let pid = '';
let n = 0;
const post = async (e: Record<string, unknown>) => {
  const r = await fetch(`${COLLECTOR}/hook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session_id: SESSION, cwd, ...e }),
  });
  expect(r.status).toBe(204);
};
/** 서브에이전트 실행 시작. tool() = 도구 한 번, stop() = 끝 */
async function start(agent_type: string) {
  const agent_id = `m13-${++n}`;
  let k = 0;
  await post({ hook_event_name: 'SubagentStart', agent_id, agent_type });
  return {
    tool: () => post({ hook_event_name: 'PostToolUse', agent_id, tool_name: 'Read', tool_use_id: `${agent_id}-${k++}` }),
    stop: () => post({ hook_event_name: 'SubagentStop', agent_id, agent_type }),
  };
}
async function work(agent_type: string, calls: number) {
  const r = await start(agent_type);
  for (let i = 0; i < calls; i++) await r.tool();
  await r.stop();
}
const state = async () => (await (await fetch(`${COLLECTOR}/api/projects/${pid}/state`)).json()) as State;

test.beforeAll(async () => {
  cwd = mkdtempSync(join(tmpdir(), 'tycoon-m13-'));
  cpSync(join(root, 'examples/target-project/.claude'), join(cwd, '.claude'), { recursive: true });
  const path = join(cwd, '.claude/tycoon.json');
  const tycoon = JSON.parse(readFileSync(path, 'utf8')) as { overrides?: Record<string, unknown> };
  tycoon.overrides = { ...tycoon.overrides, workplace: { levels: LEVELS } };
  writeFileSync(path, JSON.stringify(tycoon));
  await post({ hook_event_name: 'SessionStart', source: 'startup' });
  const list = (await (await fetch(`${COLLECTOR}/api/projects`)).json()) as { id: string; cwd: string }[];
  pid = encodeURIComponent(list.find((p) => p.cwd === cwd)?.id ?? '');
  expect(pid).not.toBe('');
});
test.afterAll(async () => {
  if (pid) await post({ hook_event_name: 'SessionEnd' });
});

test('일터: 현장 → 1층(간판·이름표) → 자재비 대기 → 2층 → Lv.4 필요, 비계·게이지, 상세·이름 바꾸기, 외부인은 없음, 일터 수 = 일한 팀원 수', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?project=${pid}`);
  await expect(page.locator('button.tp-card')).toHaveCount(4);
  const site = page.locator('[data-building="work:w1:backend-dev"]');
  const body = () => site.locator('[data-asset-id^="body."]').getAttribute('data-asset-id');

  // 1) 첫 실행: 예정 부지 → 도구를 쓰면 기초 → 끝나면 1층 + 얼굴 간판·이름표 (집과 일터 둘)
  const first = await start('backend-dev');
  await expect(site.locator('[data-asset-id="site.planned"]')).toBeAttached();
  await first.tool();
  await expect(site.locator('[data-asset-id="site.foundation"]')).toBeAttached();
  await first.stop();
  await expect.poll(body).toMatch(/-1f$/);
  await expect(page.locator('[data-owner-sign="backend-dev"]')).toHaveCount(2);
  await expect(page.locator('[data-name-tag="backend-dev"]')).toHaveCount(2);

  // 2) 도구 3번: 점수 4 ≥ 3인데 잔고 83 < 100 → 자재비 대기 (알림 한 번)
  await work('backend-dev', 3);
  await expect(page.locator('.ts').getByText('backend-dev 일터 2층 자재비 대기 · 100')).toBeVisible();
  expect((await state()).buildings['w1:backend-dev']).toMatchObject({ floor: 1, points: 4, waiting: 'materials' });

  // 3) 도구 1번: 잔고 104 → 2층 (자재비 100)
  await work('backend-dev', 1);
  await expect(page.locator('.ts').getByText('backend-dev 일터 2층 완공')).toBeVisible();
  await expect.poll(body).toMatch(/-2f$/);
  expect((await state()).members['backend-dev']?.balance).toBe(4);

  // 4) 일하는 동안: 비계 + 게이지 (점수는 실행이 끝날 때 쌓인다) → 끝나면 6점, Lv.4 필요
  const busy = await start('backend-dev');
  await busy.tool();
  await expect(site.locator('[data-asset-id="site.scaffold-2f"]')).toBeAttached();
  await expect(page.getByRole('img', { name: 'backend-dev의 공방 일 점수 5 / 6' })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'm13-working.png') });
  await busy.stop();
  await expect.poll(async () => (await state()).buildings['w1:backend-dev']?.waiting).toBe('level');
  await expect(site.locator('[data-asset-id^="site.scaffold"]')).toHaveCount(0);

  // 5) 일터 상세 (&building=w1%3Abackend-dev): 층·게이지·조건·최근 일·쌓은 일
  await page.getByRole('button', { name: 'backend-dev의 공방 건물 보기' }).click();
  await expect(page).toHaveURL(/[?&]building=w1(%3A|:)backend-dev$/);
  const detail = page.locator('.ms__detail');
  await expect(detail.locator('h1')).toHaveText('backend-dev의 공방');
  await expect(page.getByRole('list', { name: '일터 층' }).locator('[aria-current="step"]')).toContainText('2층');
  await expect(detail.locator('.bd-count')).toHaveText('일 점수 6 / 6');
  await expect(detail.locator('[data-waiting="level"]')).toHaveText('Lv.4 필요');
  await expect(detail.locator('.bd-cond[data-cond="level"]')).toHaveAttribute('data-ok', 'false');
  await expect(detail.locator('.bd-task')).toHaveCount(4);
  await expect(detail.locator('[data-contrib]')).toHaveText('실행 4번 · 일 점수 6 · 자재비 100');
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'm13-detail.png') });

  // 6) 이름 바꾸기 → PUT(:bid 디코드) → ui 줄 → SSE, 새로고침에도
  await detail.getByRole('button', { name: '이름 바꾸기' }).click();
  await detail.getByRole('textbox', { name: '건물 이름' }).fill('  고래   공방 ');
  await detail.getByRole('button', { name: '저장' }).click();
  await expect(detail.locator('h1')).toHaveText('고래 공방');
  expect((await state()).buildings['w1:backend-dev']?.name).toBe('고래 공방');
  await page.reload();
  await expect(page.locator('.ms__detail h1')).toHaveText('고래 공방');
  await page.locator('.ms__detail').getByRole('button', { name: '마을로' }).last().click();

  // 7) 둘째 팀원 → 둘째 일터(동쪽), 외부인은 일터 없음(시설만), 일터 수 = 일한 팀원 수 (06 문서 16장)
  await work('frontend-dev', 1);
  await expect(page.locator('[data-building="work:w1:frontend-dev"] [data-asset-id^="body."]')).toBeAttached();
  await work('general-purpose', 2);
  await expect(page.locator('[data-building="facility:agency"]')).toBeAttached();
  const s = await state();
  const workers = new Set(Object.values(s.runs).flatMap((r) => (r.memberId ? [r.memberId] : [])));
  expect(Object.values(s.buildings).map((b) => b.memberId).sort()).toEqual([...workers].sort());
  expect(Object.keys(s.buildings).sort()).toEqual(['w1:backend-dev', 'w1:frontend-dev']);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'm13-village.png') });
});
```

- [ ] **Step 2: 기존 e2e 맞추기**
  - `e2e/buildings.spec.ts`를 지운다 (작업 묶기·완공은 없어졌다 — 이름 바꾸기·상세·새로고침은 workplaces.spec이 본다).
  - `live.spec.ts`: 48~49줄 `const site = page.getByRole('img', { name: /^공사 \d+ \/ 6$/ }); await expect(site).toBeVisible();` → `const site = page.locator('[data-building="work:w1:backend-dev"]'); await expect(site.locator('[data-asset-id^="site."]')).toBeAttached(); // 막힌 첫 실행 = 일터 현장`. 97줄 `const s0 = await center(site);`를 SubagentStart(105줄) 뒤로 옮기고 대상을 frontend-dev 자기 일터로: `const mine = page.locator('[data-building="work:w1:frontend-dev"]'); await expect(mine).toBeAttached(); const s0 = await center(mine);`. 1·32줄 제목의 "현장으로" → "자기 일터로".
  - `grid.spec.ts`: 42줄 주석 → "A 마을: 작업 둘(건물 없음) + backend-dev가 한 번 일함 = 입주 + 1층 일터 (06 문서 5장)", 테스트 제목 "집 카드·예정 부지 칩" → "집 카드·일터 카드", 64~66줄 → `await expect(grid.getByRole('heading', { name: '팀원 일터' })).toBeVisible(); await expect(grid.locator('a.gs-card[data-building]')).toHaveCount(1);`, 79~80줄 → `// 일터 카드 → 일터 상세` + `await grid.locator('a.gs-card[data-building]').click();`, 88·91줄의 `a.gs-chip` → `a.gs-card[data-building]`.
  - `growth.spec.ts:84` 주석 → "6) 일터(3×3)가 남·동에 하나씩이라 셋째 팀원부터, 집은 서쪽 4채를 넘으면 섬이 넓어진다 (D10)" (기대값 `ring` 1은 그대로).
  - `economy.spec.ts`: 15줄 `BURST` 상수와 80줄 `buildings: { burstWindowMs: BURST }`를 지운다.
  - `a11y.spec.ts:115` → `` ['건물', `&building=${encodeURIComponent(building)}`] ``.

- [ ] **Step 3: e2e 실행** — Run: `pnpm e2e` → Expected: 모두 PASS (buildings.spec 빠지고 workplaces.spec 더해짐). 그다음 `SHOTS=$(mktemp -d) pnpm e2e e2e/workplaces.spec.ts e2e/live.spec.ts e2e/grid.spec.ts`로 스크린샷을 찍어 **눈으로** 본다: 2층 일터·비계·게이지·층 배지 자리(`FloorBadge` `top`), 얼굴 간판이 2층 벽 간판 자리에 있는지, 이름표 겹침. 배지 위치가 지붕에서 벗어나면 `WorldUi.tsx` `FloorBadge`의 `top`만 고친다.

- [ ] **Step 4: 실제 두 마을 재생 (DB 복사본)** — Run:

```bash
D=$(mktemp -d) && cp ~/.subagent-tycoon/tycoon.db* "$D"/
ids=$(TYCOON_DB="$D/tycoon.db" pnpm -s replay nope 2>&1 | sed -n 's/^있는 마을: //p' | tr ',' ' ')   # 없는 id를 주면 있는 마을 목록을 낸다
for id in $ids; do
  TYCOON_DB="$D/tycoon.db" pnpm -s replay "$id" > "$D/$id.json"
  node -e 'const s=require(process.argv[1]);const w=new Set(Object.values(s.runs).flatMap(r=>r.memberId?[r.memberId]:[]));const b=Object.values(s.buildings);console.log(process.argv[1],"일한 팀원",w.size,"일터 주인",new Set(b.map(x=>x.memberId)).size,"같음",[...w].every(x=>b.some(y=>y.memberId===x)),"층",b.map(x=>x.id+":"+x.floor+"("+Math.round(x.points)+","+(x.waiting??"-")+")").join(" "))' "$D/$id.json"
done
```
  → Expected: 모든 마을(ETL·agent_village 포함) "같음 true". 층·대기 목록을 04 작업 기록에 적는다. 4777 수집기·실제 DB는 건드리지 않는다.

- [ ] **Step 5: 문서**
  - `docs/01-기획서.md`: 3.3 표의 "작업 건물 | 작업이 생길 때 (5장) | 남쪽 → 동쪽" → "팀원 일터 | 그 팀원이 처음 일할 때 (3×3 부지, 06 문서 5장) | 남쪽 → 동쪽". 4장 표 "작업 중" 위치 "연결된 공사 현장" → "자기 일터 앞 (팀장·공사 돕는 외부인은 가장 최근에 일을 시작한 팀원의 일터, 06 문서 5.9)". 92줄 환호 → "일터 층이 오를 때 주인 환호 포즈 2초 (`buildings.cheerMs`)". 5장 제목 "건물 규칙" → "작업과 일터", 5.1은 1·5만 남기고(1의 "생성 즉시 예정 부지에 들어간다" 삭제) 2~4를 "(M13에서 없어짐: 작업은 건물을 만들지 않는다 — 06 문서 5.8)"로, 5.2·5.3 본문을 "일터 규칙(층·게이지·자재비·대기·두 번째 일터·종류·이름)은 06 문서 5장이 기준. 이름 바꾸기 규칙(사용자 이름 1~24자, 보이지 않는 글자)은 아래 그대로"로 줄이고 사용자 이름 규칙 줄은 남긴다(`nameByUser` 언급 삭제). 5.4 → "일터는 절대 사라지지 않는다. 층·일 점수·낸 자재비는 내려가지 않는다 (작업이 지워져도). 집·시설 부지는 2×2, 일터 부지는 3×3 — 배치는 02 문서 8장". 8.5 제목·내용 → "일터 상세 — 층 스텝(1층·2층·3층·큰 건물), 게이지(일 점수 ÷ 다음 층), 다음 층 조건(점수·자재비·마을 레벨), 대기 칩, 최근 일(실행 8개), 쌓은 일, 이름 바꾸기 (06 문서 13장)". 10장 "골조는 트윈 없이 바로 새 높이" 구절 삭제. 11장 D2 기본값 끝에 "(M13: 작업은 건물을 만들지 않는다 — D18·D19)".
  - `docs/02-구현설계서.md`: 6장 `buildings` 주석 → "팀원 일터 (06 문서 5장, 절대 삭제 안 함)", `ring` 뒤 `level: number; // 마을 레벨 (M14가 올림, M13은 1)`, `Task`에서 `buildingId` 삭제, `interface Building`을 Task 3 Step 3의 모양으로. 8.1 표: 남 → "팀원 일터 3×3 (처음 일할 때)", 동 → "남쪽이 차면 일터", 첫 불릿 → "부지 후보는 구역 안에서 광장에 가까운 순 — 집·시설 2×2, 일터 3×3(`Lot.size` 3). 길·광장·다른 부지와 겹치지 않고 부지 사이 1칸 이상", 둘째 불릿 → "일터 건물(2×2)은 부지 왼쪽 위에 서고 앞줄·오른쪽 줄은 앞마당(일하는 자리·자재 더미), 큰 건물은 3×3 전부 — 자리를 옮기지 않는다". 8.2 목적지 "작업 중 = 연결된 부지의 앞쪽 두 칸" → "작업 중 = 자기 일터 앞마당 (큰 건물이면 3×3 앞 줄), 팀장·공사 돕는 외부인은 `activeSite`". 9장 이름 바꾸기 줄 → "일터 이름 바꾸기 … `:bid`는 URL 디코드 (`w1%3Abackend-dev`). 204 / 잘못된 본문·이름 400 / 없는 마을·일터 404".
  - `docs/03-디자인-핸드오프.md` 3.1 제목 "(모두 2×2)" 뒤에 한 줄: "일터(M13)는 M15 새 그림 전까지 임시 — 3층 = 2층 그림 + 층 배지(`FloorBadge`, --coin 알약), 큰 건물 = 2층 그림을 3×3 부지 가운데, 주인이 일하는 동안 완공 몸통 위에 `site.scaffold-1f|2f`(`Building` `scaffold`) + 게이지(`Gauge`). 새 토큰 없음".
  - `docs/06-도시와-경제.md` 16장 M13 줄 끝에 "(2026-10-01 완료, 5.9)".
  - `README.md` 3줄 "작업은 건물이 되고" → "팀원마다 일터가 일한 만큼 층을 올리고", 51줄 "작업이 생기면 공사 건물이 올라가요" → "팀원이 처음 일하면 그 팀원의 일터 부지가 생기고, 일 점수와 자재비가 모이면 층이 올라가요 (3층부터는 마을 레벨)".
  - `docs/HANDOFF.md`: 1장 첫 불릿에 M13 완료를 더하고 "다음은 **M14 레벨·공공시설**", 검증 숫자(Task 9 Step 3·6의 test·e2e 수)로 바꾸기. 2장에 "M13 일터" 요약 불릿 (일터 id·3×3·레벨 1 고정·자재비 보정값·임시 그림). 3장 "다음 할 일"을 M14로 (M14가 `VillageState.level`을 올리면 `raiseAll`이 같은 정산에서 층을 올린다는 연결점 포함).
  - `docs/04-작업계획.md`: M13 줄 `- [ ]` → `- [x]`와 괄호 요약, 작업 기록 표 끝에 한 줄 — 날짜 `2026-10-01`, 마일스톤 `M13 일터`, 메모에 차례로: 06 문서 5장(문서 먼저 5.9) · 일터 = `VillageState.buildings`(모양 바꿈), id `w<n>:<팀원>`, 3×3 부지(남 → 동) · 첫 실행 시작 = 현장, 끝 = 1층 · 일 점수 = 실행 도구 호출 × 품질(`finishRun`) · 층 = 점수·레벨(M13은 1)·자재비, 자재비 대기 중 가구 자동 구매 쉼, 큰 건물 뒤 두 번째 일터 · 작업 → 건물 묶기·`predict` 지움 · Task 6의 자재비 세 값과 근거(`k`, 층마다 실측/어림) · 웹 임시 그림(3층·큰 건물 배지)·비계·게이지·일터 상세·격자 카드 · Step 4의 마을별 결과 · Step 6의 lint·test·e2e 수.

- [ ] **Step 6: 마감 검증** — Run: `pnpm lint && pnpm test && pnpm e2e` → Expected: 모두 PASS. 수를 HANDOFF 1장·04 작업 기록에 적는다.

- [ ] **Step 7: 컨트롤러에게 보고** — 자재비 보정값(Task 6), 실제 두 마을 결과(Step 4), 스크린샷 폴더, 그리고 `CLAUDE.md` 명령 주석의 `/dev/village?live=build = N=6 공사 흐름 재생`이 낡았다는 점(→ "일터 층 올리기 재생", CLAUDE.md는 사용자 확인 뒤 고친다)을 보고한다. 컨트롤러 검토가 통과한 뒤에만 `tools/stable.sh sync && tools/stable.sh restart`.

---

## Self-review (계획 작성자)

- **스펙 범위:** 5.1 생기는 때(Task 3) · 3×3 예약(Task 2) · 5.2 게이지 = 일 점수, 외부인·팀장 제외, 내려가지 않음(Task 3·5 + 무작위 불변 테스트) · 5.3 층·자재비·보정(Task 5·6) · 5.4 세 조건·대기 이유·확인 시점·자동 구매 쉼(Task 5) · 5.5 두 번째 일터·Lv.7 대기 중 계속 쌓임(Task 5) · 5.6 종류·색·이름·간판(Task 7·8) · 5.7 외부인(Task 3·7) · 5.8 작업 그대로·묶기 제거(Task 3) · 6.1 레벨 게이트(O1, Task 5) · 7장 간판·이름표(Task 7, M16 `OwnerSign` 재사용) · 12장 배치·재생(Task 2·9) · 13장 일터 상세·알림(Task 5·8) · 14장 임시 그림(Task 7) · 15장 설정값·시뮬레이션 30·100건(Task 3·6) · 16장 완료 기준(Task 3 테스트, Task 9 e2e·실제 두 마을).
- **이름 일관성:** `Building`(일터) · `currentWorkplace` · `applyWorkplaces` · `accrue` · `raiseAll` · `waitingMaterials` · `runPoints` · `workplaceName` · `activeSite` · `workSite` · `frontTiles(l, M, n)` · `LiveScene.gauges` · `FloorSteps` · `workplaceRuns` · `look(cfg, presetId, floor)` — 정의한 태스크와 쓰는 태스크가 같은 서명.
- **빠진 것 (일부러):** 경제 기록(`DayRecord`)에 자재비 칸은 두지 않았다 — 자재비 합은 `Building.paid`가 기록이고, 경제 패널 "일터 현황"(13장)은 M20. 필요해지면 `today.materials`를 더한다.
