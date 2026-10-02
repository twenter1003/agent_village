// 프로젝터: (State, DomainEvent) → State. 순수 함수 (02 문서 6.1). Date.now()/Math.random() 금지.
import type { GameConfig } from '../config/config';
import type { DomainEvent } from '../events/normalize';
import { applyMeeting } from '../rules/meeting';
import { applyGrowth } from '../rules/growth';
import { applyRoster } from '../rules/roster';
import { applyRuns, segment } from '../rules/runs';
import { deriveStatus } from '../rules/status';
import { applyTasks } from '../rules/tasks';
import { applyWorkplaces } from '../rules/workplace';
import { applyEconomy } from '../rules/economy';
import { applyFurniture } from '../rules/furniture';
import { applyPersonality } from '../rules/personality';
import { defaultConfig } from '../config/config';
import type { VillageState } from './types';

export const FEED_MAX = 500;
// ponytail: 토스트 닫기(ui 이벤트)가 생기기 전까지 최근 50개만 남긴다. SSE가 매번 전체 스냅샷을 보낸다
export const TOAST_MAX = 50;

export function initialState(project: string, cfg: GameConfig = defaultConfig): VillageState {
  // 빈 모래섬 (01 문서 3.3): 시설·집·광장은 일하면서 생긴다
  return {
    project,
    clock: { now: 0, day: 0, activeMs: 0, dayStartMs: 0, dayMs: cfg.time.gameDayMs, lastEventAt: 0, mainTurn: false },
    members: {},
    visitors: {},
    runs: {},
    tasks: {},
    buildings: {},
    houses: {},
    facilities: {},
    taskTool: false,
    agentCalls: [],
    mainTokens: {},
    mainUsage: {},
    mainCtx: null,
    ring: 0,
    level: 1,
    hall: null,
    publicWorks: [],
    foundedAt: null,
    conf: { members: {} },
    meeting: null,
    feed: [],
    toasts: [],
    seq: 0,
    economy: {
      fund: 0,
      deficit: false,
      today: {
        wages: 0,
        tax: 0,
        purchases: 0,
        tokens: 0,
        leaderTokens: 0,
        leaderUnpaid: 0,
        leaderPurchases: 0,
        materials: 0,
        works: 0,
      },
      history: [],
    },
  };
}

/** 일하는 동안 시간이 흐를 수 있는 마지막 시각 (01 문서 6.2 활동 시간): 메인 턴은 마지막 훅 이벤트, 끝나지 않은 실행은
 *  그 실행의 마지막 이벤트에서 activeGapCapMs까지. 일마다 따로 재서 버려진 실행이 다른 턴의 이벤트로 되살아나지 않는다.
 *  수집기 시계 줄도 이걸 본다 (지금 < activeUntil이면 넣음) */
export function activeUntil(s: VillageState, cfg: GameConfig): number {
  let last = s.clock.mainTurn ? s.clock.lastEventAt : -Infinity;
  for (const r of Object.values(s.runs)) if (r.endedAt === null) last = Math.max(last, r.lastAt);
  return last + cfg.time.activeGapCapMs;
}

/** 에이전트 일이 아닌 이벤트: 시계·팀원 목록·사용자 행동. 메인 턴 상한을 다시 열지 않는다 (01 문서 6.2) */
const NOT_WORK = new Set<DomainEvent['t']>([
  'Tick',
  'GameDayTick',
  'RosterLoaded',
  'BuildingRenamed',
  'FurniturePurchased',
  'FurnitureMoved',
]);

/** 이벤트 하나 = 활동 시간 → (날이 오르면 GameDayTick) → 그 이벤트 (02 문서 6.1) */
export function project(prev: VillageState, e: DomainEvent, cfg: GameConfig): VillageState {
  const s = structuredClone(prev);
  const c = s.clock;
  // 직전 이벤트 뒤로 일하는 중이었던 틈만 센다. 일마다 마지막 훅 이벤트 뒤 activeGapCapMs까지 (Tick·사용자 행동으론 못 늘림)
  c.activeMs += Math.max(0, Math.min(e.at, activeUntil(prev, cfg)) - c.now);
  // 하루 길이가 바뀌었으면(roster 줄의 설정) 지금 날에서 이어 간다: 지난 날은 다시 나누지 않고, 오늘 지난 몫은 새 하루 한 번까지.
  // 이 이벤트의 틈까지 더한 뒤에 자른다 — 앞에서 자르면 그 틈만큼 날이 더 넘어간다 (01 문서 6.2, M9 리뷰)
  if (c.dayMs !== cfg.time.gameDayMs) {
    c.dayMs = cfg.time.gameDayMs;
    c.dayStartMs = Math.max(c.dayStartMs, c.activeMs - c.dayMs);
  }
  if (!NOT_WORK.has(e.t)) c.lastEventAt = Math.max(c.lastEventAt, e.at);
  // 메인 턴: 프롬프트부터. 시작을 못 봤어도(훅·수집기를 턴 도중에 켬) 메인 세션 도구 호출이 오면 연다 (01 문서 6.2)
  if (e.t === 'PromptSubmitted' || (e.t === 'ToolUsed' && e.runId === null)) c.mainTurn = true;
  if (e.t === 'MainTurnEnded' || e.t === 'SessionStarted' || e.t === 'SessionEnded') c.mainTurn = false;
  if (e.t === 'GameDayTick' && e.day > c.day) c.dayStartMs = c.activeMs; // 밖에서 넣은 틱(테스트) = 지금 새 날
  const passed = Math.floor((c.activeMs - c.dayStartMs) / c.dayMs);
  if (passed > 0) {
    c.dayStartMs += passed * c.dayMs;
    step(s, { t: 'GameDayTick', at: e.at, day: c.day + passed }, cfg);
  }
  // agent_id → 실행 구간 (이어 받은 서브에이전트, 시작을 못 본 실행은 시작을 먼저, 01 문서 6.1)
  for (const x of segment(s, e)) {
    step(s, x, cfg);
    const r = 'runId' in x && x.runId ? s.runs[x.runId] : undefined;
    if (r) r.lastAt = Math.max(r.lastAt, x.at);
  }
  return s;
}

/** 규칙 모듈은 draft를 고친다. 순서가 뜻을 가진다: 등록 → 성장(입주·시설, 01 문서 3.3) → 일터(현장, 06 문서 5.1) → 실행 → 회의 → 작업 → 경제(급여·정산) → 가구 → 성격 → 상태 파생 */
function step(s: VillageState, e: DomainEvent, cfg: GameConfig) {
  s.clock.now = Math.max(s.clock.now, e.at);
  if (e.t === 'GameDayTick') s.clock.day = Math.max(s.clock.day, e.day);
  applyRoster(s, e, cfg);
  applyGrowth(s, e, cfg);
  applyWorkplaces(s, e, cfg);
  applyRuns(s, e, cfg);
  applyMeeting(s, e, cfg);
  applyTasks(s, e, cfg);
  applyEconomy(s, e, cfg);
  applyFurniture(s, e, cfg);
  applyPersonality(s, e, cfg);
  deriveStatus(s, e.at, cfg);
  if (s.feed.length > FEED_MAX) s.feed = s.feed.slice(-FEED_MAX);
  if (s.toasts.length > TOAST_MAX) s.toasts = s.toasts.slice(-TOAST_MAX);
}

export function replay(project_: string, events: DomainEvent[], cfg: GameConfig): VillageState {
  return events.reduce((s, e) => project(s, e, cfg), initialState(project_, cfg));
}

/** 모든 id를 결정적으로 만든다 */
export const nextId = (s: VillageState, prefix: string) => `${prefix}${++s.seq}`;
