import { readFileSync } from 'node:fs';
import {
  findLot,
  initialState,
  isPlaza,
  isRoad,
  makeConfig,
  MAP,
  moveInAll,
  occupiedLots,
  project,
  slotTone,
  type AgentRun,
  type Building,
  type VillageState,
} from '@tycoon/core';
import { expect, test } from 'vitest';
import { actorsFromState, sceneFromState } from './sceneFromState';
import { fullVillage } from '../test/village';

/** 다 자란 마을 (시설 3채·슬롯 순 집·모두 입주): 그리기·이동 논리만 본다 — 자라는 순서는 core growth.test */
const golden = () =>
  fullVillage(
    JSON.parse(
      readFileSync(new URL('../../../../fixtures/sample-session.golden.json', import.meta.url), 'utf8'),
    ) as VillageState,
  );
const cfg = makeConfig();

const DECOR_KINDS = new Set([
  'kelp',
  'seagrass',
  'coral',
  'braincoral',
  'anemone',
  'rock',
  'starfish',
  'urchin',
  'chest',
]);
/** 3×3 부지(그리기 좌표 x·y) 둘레 한 칸에 놓인 장식 — 시청 얼굴 간판·공원 소품이 장식에 묻히지 않게 비워 둔다 */
const decorRing = (sc: { props: { x: number; y: number; kind: string }[] }, x: number, y: number) =>
  sc.props.filter(
    (p) =>
      DECOR_KINDS.has(p.kind) &&
      p.x >= x - 1 &&
      p.x <= x + 3 &&
      p.y >= y - 1 &&
      p.y <= y + 3 &&
      !(p.x >= x && p.x < x + 3 && p.y >= y && p.y < y + 3),
  );

const lotTiles = (b: { x: number; y: number }) => [
  [b.x, b.y],
  [b.x + 1, b.y],
  [b.x, b.y + 1],
  [b.x + 1, b.y + 1],
];

test('골든 상태: 시설 북쪽, 집 서쪽, 일한 팀원마다 일터 (qa-reviewer 1층 남, backend-dev 공사 현장 동)', () => {
  const s = golden();
  const sc = sceneFromState(s, cfg);
  const kind = (k: string) => sc.buildings.filter((b) => b.id.startsWith(k));
  expect(kind('facility:').map((b) => [b.sign, b.body, b.roof, b.slot])).toEqual([
    ['library', 'basalt-2f', 'scallop', 'x'],
    ['plan', 'wreck-2f', 'conch', 'x'],
    ['agency', 'coral-1f', 'dome', 'x'],
  ]);
  for (const b of kind('facility:')) expect(b.x < 6 && b.y < 6).toBe(true);
  const houses = kind('house:');
  expect(houses).toHaveLength(4);
  for (const h of houses) {
    expect(h.x < 6 && h.y >= 10).toBe(true);
    expect(h.sign).toBe('home');
  }
  expect(houses.find((h) => h.id === 'house:backend-dev')?.slot).toBe(2);
  const qa = sc.buildings.find((b) => b.id === 'work:w1:qa-reviewer');
  const be = sc.buildings.find((b) => b.id === 'work:w1:backend-dev');
  expect(qa).toMatchObject({
    x: 10,
    y: 10,
    stage: 'done',
    floor: 1,
    slot: slotTone(s.members['qa-reviewer']?.slot ?? 0),
  });
  expect(qa?.owner).toMatchObject({ memberId: 'qa-reviewer', tag: 'qa-reviewer' });
  expect(be).toMatchObject({ x: 10, y: 3, floor: 0, owner: undefined });
  expect(['planned', 'foundation']).toContain(be?.stage);
  expect(sc.gauges).toEqual([]); // 게이지는 1층 이상 + 주인이 일하는 동안만
  expect(sc.props.some((p) => p.kind === 'materials')).toBe(be?.stage === 'foundation');
});

test('장식은 부지·길·광장에 없고, 같은 상태면 같은 자리 (seed)', () => {
  const s = golden();
  const sc = sceneFromState(s, cfg);
  const lots = new Set(sc.buildings.flatMap((b) => lotTiles(b).map(([x, y]) => `${x},${y}`)));
  const decor = sc.props.filter((p) => !['clamfountain', 'board', 'bench', 'jellypost', 'materials'].includes(p.kind));
  expect(decor.length).toBeGreaterThan(5);
  for (const p of decor) {
    expect(lots.has(`${p.x},${p.y}`)).toBe(false);
    expect(isRoad(p.x, p.y) || isPlaza(p.x, p.y)).toBe(false);
    expect(p.x >= 0 && p.y >= 0 && p.x < MAP && p.y < MAP).toBe(true);
  }
  expect(sceneFromState(golden(), cfg).props).toEqual(sc.props);
  // 바다 extras가 나온다 (seed에 따라 종류가 갈리지만 전체 중 몇은)
  const kinds = new Set(decor.map((p) => p.kind));
  expect(['seagrass', 'rock', 'chest', 'starfish', 'urchin'].some((k) => kinds.has(k))).toBe(true);
});

test('건물이 들어오면 그 칸 장식만 치운다', () => {
  const s = golden();
  const before = sceneFromState(s, cfg).props;
  const lot = { x: 13, y: 13, size: 3 as const };
  s.buildings['w1:frontend-dev'] = {
    ...(s.buildings['w1:qa-reviewer'] as Building),
    id: 'w1:frontend-dev',
    memberId: 'frontend-dev',
    lot,
    startedAt: 9e12,
  };
  const after = sceneFromState(s, cfg).props;
  const inLot = (p: { x: number; y: number }) => p.x >= 13 && p.x <= 15 && p.y >= 13 && p.y <= 15; // 3×3 예약 전부
  expect(after.filter(inLot).filter((p) => p.kind !== 'materials')).toEqual([]);
  const key = (p: { x: number; y: number; kind: string }) => `${p.kind}@${p.x},${p.y}`;
  const kept = new Set(after.map(key));
  for (const p of before.filter((p) => !inLot(p) && p.kind !== 'materials')) expect(kept.has(key(p))).toBe(true);
});

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
  const next = cfg.workplace.levels[2]?.points ?? 0; // 3층 문턱 (설정값, 06 문서 5.3)
  qa.points = Math.round(next * 0.44);
  const m = s.members['qa-reviewer'];
  const done = Object.values(s.runs).find((r) => r.memberId === 'qa-reviewer') as AgentRun;
  if (!m) throw new Error('qa-reviewer');
  s.runs.q9 = { ...done, runId: 'q9', endedAt: null };
  m.currentRunId = 'q9';
  const busy = sceneFromState(s, cfg);
  const i = busy.buildings.findIndex((b) => b.id === 'work:w1:qa-reviewer');
  expect(busy.buildings[i]).toMatchObject({ scaffold: true, stage: 'done' });
  expect(busy.gauges).toEqual([
    {
      building: i,
      pct: 44,
      label: `qa-reviewer의 초소 일 점수 ${qa.points.toLocaleString('ko-KR')} / ${next.toLocaleString('ko-KR')}`,
    },
  ]);
  expect(busy.props).toContainEqual({ x: 12, y: 10, kind: 'materials' }); // 오른쪽 줄 뒤 칸 (앞 모서리는 이름표 자리)
  expect(busy.blocked[10 * busy.map + 12]).toBe(1); // 더미 위엔 서지 않는다

  // 점수는 내림: 문턱 바로 전(2층 문턱 − 0.2)엔 99%, 점수도 내림
  const two = cfg.workplace.levels[1]?.points ?? 0;
  Object.assign(qa, { floor: 1, points: two - 0.2 });
  expect(sceneFromState(s, cfg).gauges[0]).toMatchObject({
    pct: 99,
    label: `qa-reviewer의 초소 일 점수 ${(two - 1).toLocaleString('ko-KR')} / ${two.toLocaleString('ko-KR')}`,
  });
});

test('캐릭터: 정본 id → 바다 id, 외부인은 복어 + 모자 색 + 이름표', () => {
  const s = golden();
  s.visitors.v1 = { runId: 'v1', kind: 'Explore', facility: 'library', startedAt: 1 };
  s.visitors.v2 = { runId: 'v2', kind: 'general-purpose', facility: 'agency', startedAt: 2 };
  const a = actorsFromState(s, cfg, s.clock.now);
  expect(a.map((x) => [x.id, x.species, x.accessory, x.status])).toEqual([
    ['@leader', 'turtle', 'captainHat', 'resting'],
    ['backend-dev', 'seal', 'headlamp', 'blocked'],
    ['frontend-dev', 'otter', 'starfishPin', 'resting'],
    ['qa-reviewer', 'hamster', 'headlamp', 'resting'],
    ['v1', 'fish', undefined, 'visiting'],
    ['v2', 'fish', undefined, 'working'], // 공사 돕기 (일하는 backend-dev의 일터)
  ]);
  expect(a[4]).toMatchObject({ role: 'explore', tag: 'Explore' });
  expect(a[5]).toMatchObject({ role: 'general', tag: 'general-purpose' });
});

test('회의가 끝났는데 다음 이벤트가 없으면 화면 시계로 상태를 푼다', () => {
  const s = golden();
  s.meeting = { kind: 'prompt', startedAt: 0, until: 1000, preview: '', participants: ['@leader'] };
  const leader = s.members['@leader'];
  if (leader) leader.status = 'meeting';
  expect(actorsFromState(s, cfg, 500)[0]?.status).toBe('meeting');
  expect(actorsFromState(s, cfg, 1000)[0]?.status).toBe('resting');
});

test('시청 (06 문서 6.3·14장 임시 그림): 회관 그림 — Lv.1~3 1층, 4~6 2층, 7~9 2층 + "3층" 배지, 10 해저 궁전(3×3 가운데 + 배지), 팀장 얼굴 간판 "시청", 3×3과 둘레 한 칸엔 장식 없음', () => {
  const s = golden();
  s.facilities = {}; // fullVillage 시설이 시청 자리와 겹치지 않게
  s.hall = { x: 3, y: 3, size: 3 };
  const hallAt = (level: number) => {
    s.level = level;
    const sc = sceneFromState(s, cfg);
    return { sc, b: sc.buildings.find((x) => x.id === 'hall') };
  };
  const { sc, b } = hallAt(1);
  const o = sc.off;
  expect(b).toMatchObject({
    x: 3 + o,
    y: 3 + o,
    floor: 1,
    body: 'coral-1f',
    roof: 'scallop',
    stage: 'done',
    badge: undefined,
  });
  expect(b?.owner).toMatchObject({ memberId: '@leader', tag: '시청' });
  expect(hallAt(4).b).toMatchObject({ floor: 2, body: 'wreck-2f', badge: undefined });
  expect(hallAt(7).b).toMatchObject({ floor: 3, body: 'wreck-2f', badge: '3층' });
  expect(hallAt(10).b).toMatchObject({ x: 3.5 + o, y: 3.5 + o, foot: 3, floor: 4, badge: '해저 궁전' });
  for (let dy = 0; dy < 3; dy++)
    for (let dx = 0; dx < 3; dx++)
      expect(sc.props.some((p) => p.x === 3 + o + dx && p.y === 3 + o + dy && DECOR_KINDS.has(p.kind))).toBe(false);
  expect(decorRing(sc, 3 + o, 3 + o)).toEqual([]);
});

test('공공시설 (06 문서 6.2·14장): 소품은 상태 칸에 바다 그림(못 지나감), 공원 = 3×3 임시 소품(앞 가운데는 지나감), 랜드마크 = 3×3 가운데 + 이름 배지, 길 포장 = paved', () => {
  const s = golden();
  s.ring = Math.max(s.ring, 2);
  const free = () => {
    const l = findLot('south', occupiedLots(s), s.ring, 3);
    if (!l) throw new Error('자리');
    return l;
  };
  s.publicWorks.push(
    { id: 'streetlamp:1', kind: 'streetlamp', day: 1, cost: 100, spot: { x: 6, y: 4 }, lot: null },
    { id: 'bench:1', kind: 'bench', day: 2, cost: 100, spot: { x: 10, y: 9 }, lot: null },
    { id: 'flowers:1', kind: 'flowers', day: 3, cost: 100, spot: { x: 6, y: 10 }, lot: null },
  );
  s.publicWorks.push({ id: 'park', kind: 'park', day: 4, cost: 400, spot: null, lot: free() });
  s.publicWorks.push({ id: 'landmark', kind: 'landmark', day: 5, cost: 2000, spot: null, lot: free() });
  const sc = sceneFromState(s, cfg);
  const o = sc.off;
  const M = sc.map;
  const has = (x: number, y: number, kind: string) => sc.props.some((p) => p.x === x && p.y === y && p.kind === kind);
  for (const [x, y, kind] of [
    [6, 4, 'jellypost'],
    [10, 9, 'bench'],
    [6, 10, 'anemone'],
  ] as const) {
    expect(has(x + o, y + o, kind), kind).toBe(true);
    expect(sc.blocked[(y + o) * M + x + o]).toBe(1);
  }
  const park = s.publicWorks[3]?.lot;
  if (!park) throw new Error('공원');
  const px = park.x + o;
  const py = park.y + o;
  for (const [dx, dy, kind] of [
    [0, 0, 'kelp'],
    [1, 0, 'seagrass'],
    [2, 0, 'kelp'],
    [0, 1, 'anemone'],
    [1, 1, 'bench'],
    [2, 1, 'anemone'],
    [0, 2, 'seagrass'],
    [2, 2, 'braincoral'],
  ] as const)
    expect(has(px + dx, py + dy, kind), `${dx},${dy}`).toBe(true);
  expect(sc.blocked[(py + 2) * M + px + 1]).toBe(0); // 앞 가운데 = 들어가는 길
  const mark = s.publicWorks[4]?.lot;
  if (!mark) throw new Error('등대');
  expect(sc.buildings.find((b) => b.id === 'public:landmark')).toMatchObject({
    x: mark.x + o + 0.5,
    y: mark.y + o + 0.5,
    foot: 3,
    body: 'basalt-2f',
    roof: 'conch',
    slot: 'x',
    badge: '등대',
  });
  expect(decorRing(sc, px, py)).toEqual([]); // 공원·랜드마크 둘레 한 칸도 장식 없음
  expect(decorRing(sc, mark.x + o, mark.y + o)).toEqual([]);
  expect(sc.paved).toBe(false);
  s.publicWorks.push({ id: 'paving', kind: 'paving', day: 6, cost: 600, spot: null, lot: null });
  expect(sceneFromState(s, cfg).paved).toBe(true);
});

test('빈 모래섬 (01 문서 3.3): 세우기 전엔 광장 가구·시설·집·캐릭터 없음, 자연 장식은 길 자리에도', () => {
  const raw = JSON.parse(
    readFileSync(new URL('../../../../fixtures/sample-session.golden.json', import.meta.url), 'utf8'),
  ) as VillageState;
  const empty = { ...raw, foundedAt: null, hall: null, facilities: {}, houses: {}, buildings: {}, visitors: {} };
  for (const m of Object.values(empty.members)) m.movedInAt = null;
  const scene = sceneFromState(empty, cfg);
  expect([scene.founded, scene.buildings]).toEqual([false, []]);
  expect(scene.props.filter((p) => ['clamfountain', 'board', 'bench', 'jellypost'].includes(p.kind))).toEqual([]);
  expect(scene.props.some((p) => isRoad(p.x, p.y) || isPlaza(p.x, p.y))).toBe(true);
  expect(actorsFromState(empty, cfg, 0)).toEqual([]);
  // 골든 그대로: 세운 마을이지만 frontend-dev는 아직 입주 전 → 캐릭터 없음, 시설은 온 외부인 것만(탐사 기지)
  const grown = sceneFromState(raw, cfg);
  expect(grown.founded).toBe(true);
  expect(grown.buildings.filter((b) => b.id.startsWith('facility:')).map((b) => b.id)).toEqual(['facility:library']);
  expect(actorsFromState(raw, cfg, 0).map((a) => a.id)).not.toContain('frontend-dev');
});

test('섬 넓히기 (D10): 서쪽 집이 모자라 ring 1 → 한 변 24, 상태 좌표를 +4로 그린다, 있던 장식은 제자리', () => {
  const names = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
  const base = project(
    initialState('p', cfg),
    { t: 'RosterLoaded', at: 0, agents: names.map((name) => ({ name, description: '' })), tycoon: null },
    cfg,
  );
  const small = sceneFromState({ ...structuredClone(base), foundedAt: 0 }, cfg); // 세운 마을, 넓히기 전
  const s = moveInAll(base, 0, cfg); // 팀장 + 6명 = 집 7채 → 16×16 서쪽(4채)을 넘는다
  expect(s.ring).toBe(1);
  expect(Math.min(...Object.values(s.houses).map((h) => h.lot.x))).toBeLessThan(0); // 음수 좌표 부지
  const scene = sceneFromState(s, cfg);
  expect([scene.map, scene.off]).toEqual([24, 4]);
  for (const b of scene.buildings) expect(b.x >= 0 && b.y >= 0 && b.x + 1 < 24 && b.y + 1 < 24).toBe(true);
  expect(scene.blocked).toHaveLength(24 * 24);
  // 광장 분수는 광장 가운데 (상태 (7, 7) → 그리기 (11, 11))
  expect(scene.props.find((p) => p.kind === 'clamfountain')).toMatchObject({ x: 11, y: 11 });
  // 넓히기 전 장식은 (집이 들어온 칸을 빼고) 4칸 밀린 자리에 그대로
  const now = new Set(scene.props.map((p) => `${p.kind}@${p.x},${p.y}`));
  const kept = small.props.filter((p) => !['clamfountain', 'board', 'bench', 'jellypost'].includes(p.kind));
  const moved = kept.filter((p) => now.has(`${p.kind}@${p.x + 4},${p.y + 4}`));
  expect(moved.length).toBeGreaterThan(kept.length * 0.7);
});

test('집 주인 표시 (06 문서 7장): 집마다 주인 얼굴(바다 종·변형·소품)·슬롯 색·이름표, 팀장은 "팀장의 집", 떠나면 흐리게', () => {
  const s = golden();
  const m = s.members['qa-reviewer'];
  if (!m) throw new Error('qa-reviewer');
  m.variant = 3;
  m.departed = true;
  const houses = sceneFromState(s, cfg).buildings.filter((b) => b.id.startsWith('house:'));
  expect(houses.map((h) => [h.id, h.owner?.memberId, h.owner?.tag])).toEqual([
    ['house:@leader', '@leader', '팀장의 집'],
    ['house:backend-dev', 'backend-dev', 'backend-dev'],
    ['house:frontend-dev', 'frontend-dev', 'frontend-dev'],
    ['house:qa-reviewer', 'qa-reviewer', 'qa-reviewer'],
  ]);
  const qa = houses.find((h) => h.id === 'house:qa-reviewer');
  expect(qa?.owner).toEqual({
    memberId: 'qa-reviewer',
    species: 'hamster',
    variant: 3,
    accessory: 'headlamp',
    slot: 4,
    tag: 'qa-reviewer',
  });
  expect(qa?.departed).toBe(true);
  expect(houses.find((h) => h.id === 'house:backend-dev')?.owner?.slot).toBe(2);
  // 시설은 지금 간판 그대로, 1층 이상 일터는 집과 같은 주인 표시 (M13)
  for (const b of sceneFromState(s, cfg).buildings.filter((b) => b.id.startsWith('facility:')))
    expect(b.owner).toBeUndefined();
  expect(sceneFromState(s, cfg).buildings.find((b) => b.id === 'work:w1:qa-reviewer')?.owner).toEqual(qa?.owner);
});
