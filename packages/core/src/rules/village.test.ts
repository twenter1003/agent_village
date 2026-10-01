// 마을 레벨·공공시설·시청 (06 문서 6장, D24, 6.4 구현 메모)
import { beforeAll, describe, expect, test } from 'vitest';
import { defaultConfig as cfg, makeConfig, type GameConfig } from '../config/config';
import type { DomainEvent, Tokens } from '../events/normalize';
import { initialState, project } from '../projector/project';
import { lotTiles, PLAZA_RIM, roadsideSpots, zoneOf, type Zone } from '../layout/lots';
import { LEADER_ID, type VillageState } from '../projector/types';
import { occupiedLots } from './growth';
import { hallFloor, levelOf, villagePoints } from './village';

const T0 = Date.parse('2026-10-01T00:00:00.000Z');
const at = (sec: number) => T0 + sec * 1000;
const tk = (input: number): Tokens => ({ input, output: 0, cacheWrite: 0, cacheRead: 0 });
const JOBS: Record<string, string> = { 'backend-dev': 'backend', 'qa-reviewer': 'qa' };
const rosterOf = (names: string[]): DomainEvent => ({
  t: 'RosterLoaded',
  at: at(0),
  agents: names.map((name) => ({ name, description: '' })),
  tycoon: { members: Object.fromEntries(names.map((n) => [n, { job: JOBS[n] ?? 'backend' }])) },
});
const roster = rosterOf(['backend-dev', 'qa-reviewer']);
/** 실행 하나: 시작 → 도구 tools번 → 끝 (품질 1). tokens = 비용 환산 입력 토큰 (진주 = ÷1,000) */
function work(runId: string, who: string, sec: number, tools: number, tokens = 0): DomainEvent[] {
  const ev: DomainEvent[] = [{ t: 'AgentRunStarted', at: at(sec), runId, agentType: who }];
  for (let k = 0; k < tools; k++)
    ev.push({
      t: 'ToolUsed',
      at: at(sec + 1),
      runId,
      tool: 'Read',
      phase: 'post',
      ok: true,
      kind: 'read',
      isTest: false,
    });
  ev.push({ t: 'AgentRunEnded', at: at(sec + 2), runId, ok: true, ...(tokens ? { tokens: tk(tokens) } : {}) });
  return ev;
}
const tick = (day: number, sec: number): DomainEvent => ({ t: 'GameDayTick', at: at(sec), day });
const play = (events: DomainEvent[], c: GameConfig = cfg, s: VillageState = initialState('p', c)) =>
  events.reduce((x, e) => project(x, e, c), s);

const ROWS: [number, string][] = [
  [0, 'village'],
  [10, 'village'],
  [20, 'village'],
  [30, 'town'],
  [40, 'town'],
  [50, 'town'],
  [60, 'city'],
  [70, 'city'],
  [80, 'city'],
  [90, 'capital'],
];
/** 시험용 작은 표: Lv.N = 일 점수 10(N−1)·공사비 50 · 일터 2층 10점(Lv.1)·3층 20점(Lv.4)·큰 건물 30점(Lv.7), 자재비 0 ·
 *  공공시설 소품 10, 공원·길 포장 20(Lv.4), 등대 30(Lv.7). 도구 10번 = 일 10점, 급여 260, 세금 52 → 기금 +52 */
const TINY = {
  village: { levels: ROWS.map(([points, era], i) => ({ points, cost: i ? 50 : 0, era })) },
  workplace: {
    levels: [
      { points: 0, cost: 0, level: 1 },
      { points: 10, cost: 0, level: 1 },
      { points: 20, cost: 0, level: 4 },
      { points: 30, cost: 0, level: 7 },
    ],
  },
  publicWorks: [
    { id: 'streetlamp', cost: 10, level: 1 },
    { id: 'bench', cost: 10, level: 1 },
    { id: 'flowers', cost: 10, level: 1 },
    { id: 'park', cost: 20, level: 4 },
    { id: 'paving', cost: 20, level: 4 },
    { id: 'landmark', cost: 30, level: 7 },
  ],
};
/** 레벨만 (공공시설 없음): 레벨 테스트가 공공시설 규칙에 흔들리지 않게 */
const lv = makeConfig({ overrides: { ...TINY, publicWorks: [] } });
const tiny = makeConfig({ overrides: TINY });
/** 공공시설만 작게 (레벨 표는 기본 1,500점부터라 이 시험들에선 레벨업이 없다) */
const pw = makeConfig({ overrides: { publicWorks: TINY.publicWorks } });
const kinds = (s: VillageState) => s.publicWorks.map((w) => w.kind);
const opposite: Record<Zone, Zone> = { north: 'south', south: 'north', east: 'west', west: 'east' };
const lotOf = (s: VillageState, kind: string) => {
  const lot = s.publicWorks.find((w) => w.kind === kind)?.lot;
  if (!lot) throw new Error(`${kind} 부지 없음`);
  return lot;
};
/** 부지끼리 1칸 이상 떨어졌나 (집·시설·일터·시청·공원·랜드마크) */
const apart = (s: VillageState) => {
  const lots = occupiedLots(s);
  return lots.every((a) =>
    lots.every(
      (b) =>
        a === b ||
        !lotTiles(a).some(([ax, ay]) =>
          lotTiles(b).some(([bx, by]) => Math.abs(ax - bx) <= 1 && Math.abs(ay - by) <= 1),
        ),
    ),
  );
};

describe('레벨업 (06 문서 6.1·6.4)', () => {
  test('점수 ≥ 다음 레벨 점수이고 기금 ≥ 공사비면 하루 정산에서: 공사비는 기금에서, 섬 사방 4칸, 입주한 팀원 모두 환호, 알림 ref @level:<n>:<시대>', () => {
    const s1 = play([roster, ...work('a1', 'backend-dev', 1, 10)], lv);
    expect([s1.level, villagePoints(s1), s1.economy.fund]).toEqual([1, 10, 52]); // 실행이 끝날 때는 오르지 않는다
    const s2 = play([tick(1, 100)], lv, s1);
    expect([s2.level, s2.ring, s2.economy.fund]).toEqual([2, s1.ring + 1, 2]);
    expect(s2.economy.history.at(-1)?.works).toBe(50);
    expect(s2.toasts.find((x) => x.ref?.startsWith('@level:'))).toMatchObject({
      kind: 'complete',
      text: '마을 레벨 Lv.2',
      ref: '@level:2:village',
      sticky: false,
    }); // 맨 뒤는 급여 토스트
    expect(s2.feed.some((f) => f.kind === 'task' && f.text === '마을 레벨 Lv.2' && f.ref === '@level:2:village')).toBe(
      true,
    );
    for (const id of [LEADER_ID, 'backend-dev'])
      expect(s2.members[id]?.cheerUntil).toBe(at(100) + lv.buildings.cheerMs);
    expect(s2.members['qa-reviewer']?.cheerUntil ?? null).toBeNull(); // 입주 전
  });

  test('점수나 기금이 모자라면 그대로, 레벨은 내려가지 않는다 — 기금이 공사비보다 적으면 Lv.1', () => {
    const s1 = play([roster, ...work('a1', 'backend-dev', 1, 9), tick(1, 100)], lv); // 점수 9 < 10
    expect([s1.level, s1.economy.history.at(-1)?.works]).toEqual([1, 0]);
    const s2 = play(work('a2', 'backend-dev', 200, 1), lv, s1); // 점수 10, 아직 정산 전
    expect(s2.level).toBe(1);
    s2.economy.fund = 49;
    const s3 = play([tick(2, 300)], lv, s2);
    expect([s3.level, s3.economy.fund]).toEqual([1, 49]);
  });

  test('한 정산에서 여러 레벨 (O2): 레벨마다 공사비·알림·섬 넓힘, maxRing에서 섬은 멈춘다', () => {
    const s1 = play([roster, ...work('a1', 'backend-dev', 1, 30)], lv); // 점수 30, 기금 156
    const s2 = play([tick(1, 100)], lv, s1);
    expect([s2.level, s2.economy.fund, s2.ring]).toEqual([4, 6, s1.ring + 3]);
    expect(s2.toasts.filter((x) => x.ref?.startsWith('@level:')).map((x) => x.ref)).toEqual([
      '@level:2:village',
      '@level:3:village',
      '@level:4:town',
    ]);
    const capped = makeConfig({ overrides: { ...TINY, publicWorks: [], layout: { maxRing: 1 } } });
    const c = play([roster, ...work('a1', 'backend-dev', 1, 30), tick(1, 100)], capped);
    expect([c.level, c.ring]).toEqual([4, 1]);
  });

  test('레벨업이 일터 층보다 먼저 (5.4·HANDOFF): Lv.4가 되는 그 정산에서 "Lv.4 필요"로 기다리던 일터가 3층', () => {
    const s1 = play([roster, ...work('a1', 'backend-dev', 1, 30)], lv);
    expect(s1.buildings['w1:backend-dev']).toMatchObject({ floor: 2, waiting: 'level' });
    const s2 = play([tick(1, 100)], lv, s1);
    expect(s2.buildings['w1:backend-dev']).toMatchObject({ floor: 3, waiting: 'level', floorAt: at(100) }); // 큰 건물은 Lv.7
  });

  test('레벨업도 그날 팀장 토큰값 청구만큼 남긴다 (6.4): 기금 − 공사비가 그날 청구보다 적으면 기다리고, 다음 정산(청구 0)에 오른다', () => {
    const turn: DomainEvent = { t: 'MainTurnEnded', at: at(20), sessionId: 'm', tokens: tk(10_000) }; // 팀장 10
    const s0 = play([roster, ...work('a1', 'backend-dev', 1, 12), turn], lv); // 세금 62 − 10 = 52
    expect([levelOf(s0, lv).fund, levelOf(s0, lv).bill]).toEqual([52, 10]); // 상단 바 기금 조건 = 공사비 50 + 10
    const s1 = play([tick(1, 100)], lv, s0);
    expect([s1.level, s1.economy.fund]).toEqual([1, 52]); // 52 ≥ 50 이지만 < 50 + 10
    const s2 = play([tick(2, 200)], lv, s1);
    expect([s2.level, s2.economy.fund]).toEqual([2, 2]);
  });

  test('levelOf·hallFloor (13장 상단 바, 6.3 시청): 시대 = 시청 1·2·3·4(해저 궁전), 최고 레벨이면 next null', () => {
    const s = initialState('p', lv);
    const floors: number[] = [];
    for (let l = 1; l <= 10; l++) {
      s.level = l;
      floors.push(hallFloor(s, lv));
    }
    expect(floors).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 3, 4]);
    s.level = 4;
    expect(levelOf(s, lv)).toMatchObject({
      level: 4,
      era: 'town',
      cur: { points: 30 },
      next: { points: 40, cost: 50 },
      points: 0,
      fund: 0,
    });
    s.level = 10;
    expect(levelOf(s, lv).next).toBeNull();
  });
});

describe('공공시설 (06 문서 6.2·6.4)', () => {
  test('하루 하나, Lv.1은 가로등 → 벤치 → 꽃밭 차례 — 가로등은 길가, 벤치·꽃밭은 광장 둘레. 값이 모자라면 건너뛰지 않고 모은다, 소품은 활동 기록만', () => {
    let s = play([roster, ...work('a1', 'backend-dev', 1, 5), tick(1, 100), tick(2, 200), tick(3, 300)], pw); // 세금 26
    expect(kinds(s)).toEqual(['streetlamp', 'bench']); // 3일째 꽃밭 10 > 남은 6 → 모음
    s = play([...work('a2', 'backend-dev', 310, 4), tick(4, 400), tick(5, 500)], pw, s); // 세금 21 → 27
    expect(s.publicWorks).toEqual([
      { id: 'streetlamp:1', kind: 'streetlamp', day: 1, cost: 10, spot: { x: 6, y: 4 }, lot: null },
      { id: 'bench:1', kind: 'bench', day: 2, cost: 10, spot: { x: 10, y: 9 }, lot: null },
      { id: 'flowers:1', kind: 'flowers', day: 4, cost: 10, spot: { x: 6, y: 10 }, lot: null },
      { id: 'streetlamp:2', kind: 'streetlamp', day: 5, cost: 10, spot: { x: 9, y: 4 }, lot: null },
    ]);
    expect(s.economy.fund).toBe(7);
    expect(s.economy.history.map((r) => r.works)).toEqual([10, 10, 0, 10, 10]);
    expect(s.feed.filter((f) => f.ref?.startsWith('@work:')).map((f) => [f.kind, f.ref])).toEqual([
      ['economy', '@work:streetlamp:10'],
      ['economy', '@work:bench:10'],
      ['economy', '@work:flowers:10'],
      ['economy', '@work:streetlamp:10'],
    ]);
    expect(s.toasts.some((x) => x.ref?.startsWith('@work:'))).toBe(false);
  });

  test('그날 팀장 토큰값 청구만큼 남기고 산다 (O8 ③) — 다음 날(청구 0)엔 산다', () => {
    const s1 = play(
      [
        roster,
        ...work('a1', 'backend-dev', 1, 10),
        { t: 'MainTurnEnded', at: at(20), sessionId: 'm', tokens: tk(30_000) },
        tick(1, 100),
      ],
      pw,
    );
    expect([kinds(s1), s1.economy.fund]).toEqual([[], 22]); // 52 − 30 = 22, 남는 기금 22 − 30 < 10
    const s2 = play([tick(2, 200)], pw, s1);
    expect([kinds(s2), s2.economy.fund]).toEqual([['streetlamp'], 12]);
  });

  test('점수는 다음 레벨에 찼는데 기금이 모자라면 공공시설도 짓지 않고 모은다 (O8 ②), 레벨업이 먼저', () => {
    const s1 = play([roster, ...work('a1', 'backend-dev', 1, 10)], tiny); // 점수 10 = Lv.2 기준
    s1.economy.fund = 49;
    const s2 = play([tick(1, 100)], tiny, s1);
    expect([s2.level, kinds(s2), s2.economy.fund]).toEqual([1, [], 49]);
    s2.economy.fund = 60;
    const s3 = play([tick(2, 200)], tiny, s2); // Lv.2 (−50) 다음 가로등 (−10)
    expect([s3.level, kinds(s3), s3.economy.fund]).toEqual([2, ['streetlamp'], 0]);
  });

  test('Lv.4: 한 번짜리 공원 → 길 포장을 소품보다 먼저, 값이 모자라면 소품으로 건너뛰지 않음. 공원은 빈 3×3(안 겹침), 토스트', () => {
    let s = play([roster, ...work('a1', 'backend-dev', 1, 30), tick(1, 100)], tiny); // Lv.4, 기금 6
    expect([s.level, kinds(s)]).toEqual([4, []]);
    s = play([...work('a2', 'backend-dev', 110, 5), tick(2, 200), tick(3, 300)], tiny, s); // 32 → 공원(−20) → 12, 길 포장 20 > 12
    expect([kinds(s), s.economy.fund]).toEqual([['park'], 12]);
    s = play([...work('a3', 'backend-dev', 310, 2), tick(4, 400)], tiny, s); // +10 → 22 → 길 포장
    expect(kinds(s)).toEqual(['park', 'paving']);
    const [park, paving] = s.publicWorks;
    expect(park).toMatchObject({ id: 'park', day: 2, cost: 20, spot: null, lot: { size: 3 } });
    expect(paving).toMatchObject({ id: 'paving', day: 4, cost: 20, spot: null, lot: null });
    expect(apart(s)).toBe(true);
    expect(s.toasts.filter((x) => x.ref?.startsWith('@work:')).map((x) => [x.kind, x.ref])).toEqual([
      ['complete', '@work:park:20'],
      ['complete', '@work:paving:20'],
    ]);
  });

  test('자리가 남는 동안만 (6.2): ring 0이면 가로등 16 + 광장 둘레 6 = 22개에서 멈추고 기금은 남는다', () => {
    const c = makeConfig({ overrides: { publicWorks: TINY.publicWorks, layout: { maxRing: 0 } } });
    const s0 = play([roster, ...work('a1', 'backend-dev', 1, 1)], c);
    s0.economy.fund = 1000;
    const s = play(
      Array.from({ length: 30 }, (_, i) => tick(i + 1, 100 * (i + 1))),
      c,
      s0,
    );
    expect(s.ring).toBe(0);
    expect(kinds(s).slice(0, 9)).toEqual([
      'streetlamp',
      'bench',
      'flowers',
      'streetlamp',
      'bench',
      'flowers',
      'streetlamp',
      'bench',
      'flowers',
    ]);
    expect(kinds(s).filter((k) => k === 'streetlamp')).toHaveLength(16);
    expect(s.publicWorks).toHaveLength(22);
    expect(s.economy.fund).toBe(1000 - 220);
    const spots = s.publicWorks.map((w) => String([w.spot?.x, w.spot?.y]));
    expect(new Set(spots).size).toBe(22);
    expect(new Set(spots)).toEqual(new Set([...roadsideSpots(0), ...PLAZA_RIM].map(String)));
  });

  test('Lv.10: 두 번째 랜드마크는 공사비에 포함(값 0), 첫 랜드마크 반대 구역 — 시청 해저 궁전, 토스트', () => {
    let s = play([roster, ...work('a1', 'backend-dev', 1, 60), tick(1, 100)], tiny); // Lv.7, 기금 12
    expect(s.level).toBe(7);
    s.economy.fund = 100;
    s = play([tick(2, 200), tick(3, 300), tick(4, 400)], tiny, s); // 공원 → 길 포장 → 등대
    expect(kinds(s)).toEqual(['park', 'paving', 'landmark']);
    s = play([...work('a2', 'backend-dev', 410, 30), tick(5, 500)], tiny, s); // 점수 90 → Lv.8·9·10
    expect([s.level, hallFloor(s, tiny)]).toEqual([10, 4]);
    expect(s.publicWorks.find((w) => w.kind === 'landmark2')).toMatchObject({
      id: 'landmark2',
      day: 5,
      cost: 0,
      spot: null,
      lot: { size: 3 },
    });
    expect(zoneOf(lotOf(s, 'landmark2'))).toBe(opposite[zoneOf(lotOf(s, 'landmark'))]);
    expect(s.toasts.some((x) => x.ref === '@work:landmark2:0' && x.kind === 'complete')).toBe(true);
    expect(apart(s)).toBe(true);
  });

  test('랜드마크 둘은 어느 쪽이 먼저 생겨도 마주 본다: Lv.10을 한 정산에 오르면 두 번째 랜드마크가 먼저(가장 가까운 3×3), 등대는 그 반대 구역', () => {
    let s = play([roster, ...work('a1', 'backend-dev', 1, 90), tick(1, 100)], tiny); // 점수 90, 세금 468 − 공사비 450
    expect([s.level, kinds(s), s.economy.fund]).toEqual([10, ['landmark2'], 18]);
    s.economy.fund = 100;
    s = play([tick(2, 200), tick(3, 300), tick(4, 400)], tiny, s);
    expect(kinds(s)).toEqual(['landmark2', 'park', 'paving', 'landmark']);
    expect(zoneOf(lotOf(s, 'landmark'))).toBe(opposite[zoneOf(lotOf(s, 'landmark2'))]);
    expect(apart(s)).toBe(true);
  });

  test('자리 없는 것은 건너뛴다 (6.4): 둘 데 없는 비싼 시설이 소품을 막지 않고, 두 번째 랜드마크는 사라지지 않고 날마다 다시 — 섬을 넓힐 수 있게 되면 생긴다', () => {
    const full = makeConfig({ overrides: { ...TINY, layout: { maxRing: 0 } } }); // ring 0: 구역마다 3×3 하나
    const three = rosterOf(['backend-dev', 'qa-reviewer', 'frontend-dev']); // 집 넷 = 서쪽, 일터 = 남·동(셋째는 맵 밖), 시청 = 북
    let s = play(
      [
        three,
        ...work('a1', 'backend-dev', 1, 90),
        ...work('a2', 'qa-reviewer', 5, 1),
        ...work('a3', 'frontend-dev', 9, 1),
        tick(1, 100),
      ],
      full,
    );
    expect([s.level, s.ring, kinds(s)]).toEqual([10, 0, ['paving']]); // 두 번째 랜드마크·공원 자리 없음 → 길 포장
    s.economy.fund = 15; // 공원 20·등대 30은 자리가 없어 건너뜀 → 가로등 10
    s = play([tick(2, 200)], full, s);
    expect(kinds(s)).toEqual(['paving', 'streetlamp']);
    const wider = makeConfig({ overrides: { ...TINY, layout: { maxRing: 1 } } });
    s = play([tick(3, 300)], wider, s);
    expect(kinds(s)).toEqual(['paving', 'streetlamp', 'landmark2']);
    expect([s.ring, s.publicWorks.at(-1)?.day, s.publicWorks.at(-1)?.cost]).toEqual([1, 3, 0]);
    expect(apart(s)).toBe(true);
  });

  test('진주가 새지 않는다 + 지우지 않는다: 잔고 + 기금 + 가구 + 낸 토큰 + 자재비 + 레벨업·공공시설 = 급여, 레벨·공공시설은 앞 상태를 그대로 품고, 재생해도 같다', () => {
    const ev: DomainEvent[] = [
      roster,
      ...work('a1', 'backend-dev', 1, 60, 100_000),
      { t: 'MainTurnEnded', at: at(70), sessionId: 'm', tokens: tk(50_000) },
      ...Array.from({ length: 6 }, (_, i) => tick(i + 1, 100 * (i + 1))),
      ...work('a2', 'qa-reviewer', 700, 30),
      ...Array.from({ length: 4 }, (_, i) => tick(i + 7, 800 + 100 * i)),
    ];
    let s = initialState('p', tiny);
    let prev = s;
    for (const e of ev) {
      s = project(s, e, tiny);
      expect(s.level).toBeGreaterThanOrEqual(prev.level);
      expect(s.publicWorks.slice(0, prev.publicWorks.length)).toEqual(prev.publicWorks);
      expect(s.hall ?? prev.hall).toEqual(prev.hall ?? s.hall);
      prev = s;
    }
    const days = [...s.economy.history, s.economy.today];
    const sum = (k: keyof typeof s.economy.today) => days.reduce((a, r) => a + r[k], 0);
    const wages = Object.values(s.runs).reduce((a, r) => a + (r.wage ?? 0), 0);
    const balances = Object.values(s.members).reduce((a, m) => a + m.balance, 0);
    const furniture = Object.values(s.members)
      .flatMap((m) => m.furniture)
      .reduce((a, f) => a + (f.paid ?? f.price), 0);
    const materials = Object.values(s.buildings).reduce((a, b) => a + b.paid, 0);
    const levelCosts = tiny.village.levels.slice(1, s.level).reduce((a, l) => a + l.cost, 0);
    expect(sum('works')).toBe(levelCosts + s.publicWorks.reduce((a, w) => a + w.cost, 0));
    expect(balances + s.economy.fund + furniture + sum('tokens') + sum('leaderTokens') + materials + sum('works')).toBe(
      wages,
    );
    expect(JSON.stringify(play(ev, tiny))).toBe(JSON.stringify(s));
  });
});

describe('성장 시뮬레이션 (06 문서 6.1 속도 가늠·15장·16장 완료 기준)', () => {
  // 작업 = 도구 15번 실행 (일 점수 15, 급여 390, 세금 78). 팀원 토큰값 호출당 10.3진주(3.4 중앙값), 팀장은 작업마다 48진주 →
  // 기금 순이익 작업당 30 (6.1 "잘 나눠 맡기는 팀장"). 팀원 한 명뿐인 마을 (16장 "팀원 1명 마을도 Lv.10").
  // 기금·점수는 팀원 수와 상관없이 작업 수로만 정해져서 이 한 번이 속도 가늠도 본다.
  // 기본 = 1/10 축소판: 점수·값 ÷ 10(D31 전 표) + 하루 = 작업 1개 — 하루 팀장 청구(남김, 6.4)도 기금 순이익에 대해 같은 무게가 되게.
  //   작업 약 700건, 몇 초. SIM=1 = 실제 설정(×10) + 하루 = 작업 9개 — 작업 약 7,000건, 2분쯤 (상태 복사가 일수·가구 수만큼 커진다)
  const FULL = !!process.env.SIM;
  const D = FULL ? 1 : 10;
  const per = (n: number) => n / D;
  const c = makeConfig({
    overrides: {
      village: { levels: cfg.village.levels.map((l) => ({ ...l, points: per(l.points), cost: per(l.cost) })) },
      publicWorks: cfg.publicWorks.map((w) => ({ ...w, cost: per(w.cost) })),
      workplace: { levels: cfg.workplace.levels.map((l) => ({ ...l, points: per(l.points), cost: per(l.cost) })) },
    },
  });
  const PER_DAY = FULL ? 9 : 1;
  const MAX = c.village.levels.length;
  /** Lv.l 점수가 차는 작업 수 (6.1 속도 가늠의 바닥) */
  const est = (l: number) => Math.ceil((c.village.levels[l - 1]?.points ?? 0) / 15);
  const LIMIT = Math.ceil(est(MAX) * 1.35) + PER_DAY;
  const CHECK = [30, 100, 300, 700, 1000, 3000, 7000].map(per); // 15장 확인표 (실제 설정의 작업 수)
  const reached: Record<number, number> = {}; // 레벨 → 그 레벨이 된 정산까지의 작업 수
  const levels: number[] = [];
  const rows: { tasks: number; level: number; points: number; fund: number; works: string; floors: string }[] = [];
  let s = initialState('p', c);
  beforeAll(
    () => {
      s = project(s, rosterOf(['backend-dev']), c);
      let sec = 10;
      let day = 0;
      for (let i = 1; i <= LIMIT; i++) {
        for (const e of work(`r${i}`, 'backend-dev', sec, 15, 154_500)) s = project(s, e, c);
        s = project(s, { t: 'MainTurnEnded', at: at(sec + 3), sessionId: 'main', tokens: tk(48_000 * i) }, c);
        // ponytail: 끝난 실행은 버린다 — 레벨·기금·점수·공공시설 규칙은 끝난 실행을 다시 읽지 않는다. 안 버리면 이벤트마다
        // 상태 복사가 실행 수만큼 커져 시간이 작업 수의 제곱으로 는다
        s.runs = Object.fromEntries(Object.entries(s.runs).filter(([, r]) => r.endedAt === null));
        sec += 5;
        if (i % PER_DAY === 0) {
          s = project(s, { t: 'GameDayTick', at: at(sec), day: ++day }, c);
          levels.push(s.level);
          for (let l = 2; l <= s.level; l++) reached[l] ??= i;
        }
        if (CHECK.includes(i))
          rows.push({
            tasks: i * D,
            level: s.level,
            points: villagePoints(s) * D,
            fund: s.economy.fund * D,
            works: Object.entries(
              s.publicWorks.reduce<Record<string, number>>((a, w) => ({ ...a, [w.kind]: (a[w.kind] ?? 0) + 1 }), {}),
            )
              .map(([k, n]) => `${k}×${n}`)
              .join(' '),
            floors: Object.values(s.buildings)
              .map((b) => b.floor)
              .join(''),
          });
        if (s.level === MAX && i >= (CHECK.at(-1) ?? 0)) break;
      }
    },
    FULL ? 1_800_000 : 180_000,
  );

  test('6.1 속도 가늠 안: Lv.L은 점수가 찬 작업 수(올림(점수 ÷ 15), 설정에서) 뒤, 그 1.35배 + 하루 안에 (6.4: 소품·팀장 토큰값 남김 몫)', () => {
    for (const l of [2, 4, 7, 10]) {
      const got = reached[l] ?? Infinity;
      expect(got, `Lv.${l}`).toBeGreaterThanOrEqual(est(l));
      expect(got, `Lv.${l}`).toBeLessThanOrEqual(Math.ceil(est(l) * 1.35) + PER_DAY);
    }
  });

  test('팀원 1명 마을도 Lv.10 (16장): 해저 궁전, 공원·길 포장·랜드마크 둘·소품, 레벨은 내려가지 않고 기금은 0 이상, 섬은 상한 안', () => {
    expect(s.level).toBe(MAX);
    expect(hallFloor(s, c)).toBe(4);
    expect(new Set(kinds(s))).toEqual(
      new Set(['streetlamp', 'bench', 'flowers', 'park', 'paving', 'landmark', 'landmark2']),
    );
    expect(levels.every((l, i) => i === 0 || l >= (levels[i - 1] ?? 0))).toBe(true);
    expect(s.economy.fund).toBeGreaterThanOrEqual(0);
    expect(s.ring).toBeLessThanOrEqual(c.layout.maxRing);
    expect(apart(s)).toBe(true);
  });

  test('15장 확인표 (실제 설정의 작업 30·100·300·700·1,000·3,000·7,000건: 레벨·점수·기금·공공시설·일터 층) — 06 문서 6.4에 옮겨 적는다', () => {
    console.table(rows);
    console.table(Object.fromEntries(Object.entries(reached).map(([l, n]) => [l, { tasks: n * D, est: est(+l) * D }])));
    expect(rows.map((r) => r.tasks)).toEqual([30, 100, 300, 700, 1000, 3000, 7000]);
  });
});
