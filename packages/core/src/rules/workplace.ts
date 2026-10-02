// 팀원 일터 (06 문서 5장, D18·D19): 처음 일할 때 3×3 부지 + 공사 현장, 그 일이 끝나면 1층, 끝난 실행의 일 점수를 쌓는다.
// 순수: 시각은 이벤트, id는 주인·순번 (5.9)
import type { GameConfig } from '../config/config';
import type { DomainEvent } from '../events/normalize';
import { mapOffset } from '../layout/lots';
import { nextId } from '../projector/project';
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
    const far = -mapOffset(cfg.layout.maxRing) - 4; // maxRing까지 넓혀도 없으면 가장 넓은 맵보다 1칸 더 밖 (다른 부지와 안 닿게)
    lot = { x: far, y: far, size: 3 };
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

/** 팀원 실행이 끝나 급여를 준 뒤 (economy finishRun): 첫 일이면 1층 완공(자재비 없음), 일 점수를 쌓는다.
 *  2층부터는 economy가 그 실행의 토큰값까지 셈한 뒤 raiseAll로 본다 (5.9) */
export function accrue(s: VillageState, m: Member, points: number, at: number, cfg: GameConfig): void {
  const b = siteFor(s, m, at, cfg);
  b.points = Math.round((b.points + points) * 1e6) / 1e6; // × 1.2 소수 오차로 74.99999…가 75를 놓치지 않게
  if (b.floor === 0) {
    b.floor = 1;
    b.floorAt = at;
    s.feed.push({ at, kind: 'task', text: `${m.name} 일터 1층 완공`, ref: b.id }); // 1층은 활동 기록만 (5.9)
  }
}

/** 활동 기록·토스트 글자의 층 이름: 마지막 줄 = 큰 건물, 그 밖 N층 (화면 글자는 이름 사전 workplace.floor) */
const floorName = (f: number, cfg: GameConfig) => (f >= cfg.workplace.levels.length ? '큰 건물' : `${f}층`);

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
        const text = `${m.name} 일터 ${floorName(b.floor + 1, cfg)} 자재비 대기 · ${next.cost}`;
        s.feed.push({ at, kind: 'economy', text, ref: b.id });
        s.toasts.push({ id: nextId(s, 'toast'), at, kind: 'tokens', text, sticky: false, ref: m.id });
      }
      return void (b.waiting = 'materials');
    }
    m.balance -= next.cost;
    b.paid += next.cost;
    s.economy.today.materials += next.cost;
    m.materialsToday += next.cost;
    b.floor++;
    b.floorAt = at;
    b.waiting = null;
    m.cheerUntil = at + cfg.buildings.cheerMs; // 층이 오를 때 주인 환호 (5.4)
    const text = `${m.name} 일터 ${floorName(b.floor, cfg)} 완공`;
    s.feed.push({ at, kind: 'task', text, ref: b.id });
    s.toasts.push({ id: nextId(s, 'toast'), at, kind: 'complete', text, sticky: false });
  }
}

/** 실행이 끝나 급여·토큰값을 다 셈한 뒤, 하루 정산 때(자동 구매 전): 모든 일터를 다시 본다 — 레벨이 오른 뒤(M14)도 여기서 (5.4·5.9) */
export function raiseAll(s: VillageState, at: number, cfg: GameConfig): void {
  for (const b of Object.values(s.buildings)) raise(s, b, at, cfg);
}

/** 자재비를 기다리는 팀원 → 가구 자동 구매를 쉰다 (돈이 일터로 먼저 가게, 5.4) */
export const waitingMaterials = (s: VillageState, memberId: string) =>
  Object.values(s.buildings).some((b) => b.memberId === memberId && b.waiting === 'materials');

/** 가구 자동 구매가 남길 자재비 (D33, 06 문서 6.4): 지금 일터의 다음 층 게이지가 autoBuy.saveFromGauge 이상이면 그 층 자재비, 아니면 0.
 *  공사 중(0층)·큰 건물은 0 — 1층은 공짜, 큰 건물 뒤 두 번째 일터는 게이지가 0부터 */
export function materialsReserve(s: VillageState, memberId: string, cfg: GameConfig): number {
  const cur = currentWorkplace(s, memberId);
  const rows = cfg.workplace.levels;
  if (!cur || cur.floor < 1 || cur.floor >= rows.length) return 0;
  const from = rows[cur.floor - 1]?.points ?? 0;
  const next = rows[cur.floor];
  if (!next) return 0;
  return (cur.points - from) / (next.points - from) >= cfg.economy.autoBuy.saveFromGauge ? next.cost : 0;
}
