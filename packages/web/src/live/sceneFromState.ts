// VillageState → 그릴 장면 (순수). 상태는 정본(잔디) id, 그림은 바다 id — theme-map.sea.json으로 옮긴다 (05 문서 3.1).
import {
  currentWorkplace,
  hallFloor,
  isPlaza,
  isRoad,
  LEADER_ID,
  lotTiles,
  MAP,
  mapOffset,
  mapSize,
  type Building as Workplace,
  type Facility,
  type GameConfig,
  type Lot,
  type Member,
  type MemberStatus,
  type Slot,
  type VillageState,
  type VisitorKind,
  slotTone,
} from '@tycoon/core';
import sea from '../../../../design/theme-map.sea.json';
import type { Stage } from '../assets/sea/Building';
import { t } from '../i18n';
import type { Role } from '../render/critterSvg';
import { SPECIES, type SpeciesId } from '../render/rig';
import type { Owner } from '../world/OwnerSign';
import type { SceneBuilding, SceneProp } from '../world/Village';

const seaId = (group: 'body' | 'roof' | 'species' | 'accessory' | 'prop', id: string) =>
  (sea[group] as Record<string, string>)[id] ?? id;

export interface LiveScene {
  /** 그리는 한 변 타일 수 = 16 + 8·ring (D10). 좌표는 모두 off만큼 민 그리기 좌표 */
  map: number;
  /** 상태 좌표 → 그리기 좌표로 더하는 양 (4·ring). 상태의 부지·시설·집 좌표를 쓸 때 더한다 */
  off: number;
  /** 장면 건물. 일터(`work:<일터 id>`)는 floor(0~4)·badge(임시 층 배지 글자)·foot 3(큰 건물: x·y = 3×3 가운데 − 1) */
  buildings: (SceneBuilding & { id: string; floor?: number; badge?: string; foot?: 3 })[];
  props: SceneProp[];
  /** MAP×MAP, 1 = 지나갈 수 없음 (부지, 광장 가구) */
  blocked: Uint8Array;
  /** 일터 게이지 (06 문서 5.2): 1층 이상 + 주인이 일하는 중. building = buildings 인덱스, pct = 일 점수 ÷ 다음 층 점수 */
  gauges: { building: number; pct: number; label: string }[];
  /** 마을을 세웠나 (01 문서 3.3): 아니면 빈 모래섬 — 광장·길 바닥과 광장 가구가 없다 */
  founded: boolean;
  /** 길 포장 (06 문서 6.2): 십자 길 바닥을 광장 돌로 */
  paved: boolean;
  /** 마을 레벨 — 오르면 섬 가운데 거품 */
  level: number;
}

// 캔버스 바다 09 (fixtures/village-demo.json)의 시설 3채 모양
const FACILITY: Record<Facility, { body: string; roof: string }> = {
  library: { body: 'basalt-2f', roof: 'scallop' },
  plan: { body: 'wreck-2f', roof: 'conch' },
  agency: { body: 'coral-1f', roof: 'dome' },
};
// 캔버스 바다 09 집 4채 (슬롯 순). 5번째부터 되풀이
const HOUSE = [
  ['shell-1f', 'dome'],
  ['coral-1f', 'scallop'],
  ['shell-1f', 'scallop'],
  ['coral-1f', 'dome'],
] as const;
// 광장 가구 (캔버스 바다 09 그대로). 가구 칸은 못 지나간다
const PLAZA: SceneProp[] = [
  { x: 7, y: 7, kind: 'clamfountain' },
  { x: 6, y: 8, kind: 'board' },
  { x: 9, y: 6, kind: 'bench' },
  { x: 10, y: 6, kind: 'jellypost' },
  { x: 9, y: 10, kind: 'jellypost' },
  { x: 9, y: 13, kind: 'jellypost' },
];
// 공원 임시 그림 (06 문서 14장·6.4, M15 전): 3×3에 놓는 그림 전용 소품 — 바다 id 그대로(DECOR처럼, 상태엔 종류 `park`만).
// 앞 가운데 (1, 2)는 들어가는 길로 비운다
const PARK: readonly [number, number, string][] = [
  [0, 0, 'kelp'],
  [1, 0, 'seagrass'],
  [2, 0, 'kelp'],
  [0, 1, 'anemone'],
  [1, 1, 'bench'],
  [2, 1, 'anemone'],
  [0, 2, 'seagrass'],
  [2, 2, 'braincoral'],
];
// 랜드마크 임시 그림 (6.4): 2층 몸통 + 지붕을 3×3 가운데 + 이름 배지. 정본 몸통·지붕 id — 그릴 때 seaId로 바다 그림
const LANDMARK = {
  landmark: { body: 'stone-2f', roof: 'flat' }, // 현무암 + 소라 = 등대
  landmark2: { body: 'brick-2f', roof: 'hip' }, // 난파선 목재 + 성게 돔 = 소라 탑
} as const;
// 바닥 장식 (02 문서 8.1 + 바다 extras). 같은 종류를 여러 번 = 가중치
const DECOR = [
  'kelp',
  'kelp',
  'kelp',
  'seagrass',
  'seagrass',
  'seagrass',
  'coral',
  'coral',
  'braincoral',
  'braincoral',
  'anemone',
  'anemone',
  'rock',
  'rock',
  'starfish',
  'starfish',
  'urchin',
  'urchin',
  'chest',
];
const SWAY = new Set(['kelp', 'seagrass', 'anemone']);
export const DECOR_DENSITY = 0.16;

/** 칸마다 고정된 난수 0~1 (건물이 들어와도 다른 칸 장식은 그대로) */
export function tileRand(x: number, y: number, seed: number) {
  let h = Math.imul(x + 1, 0x27d4eb2d) ^ Math.imul(y + 1, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const seedOf = (s: string) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261);

/** 부지 앞 칸 (문은 왼쪽 앞 벽, y+n 줄) → 오른쪽 앞 → 옆 → 뒤 순서. n = 부지 한 변 (큰 건물 3). 섬 밖(한 변 M, 그리기 좌표)은 뺀다 */
export const frontTiles = (l: Lot, M = MAP, n = 2) =>
  (
    [
      [l.x, l.y + n],
      [l.x + 1, l.y + n],
      [l.x + n, l.y + 1],
      [l.x + n, l.y],
      [l.x - 1, l.y + 1],
      [l.x - 1, l.y],
      [l.x, l.y - 1],
      [l.x + 1, l.y - 1],
    ] as [number, number][]
  ).filter(([x, y]) => x >= 0 && y >= 0 && x < M && y < M);

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

/** 0층 일터 그림 (06 문서 5.1): 첫 일에서 도구를 쓰기 전엔 예정 부지, 쓰면 기초. 일터 상세도 같이 쓴다 */
export const siteStage = (s: VillageState, b: Workplace): Stage =>
  (s.runs[s.members[b.memberId]?.currentRunId ?? '']?.toolCalls ?? 0) > 0 ? 'foundation' : 'planned';

/** 일터 모양 (06 문서 5.3·14장): 2층부터 2층 몸통, 3층·큰 건물은 임시 배지, 주인이 일하면 비계, 1층부터 얼굴 간판·이름표 */
function workLook(b: Workplace, s: VillageState, cfg: GameConfig) {
  const m = s.members[b.memberId];
  const preset = cfg.jobPresets.find((p) => p.id === m?.job) ?? cfg.fallbackPreset;
  const working = !!m?.currentRunId;
  const big = b.floor >= cfg.workplace.levels.length;
  const stage: Stage = b.floor > 0 ? 'done' : siteStage(s, b);
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

export function sceneFromState(s: VillageState, cfg: GameConfig): LiveScene {
  // 섬 넓히기 (D10, 02 문서 8.1): 상태 좌표는 [-off, 16 + off) → 그리기 좌표 [0, M)
  const M = mapSize(s.ring ?? 0);
  const off = mapOffset(s.ring ?? 0);
  const sh = (l: Lot) => ({ x: l.x + off, y: l.y + off });
  const buildings: LiveScene['buildings'] = [];
  // 시설은 그 외부인이 처음 올 때 생긴다 (01 문서 3.3)
  for (const f of ['library', 'plan', 'agency'] as Facility[]) {
    const l = s.facilities[f];
    if (l) buildings.push({ id: `facility:${f}`, ...sh(l), ...FACILITY[f], sign: f, slot: 'x', stage: 'done' });
  }
  for (const h of Object.values(s.houses)) {
    const m = s.members[h.memberId];
    if (!m) continue;
    const [body, roof] = HOUSE[(m.slot - 1) % HOUSE.length] ?? HOUSE[0];
    buildings.push({
      id: `house:${m.id}`,
      ...sh(h.lot),
      body,
      roof,
      sign: 'home',
      slot: slotTone(m.slot),
      departed: m.departed,
      owner: ownerOf(m, t('owner.leaderHouse')),
    });
  }
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
        // 내림: 문턱 전(74.8 / 75)에 100%·"75 / 75"로 보이지 않게
        pct: Math.min(100, Math.floor((b.points / next.points) * 100)),
        label: t('world.gauge', {
          name: workplaceName(s, cfg, b),
          points: Math.floor(b.points).toLocaleString('ko-KR'),
          next: next.points.toLocaleString('ko-KR'),
        }),
      });
  }
  // 시청 (06 문서 6.3, 14장 임시 그림 = 회관): 1·2층은 부지 왼쪽 위 2×2, 3층은 2층 + 배지, 해저 궁전은 3×3 가운데 + 배지
  if (s.hall) {
    const lead = cfg.jobPresets.find((p) => p.id === 'lead') ?? cfg.fallbackPreset;
    const f = hallFloor(s, cfg);
    const p = sh(s.hall);
    const leader = s.members[LEADER_ID];
    buildings.push({
      id: 'hall',
      ...(f >= 4 ? { x: p.x + 0.5, y: p.y + 0.5, foot: 3 as const } : p),
      floor: f,
      body: seaId('body', f >= 2 ? lead.body2f : lead.body1f),
      roof: seaId('roof', lead.roof),
      sign: lead.sign,
      slot: leader ? slotTone(leader.slot) : 'x',
      stage: 'done',
      owner: leader ? ownerOf(leader, t('owner.hall')) : undefined,
      badge: f >= 4 ? t('works.palace') : f === 3 ? t('workplace.floor.3') : undefined,
    });
  }
  // 랜드마크 (6.2): 3×3 가운데 임시 그림 + 이름 배지
  for (const w of s.publicWorks)
    if (w.lot && (w.kind === 'landmark' || w.kind === 'landmark2')) {
      const p = sh(w.lot);
      buildings.push({
        id: `public:${w.id}`,
        x: p.x + 0.5,
        y: p.y + 0.5,
        foot: 3,
        body: seaId('body', LANDMARK[w.kind].body),
        roof: seaId('roof', LANDMARK[w.kind].roof),
        sign: 'none',
        slot: 'x',
        stage: 'done',
        badge: t(`works.${w.kind}`),
      });
    }

  const blocked = new Uint8Array(M * M);
  const taken = new Uint8Array(M * M); // 장식을 두면 안 되는 칸
  const mark = (g: Uint8Array, x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < M && y < M) g[y * M + x] = 1;
  };
  for (const b of buildings) {
    // 큰 건물은 3×3, 나머지 2×2 (x·y가 가운데 − 1이라 0.5를 되돌림)
    const lot = b.foot ? { x: b.x - 0.5, y: b.y - 0.5, size: 3 as const } : { x: b.x, y: b.y };
    for (const [x, y] of lotTiles(lot)) mark(blocked, x, y);
    for (const [x, y] of frontTiles(lot, M, b.foot ?? 2).slice(0, 2)) mark(taken, x, y); // 문 앞·작업 자리는 비워 둔다
  }
  // 일터 3×3 예약 (06 문서 5.1): 앞마당엔 장식을 두지 않는다 (걸을 수는 있다)
  for (const w of works) for (const [x, y] of lotTiles({ ...sh(w.lot), size: 3 })) mark(taken, x, y);
  // 시청·공원·랜드마크 3×3과 둘레 한 칸엔 장식을 두지 않는다 — 얼굴 간판·공원 소품이 장식에 묻히지 않게 (M14 검토)
  const clear = (l: Lot) => {
    const p = sh(l);
    for (let dy = -1; dy <= 3; dy++) for (let dx = -1; dx <= 3; dx++) mark(taken, p.x + dx, p.y + dy);
  };
  if (s.hall) clear(s.hall);
  for (const w of s.publicWorks) if (w.lot) clear(w.lot);
  const founded = s.foundedAt !== null;
  const plaza = founded ? PLAZA.map((p) => ({ ...p, ...sh(p) })) : [];
  const props: SceneProp[] = [...plaza];
  for (const p of plaza) {
    const n = p.kind === 'clamfountain' ? 2 : 1;
    for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) mark(blocked, p.x + dx, p.y + dy);
  }
  const free = (x: number, y: number) =>
    x >= 0 &&
    y >= 0 &&
    x < M &&
    y < M &&
    !blocked[y * M + x] &&
    !taken[y * M + x] &&
    !(founded && (isRoad(x - off, y - off) || isPlaza(x - off, y - off))); // 빈 섬이면 길 자리에도 장식 (길이 생기면 치운다)
  // 공공시설 (06 문서 6.2·6.4): 소품은 규칙이 정한 칸, 공원은 3×3에 임시 소품. 소품 칸은 못 지나간다 (공원 앞 가운데는 지나감)
  for (const w of s.publicWorks) {
    if (w.spot) {
      const x = w.spot.x + off;
      const y = w.spot.y + off;
      props.push({ x, y, kind: seaId('prop', w.kind) });
      mark(blocked, x, y);
    } else if (w.kind === 'park' && w.lot) {
      const p = sh(w.lot);
      for (const [dx, dy, kind] of PARK) {
        const x = p.x + dx;
        const y = p.y + dy;
        props.push(SWAY.has(kind) ? { x, y, kind, phase: (x + y) % 2 } : { x, y, kind });
        mark(blocked, x, y);
      }
    }
  }
  // 주인이 일하는 일터 앞마당의 자재 더미 (캔버스 바다 09): 3×3 부지 오른쪽 줄 뒤 칸 (x + 2, y) — 자기 부지라 늘 비어 있고,
  // 앞 모서리(x + 2, y + 2)는 이름표에 가려서 (M13 스크린샷). 예정 부지·큰 건물은 없음. 못 지나간다
  for (const b of buildings)
    if (b.id.startsWith('work:') && !b.foot && (b.scaffold || b.stage === 'foundation')) {
      props.push({ x: b.x + 2, y: b.y, kind: 'materials' });
      mark(blocked, b.x + 2, b.y); // 더미 위에 서지 않게 (광장 소품처럼)
    }
  const seed = seedOf(s.project);
  // 난수는 상태 좌표로 — 섬이 넓어져도 있던 장식은 제자리
  for (let y = 0; y < M; y++)
    for (let x = 0; x < M; x++) {
      if (!free(x, y) || tileRand(x - off, y - off, seed) >= DECOR_DENSITY) continue;
      const kind = DECOR[Math.floor(tileRand(x - off, y - off, seed + 1) * DECOR.length)] ?? 'seagrass';
      props.push(SWAY.has(kind) ? { x, y, kind, phase: (x + y) % 2 } : { x, y, kind });
    }
  return {
    map: M,
    off,
    buildings,
    props,
    blocked,
    gauges,
    founded,
    paved: s.publicWorks.some((w) => w.kind === 'paving'),
    level: s.level,
  };
}

/** 마을에 그릴 캐릭터 한 명 (팀원 또는 외부인) */
export interface Actor {
  id: string; // memberId | 외부인 runId
  name: string; // 팀원 이름 (md name) | 외부인 agent type
  species: SpeciesId;
  variant?: number; // 자동 변형 (D16)
  accessory?: string;
  role?: Role; // 복어 모자 색
  slot: Slot | 'x';
  /** 'visiting' = 시설 옆에서 대기하는 외부인 */
  status: MemberStatus | 'visiting';
  heavy: boolean; // 도구를 많이 씀 → 망치질과 나르기 번갈아 (01 문서 4장)
  cheerUntil: number | null;
  taskId: string | null;
  isLeader: boolean;
  visitor?: { kind: VisitorKind; facility: Facility };
  tag?: string; // 외부인 이름표 (agent type 그대로)
}

// ponytail: "도구 사용이 많으면"의 기준이 문서에 없다. 실행 하나에 10번. 조정하려면 game.default.json으로
export const HEAVY_TOOL_CALLS = 10;

/** 정본 종·소품 id → 바다 그림 id (05 문서 3.1). 팀원 패널 얼굴도 같이 쓴다 */
export const toSpecies = (canon: string): SpeciesId => {
  const id = seaId('species', canon);
  return (SPECIES as string[]).includes(id) ? (id as SpeciesId) : 'seal';
};
export const toAccessory = (canon: string | null) => (canon === null ? 'none' : seaId('accessory', canon));

/**
 * 건물 주인 표시 (06 문서 7장): 얼굴 간판 + 이름표. 이름표 = 팀원 이름, 팀장은 leaderTag ("팀장의 집" — 일터·시청은 M13·M14가 넘긴다)
 */
export const ownerOf = (m: Member, leaderTag: string): Owner => ({
  memberId: m.id,
  species: toSpecies(m.species),
  variant: m.variant,
  accessory: toAccessory(m.accessory),
  slot: slotTone(m.slot),
  tag: m.isLeader || m.id === LEADER_ID ? leaderTag : m.name,
});

/** 지금 보여 줄 캐릭터. now는 화면 쪽 시계 (회의가 끝났는데 다음 이벤트가 아직 없을 때 상태를 맞춘다) */
export function actorsFromState(s: VillageState, cfg: GameConfig, now: number): Actor[] {
  const meetingOn = !!s.meeting && now < s.meeting.until;
  const members = Object.values(s.members)
    .filter((m) => !m.departed && m.movedInAt !== null) // 입주 전은 마을에 없다 (01 문서 3.3)
    .sort((a, b) => a.slot - b.slot || (a.id < b.id ? -1 : 1));
  const out: Actor[] = members.map((m) => ({
    id: m.id,
    name: m.name,
    species: toSpecies(m.species),
    variant: m.variant,
    accessory: toAccessory(m.accessory),
    slot: slotTone(m.slot),
    status: m.status === 'meeting' && !meetingOn ? (m.currentRunId ? 'working' : 'resting') : m.status,
    heavy: (s.runs[m.currentRunId ?? '']?.toolCalls ?? 0) >= HEAVY_TOOL_CALLS,
    cheerUntil: m.cheerUntil,
    taskId: m.currentTaskId,
    isLeader: m.isLeader || m.id === LEADER_ID,
  }));
  const site = activeSite(s);
  for (const v of Object.values(s.visitors).sort((a, b) => a.startedAt - b.startedAt || (a.runId < b.runId ? -1 : 1))) {
    const vc = cfg.visitors[v.kind] as { cap: string; helpsConstruction?: boolean } | undefined;
    out.push({
      id: v.runId,
      name: v.kind,
      species: toSpecies('visitor'),
      role: (vc?.cap ?? 'general') as Role,
      slot: 'x',
      status: vc?.helpsConstruction && site ? 'working' : 'visiting',
      heavy: (s.runs[v.runId]?.toolCalls ?? 0) >= HEAVY_TOOL_CALLS,
      cheerUntil: null,
      taskId: null,
      isLeader: false,
      visitor: { kind: v.kind, facility: v.facility },
      tag: v.kind,
    });
  }
  return out;
}
