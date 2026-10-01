// 마을 레벨·공공시설·시청 (06 문서 6장, D24, 6.4 구현 메모). 하루 정산(economy settle)이 부른다:
// 레벨업 → 일터 층 → 자동 구매 → 공공시설 하나. 순수: 시각은 이벤트, id는 종류·순번
import { ERAS, type Era, type GameConfig } from '../config/config';
import { findLot, MAP, PLAZA_RIM, roadsideSpots, zoneOf, type Lot, type Zone } from '../layout/lots';
import { nextId } from '../projector/project';
import type { PublicWork, VillageState, WorkKind } from '../projector/types';
import { occupiedLots } from './growth';

/** 마을 전체 일 점수 (6.1) = 팀원 일터 점수 합. 팀원 몫만(외부인·팀장은 일터에 안 쌓인다, 5.2), 내려가지 않는다 */
export const villagePoints = (s: VillageState) =>
  Math.round(Object.values(s.buildings).reduce((a, b) => a + b.points, 0) * 1e6) / 1e6;

/** 그날 팀장 토큰값 청구 (6.4 기금 우선): 레벨업·공공시설은 이만큼 남기고 낸다 — 다음 팀장 턴에 시청 적자가 켜지지 않게 */
const leaderBill = (s: VillageState) => s.economy.today.leaderTokens + s.economy.today.leaderUnpaid;

/** 지금 레벨 줄·다음 레벨 줄(최고면 null)·점수·기금·남길 팀장 토큰값 (상단 바 레벨 칸: 기금 조건 = 공사비 + bill, 06 문서 13장·6.4) */
export function levelOf(s: VillageState, cfg: GameConfig) {
  const rows = cfg.village.levels;
  const cur = rows[Math.min(s.level, rows.length) - 1] ?? { points: 0, cost: 0, era: 'village' };
  return {
    level: s.level,
    era: cur.era as Era,
    cur,
    next: rows[s.level] ?? null,
    points: villagePoints(s),
    fund: s.economy.fund,
    bill: leaderBill(s),
  };
}

/** 시청 층 (6.3) = 시대 순서: 모래섬 마을 1 · 읍 2 · 도시 3 · 수도 4(해저 궁전, 3×3) */
export const hallFloor = (s: VillageState, cfg: GameConfig) => ERAS.indexOf(levelOf(s, cfg).era) + 1;

/** 레벨업 (6.1·6.4): 마을 전체 일 점수 ≥ 다음 레벨 점수이고 기금 ≥ 공사비 + 그날 팀장 토큰값 청구면 공사비를 내고 +1.
 *  여러 레벨도 차례로(레벨마다 공사비·알림). 레벨마다 섬 사방 4칸(maxRing까지), 입주한 팀원(팀장 포함) 모두 환호.
 *  글자는 테마 없이 — 화면이 ref로 이름 사전에서. 마지막 레벨의 두 번째 랜드마크는 같은 정산의 buildPublicWork가 짓는다 */
export function levelUp(s: VillageState, at: number, cfg: GameConfig): void {
  const points = villagePoints(s);
  const ec = s.economy;
  for (;;) {
    const next = cfg.village.levels[s.level];
    if (!next || points < next.points || ec.fund < next.cost + leaderBill(s)) return;
    ec.fund -= next.cost;
    ec.today.works += next.cost;
    s.level++;
    s.ring = Math.max(s.ring, Math.min(cfg.layout.maxRing, s.ring + 1));
    for (const m of Object.values(s.members))
      if (m.movedInAt !== null && !m.departed) m.cheerUntil = at + cfg.buildings.cheerMs;
    const text = `마을 레벨 Lv.${s.level}`;
    const ref = `@level:${s.level}:${next.era}`;
    s.feed.push({ at, kind: 'task', text, ref });
    s.toasts.push({ id: nextId(s, 'toast'), at, kind: 'complete', text, sticky: false, ref });
  }
}

const SMALL = new Set<string>(['streetlamp', 'bench', 'flowers']);
const KINDS = new Set<string>([...SMALL, 'park', 'paving', 'landmark']);
const OPPOSITE: Record<Zone, Zone> = { north: 'south', south: 'north', east: 'west', west: 'east' };
/** 자리 + 그 자리를 쓰려면 넓혀야 하는 섬 단계 (짓기 전엔 상태를 안 바꾼다 — 못 사는 것 때문에 섬이 넓어지지 않게) */
type Place = Pick<PublicWork, 'spot' | 'lot'> & { ring: number };

/** 여러 구역 중 광장에 가장 가까운 빈 3×3 (6.2 공원·랜드마크). 모자라면 섬을 넓힌 자리에서 다시, maxRing까지 없으면 null */
function placeNear(s: VillageState, zones: Zone[], cfg: GameConfig): Place | null {
  const d = (l: Lot) => Math.hypot(l.x + 1.5 - MAP / 2, l.y + 1.5 - MAP / 2);
  const occupied = occupiedLots(s);
  for (let ring = s.ring; ring <= Math.max(s.ring, cfg.layout.maxRing); ring++) {
    const lot = zones
      .flatMap((z) => findLot(z, occupied, ring, 3) ?? [])
      .sort((a, b) => d(a) - d(b) || a.y - b.y || a.x - b.x)[0];
    if (lot) return { spot: null, lot, ring };
  }
  return null;
}

/** 자리 (6.4): 소품 = 비어 있는 첫 칸(가로등 길가, 벤치·꽃밭 광장 둘레), 공원 = 광장에 가장 가까운 빈 3×3,
 *  랜드마크 둘 = 다른 하나가 있으면 그 반대 구역, 없으면 광장에 가장 가까운 빈 3×3 (어느 쪽이 먼저 생겨도 마주 본다),
 *  길 포장 = 자리 없음. 둘 데가 없으면 undefined — 사지 않는다 (3.2 규칙 4) */
function placeFor(s: VillageState, kind: WorkKind, cfg: GameConfig): Place | undefined {
  if (kind === 'paving') return { spot: null, lot: null, ring: s.ring };
  if (SMALL.has(kind)) {
    const taken = new Set(s.publicWorks.flatMap((w) => (w.spot ? [`${w.spot.x},${w.spot.y}`] : [])));
    const xy = (kind === 'streetlamp' ? roadsideSpots(s.ring) : PLAZA_RIM).find(([x, y]) => !taken.has(`${x},${y}`));
    return xy && { spot: { x: xy[0], y: xy[1] }, lot: null, ring: s.ring };
  }
  const pair = kind === 'landmark' ? 'landmark2' : kind === 'landmark2' ? 'landmark' : null;
  const other = pair && s.publicWorks.find((w) => w.kind === pair)?.lot;
  const zones: Zone[] = other ? [OPPOSITE[zoneOf(other)]] : ['north', 'east', 'south', 'west'];
  return placeNear(s, zones, cfg) ?? undefined;
}

/** 짓기: 기금에서 값을 내고 기록·알림 (6.4: 한 번짜리는 토스트도, 소품은 활동 기록만). 자리 때문에 섬이 넓어지면 여기서 */
function build(s: VillageState, kind: WorkKind, cost: number, { ring, ...place }: Place, day: number, at: number) {
  s.ring = Math.max(s.ring, ring);
  const n = s.publicWorks.filter((w) => w.kind === kind).length + 1;
  s.publicWorks.push({ id: SMALL.has(kind) ? `${kind}:${n}` : kind, kind, day, cost, ...place });
  s.economy.fund -= cost;
  s.economy.today.works += cost;
  const text = cost ? `마을 기금으로 공공시설을 지었어요 · ${cost}` : '레벨업으로 공공시설이 생겼어요';
  const ref = `@work:${kind}:${cost}`;
  s.feed.push({ at, kind: 'economy', text, ref });
  if (!SMALL.has(kind)) s.toasts.push({ id: nextId(s, 'toast'), at, kind: 'complete', text, sticky: false, ref });
}

/** 공공시설 하나 (6.2·6.4). 다음 레벨 점수가 찼으면(레벨업 공사비 대기) 모은다. 마지막 레벨이면 두 번째 랜드마크(값 0, 레벨업에 포함)부터 —
 *  자리가 없던 날이 있어도 날마다 다시 본다. 그다음 열린 한 번짜리를 목록 순서로, 그다음 소품을 가로등 → 벤치 → 꽃밭 차례로.
 *  자리 없는 것은 건너뛰고(값이 커도 다른 것을 막지 않게), 자리 있는 차례의 값이 남는 기금(= 기금 − 그날 팀장 토큰값 청구)보다 크면 모은다 */
export function buildPublicWork(s: VillageState, day: number, at: number, cfg: GameConfig): void {
  const next = cfg.village.levels[s.level];
  if (next && villagePoints(s) >= next.points) return;
  const spare = s.economy.fund - leaderBill(s);
  const built = (id: string) => s.publicWorks.some((w) => w.kind === id);
  const capital = s.level > 1 && !next && !built('landmark2') ? [{ id: 'landmark2', cost: 0 }] : [];
  const open = cfg.publicWorks.filter((r) => r.level <= s.level && KINDS.has(r.id));
  const once = [...capital, ...open.filter((r) => !SMALL.has(r.id) && !built(r.id))];
  const small = open.filter((r) => SMALL.has(r.id));
  const k = s.publicWorks.filter((w) => SMALL.has(w.kind)).length;
  for (const r of [...once, ...small.map((_, i) => small[(k + i) % small.length])]) {
    if (!r) continue;
    const place = placeFor(s, r.id as WorkKind, cfg);
    if (!place) continue;
    if (r.cost > 0 && r.cost > spare) return;
    build(s, r.id as WorkKind, r.cost, place, day, at);
    return;
  }
}
