// 팀원 일터 (06 문서 5장, D18·D19): 처음 일할 때 3×3 부지 + 현장, 그 일이 끝나면 1층, 일 점수 = 끝난 실행의 도구 호출 × 품질
import { describe, expect, test } from 'vitest';
import { defaultConfig as cfg, makeConfig, type GameConfig } from '../config/config';
import { normalize, type DomainEvent } from '../events/normalize';
import { lotTiles } from '../layout/lots';
import { initialState, project, replay } from '../projector/project';
import type { VillageState } from '../projector/types';
import { occupiedLots } from './growth';
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
/** 실행 하나: 시작 → 도구 tools번 → 끝. tokens = 비용 환산 입력 토큰 (모델 모름 = 배율 1, 진주 = ÷1,000), tested = 첫 도구가 통과한 테스트 (품질 1.2) */
function work(
  runId: string,
  who: string,
  sec: number,
  tools: number,
  o: { ok?: boolean; tokens?: number; tested?: boolean } = {},
): DomainEvent[] {
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
      isTest: !!o.tested && k === 0,
    });
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
    const gp: DomainEvent = {
      t: 'RosterLoaded',
      at: at(0),
      agents: [{ name: 'general-purpose', description: '' }],
      tycoon: null,
    };
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
    expect(
      Object.values(s.buildings)
        .map((b) => b.memberId)
        .sort(),
    ).toEqual([...workers].sort());
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

  test('사용자 이름: 보이지 않는 글자만이면 거절, 섞여 있으면 공백처럼 정리, 이모지 ZWJ는 둔다 (5.3)', () => {
    const ch = (...cps: number[]) => String.fromCodePoint(...cps);
    // ZWSP, 점자 빈칸, 한글 채움, RTL 덮기, BEL, BOM, ZWJ 하나
    for (const cp of [0x200b, 0x2800, 0x3164, 0x115f, 0xffa0, 0x202e, 0x07, 0xfeff, 0x200d])
      expect(cleanBuildingName(ch(cp)), cp.toString(16)).toBeNull();
    expect(cleanBuildingName(ch(0x3164, 0x20, 0x200b))).toBeNull();
    expect(cleanBuildingName(`${ch(0x200b)}새${ch(0x3164)}${ch(0x3164)}집${ch(0x202e)}`)).toBe('새 집');
    const family = ch(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467);
    expect(cleanBuildingName(` ${family} 집 `)).toBe(`${family} 집`);
  });
});

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
    fe1.balance = 250; // ENFP(꾸미기): 예산 = 250 − max(125, 다음 층 300) < 0이라 못 산다 (대기 중엔 쉬는 규칙도 있다, 6.4)
    const s2 = play([tick(1, 100)], quick, s1);
    expect(s2.members['frontend-dev']).toMatchObject({ balance: 250, furniture: [] });
    expect(wp(s2, 'w1:frontend-dev')?.waiting).toBe('materials');
    const fe2 = s2.members['frontend-dev'];
    if (!fe2) throw new Error('frontend-dev');
    fe2.balance = 700;
    const s3 = play([tick(2, 200)], quick, s2); // 정산: 2층(−300) → 자동 구매 (예산 400 − 다음 층 300 = 100 → 화분 80)
    expect(wp(s3, 'w1:frontend-dev')).toMatchObject({ floor: 2, waiting: null, paid: 300, floorAt: at(200) });
    expect(s3.members['frontend-dev']?.furniture.map((f) => f.kind)).toEqual(['plant']);
    expect(s3.members['frontend-dev']?.balance).toBe(320);
  });

  test('마을 레벨이 모자라면 "Lv.N 필요" 대기 (알림 없음), 점수는 그 일터에 계속 — M13은 Lv.1이라 2층에서 멈춤, 레벨이 오르면 정산에서 오른다', () => {
    const s1 = play(
      [
        roster,
        ...work('a1', 'backend-dev', 1, 10),
        ...work('a2', 'backend-dev', 10, 10),
        ...work('a3', 'backend-dev', 20, 10),
      ],
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

  test('층 확인은 그 실행의 토큰값까지 낸 뒤 (5.9): 급여로는 자재비가 되지만 토큰값을 내면 모자라면 대기, 형편은 멀쩡', () => {
    const s0 = play([roster], quick);
    const be = s0.members['backend-dev'];
    if (!be) throw new Error('backend-dev');
    be.balance = 150; // + 급여 208 = 358 ≥ 300, 토큰값 100을 내면 258 < 300
    const s = play(work('a1', 'backend-dev', 1, 10, { tokens: 100_000 }), quick, s0);
    expect(wp(s)).toMatchObject({ floor: 1, points: 10, waiting: 'materials', paid: 0 });
    expect(s.members['backend-dev']).toMatchObject({ balance: 258, hardship: false });
  });

  test('여러 층을 한 번에 오르면 층마다 활동 기록·토스트 하나, 낸 자재비는 오늘 기록에 (06 문서 5.4)', () => {
    const s0 = initialState('p', quick);
    s0.level = 7;
    const s = play([roster, ...work('a1', 'backend-dev', 1, 60)], quick, s0); // 1층 → 2층 → 3층 → 큰 건물
    expect(s.toasts.filter((x) => x.kind === 'complete').map((x) => x.text)).toEqual([
      'backend-dev 일터 2층 완공',
      'backend-dev 일터 3층 완공',
      'backend-dev 일터 큰 건물 완공',
    ]);
    expect(s.economy.today.materials).toBe(900);
    const s2 = play([tick(1, 100)], quick, s);
    expect([s2.economy.history.at(-1)?.materials, s2.economy.today.materials]).toEqual([900, 0]);
  });

  test('팀원별 오늘 자재비: 같은 날 따로 오른 층도 더하고, 정산에서 0 (집 지갑 "자재비 · 오늘", 06 문서 5.3)', () => {
    const s0 = initialState('p', quick);
    s0.level = 7;
    const s1 = play([roster, ...work('a1', 'backend-dev', 1, 15)], quick, s0); // 잔고 312 → 2층 (300)
    expect([wp(s1)?.floor, s1.members['backend-dev']?.materialsToday]).toEqual([2, 300]);
    const s2 = play(work('a2', 'backend-dev', 10, 15), quick, s1); // 점수 30, 잔고 324 → 3층 (300), 큰 건물은 자재비 대기
    expect(wp(s2)).toMatchObject({ floor: 3, waiting: 'materials', paid: 600 });
    expect([s2.members['backend-dev']?.materialsToday, s2.economy.today.materials]).toEqual([600, 600]);
    expect(s2.members['frontend-dev']?.materialsToday).toBe(0);
    const s3 = play([tick(1, 100)], quick, s2);
    expect([s3.members['backend-dev']?.materialsToday, s3.economy.history.at(-1)?.materials]).toEqual([0, 600]);
  });

  test('레벨을 기다리는 팀원은 가구 자동 구매를 계속하고, 자재비를 기다리는 팀원은 쉰다 (5.4)', () => {
    const s1 = play([roster, ...work('a1', 'backend-dev', 1, 20), ...work('a2', 'frontend-dev', 5, 10)], quick);
    expect([wp(s1)?.waiting, wp(s1, 'w1:frontend-dev')?.waiting]).toEqual(['level', 'materials']);
    for (const [id, balance] of [
      ['backend-dev', 500], // 레벨 대기: 다음 층 자재비 300을 남기고 예산 200 → 산다
      ['frontend-dev', 290], // 자재비 대기 (290 < 300): 쉰다
    ] as const) {
      const m = s1.members[id];
      if (!m) throw new Error(id);
      m.balance = balance;
    }
    const s2 = play([tick(1, 100)], quick, s1);
    expect(s2.members['backend-dev']?.furniture.length).toBeGreaterThan(0);
    expect(s2.members['frontend-dev']?.furniture).toEqual([]);
  });

  test('가구 자동 구매는 게이지가 찼을 때만 다음 층 자재비를 남긴다 (D33): 예산 = 잔고 − max(예비 비율 몫, 남길 자재비)', () => {
    const at1 = (calls: number, balance: number) => {
      const s = play([roster, ...work('a1', 'frontend-dev', 1, calls)], quick); // 1층, 게이지 calls/10, 다음 층 300
      const m = s.members['frontend-dev'];
      if (!m) throw new Error('frontend-dev');
      m.balance = balance;
      return play([tick(1, 100)], quick, s).members['frontend-dev'];
    };
    // 게이지 5/10 < 0.6 → 남기지 않음: ENFP(꾸미기) 화분 80, 379 − 189.5 ≥ 80 → 산다
    expect(at1(5, 379)?.furniture.map((f) => f.kind)).toEqual(['plant']);
    // 게이지 8/10 ≥ 0.6 → 300 남김: 379 − max(189.5, 300) = 79 → 안 산다, 380이면 산다
    expect(at1(8, 379)).toMatchObject({ balance: 379, furniture: [] });
    expect(at1(8, 380)?.furniture.map((f) => f.kind)).toEqual(['plant']);
    expect(at1(8, 380)?.balance).toBe(300);
  });

  test('기본보다 긴 층 표: 층 이름은 "N층", 마지막 줄만 큰 건물 (기본 표의 글자는 그대로)', () => {
    const long = makeConfig({
      overrides: {
        workplace: { levels: [0, 10, 20, 30, 40].map((points) => ({ points, cost: 0, level: 1 })) },
      },
    });
    const s = play([roster, ...work('a1', 'backend-dev', 1, 40)], long);
    expect(s.toasts.map((x) => x.text)).toEqual([
      'backend-dev 일터 2층 완공',
      'backend-dev 일터 3층 완공',
      'backend-dev 일터 4층 완공',
      'backend-dev 일터 큰 건물 완공',
    ]);
    expect(wp(s)?.floor).toBe(5);
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
  test('진주가 새지 않는다: 잔고 + 기금 + 레벨업·공공시설 + 가구 + 낸 토큰 + 자재비 = 급여', () => {
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
    const days = [...s.economy.history, s.economy.today];
    const tokens = days.reduce((a, r) => a + r.tokens + r.leaderTokens, 0);
    const materials = Object.values(s.buildings).reduce((a, b) => a + b.paid, 0);
    expect(materials).toBeGreaterThan(0);
    expect(balances + s.economy.fund + furniture + tokens + materials + days.reduce((a, r) => a + r.works, 0)).toBe(
      wages,
    );
    // 하루 기록도 맞는다: 팀원 잔고 = 급여 − 세금 − 가구 − 토큰 − 자재비 (06 문서 5.3, 경제 패널)
    expect(days.reduce((a, r) => a + r.materials, 0)).toBe(materials);
    expect(days.reduce((a, r) => a + r.wages - r.tax - r.purchases - r.tokens - r.materials, 0)).toBe(balances);
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
          e = {
            t: 'ToolUsed',
            at: at(sec),
            runId: pick(open) ?? '',
            tool: 'Read',
            phase: 'post',
            ok: r() > 0.1,
            kind: 'read',
            isTest: false,
          };
        else if (x < 0.8)
          e = {
            t: 'AgentRunEnded',
            at: at(sec),
            runId: open.splice(Math.floor(r() * open.length), 1)[0] ?? '',
            ok: r() > 0.2,
          };
        else if (x < 0.85) e = { t: 'GameDayTick', at: at(sec), day: s.clock.day + 1 };
        else if (x < 0.9)
          e = {
            t: 'BuildingRenamed',
            at: at(sec),
            buildingId: pick(Object.keys(s.buildings)) ?? 'w9:x',
            name: `이름 ${i}`,
          };
        else if (x < 0.95) e = { t: 'TaskCreated', at: at(sec), taskId: `t${i}`, subject: 'x' };
        else e = { t: 'SessionStarted', at: at(sec), project: 'p', sessionId: `s${i}` };
        const prev = s;
        s = project(prev, e, quick);
        if (e.t === 'SessionStarted') open.length = 0;
        for (const [id, a] of Object.entries(prev.buildings)) {
          const b = s.buildings[id];
          const why = `seed ${seed} #${i} ${e.t} ${id}`;
          expect([b?.id, b?.memberId, b?.n, b?.lot, b?.startedAt], why).toEqual([
            a.id,
            a.memberId,
            a.n,
            a.lot,
            a.startedAt,
          ]);
          expect((b?.floor ?? -1) >= a.floor && (b?.points ?? -1) >= a.points && (b?.paid ?? -1) >= a.paid, why).toBe(
            true,
          );
        }
      }
    }
  });
  test('뒤섞인 순서(seed 20개 × 300 이벤트, 시작 없는 도구·Pre/Post·세션·토큰값): 재생해도 같고, id는 w<n>:<팀원>, 부지는 안 닿고, 급여 받은 실행의 주인은 1층 이상 일터가 있고, 대기 이유가 맞고, 큰 건물·두 번째 일터까지 간다', () => {
    /** 싼 층 (점수 6·12·18, 자재비 50·60·70, Lv.1·4·7): 300 이벤트 안에 큰 건물과 두 번째 일터까지, 토큰값으로 자재비 대기도 */
    const fz = makeConfig({
      overrides: {
        workplace: {
          levels: [
            { points: 0, cost: 0, level: 1 },
            { points: 6, cost: 50, level: 1 },
            { points: 12, cost: 60, level: 4 },
            { points: 18, cost: 70, level: 7 },
          ],
        },
      },
    });
    const seen = { maxFloor: 0, second: 0, materials: 0, level: 0 };
    const types = ['backend-dev', 'frontend-dev', 'qa-reviewer', 'Explore', 'general-purpose', ''];
    for (let seed = 1; seed <= 20; seed++) {
      const r = rng(seed * 7919);
      const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
      const ev: DomainEvent[] = [];
      for (let i = 0; i < 300; i++) {
        const t = at(1 + Math.floor(r() * 3600));
        const runId = `r${Math.floor(r() * 25)}`;
        const x = r();
        if (x < 0.2) ev.push({ t: 'AgentRunStarted', at: t, runId, agentType: pick(types) ?? '' });
        else if (x < 0.6)
          ev.push({
            t: 'ToolUsed',
            at: t,
            runId,
            tool: 'Bash',
            phase: r() < 0.5 ? 'pre' : 'post',
            ok: r() < 0.8,
            kind: 'shell',
            isTest: r() < 0.3,
            agentType: pick(types.slice(0, 3)),
          });
        else if (x < 0.8) {
          const input = r() < 0.5 ? Math.floor(r() * 300_000) : 0; // 토큰값 0~300진주
          ev.push({
            t: 'AgentRunEnded',
            at: t,
            runId,
            ok: r() < 0.8,
            ...(input ? { tokens: { input, output: 0, cacheWrite: 0, cacheRead: 0 } } : {}),
          });
        } else if (x < 0.85) ev.push({ t: 'SessionStarted', at: t, project: 'p', sessionId: 's' });
        else if (x < 0.9)
          ev.push({ t: 'BuildingRenamed', at: t, buildingId: `w1:${pick(types) ?? ''}`, name: `n${i}` });
        else ev.push({ t: 'GameDayTick', at: t, day: Math.floor(r() * 5) });
      }
      ev.sort((a, b) => (r() < 0.15 ? 0 : a.at - b.at)); // 대체로 시간순, 가끔 늦게 온 이벤트
      const s0 = play([roster], fz);
      s0.level = [1, 4, 7, 10][seed % 4] ?? 1;
      let s = s0;
      for (const e of ev) {
        const prev = s;
        s = project(prev, e, fz);
        for (const [id, a] of Object.entries(prev.buildings)) {
          const b = s.buildings[id];
          const why = `seed ${seed} ${e.t} ${id}`;
          expect([b?.memberId, b?.n, b?.lot, b?.startedAt], why).toEqual([a.memberId, a.n, a.lot, a.startedAt]);
          expect((b?.floor ?? -1) >= a.floor && (b?.points ?? -1) >= a.points && (b?.paid ?? -1) >= a.paid, why).toBe(
            true,
          );
        }
        // 대기 이유 (5.4): 자재비 = 게이지·레벨은 됐고 잔고가 모자람, 레벨 = 게이지는 됐고 레벨이 모자람
        for (const b of Object.values(s.buildings)) {
          const next = fz.workplace.levels[b.floor];
          const bal = s.members[b.memberId]?.balance ?? 0;
          const why = `seed ${seed} ${e.t} ${b.id} ${b.waiting}`;
          if (b.waiting === 'materials')
            expect(!!next && b.points >= next.points && s.level >= next.level && bal < next.cost, why).toBe(true);
          if (b.waiting === 'level') expect(!!next && b.points >= next.points && s.level < next.level, why).toBe(true);
          if (b.waiting) seen[b.waiting]++;
          seen.maxFloor = Math.max(seen.maxFloor, b.floor);
          if (b.n > 1) seen.second++;
        }
      }
      expect(
        ev.reduce((x, e) => project(x, e, fz), s0),
        `seed ${seed} 재생`,
      ).toEqual(s);
      const days = [...s.economy.history, s.economy.today];
      const balances = Object.values(s.members).reduce((a, m) => a + m.balance, 0);
      expect(
        days.reduce((a, r) => a + r.wages - r.tax - r.purchases - r.tokens - r.materials, 0),
        `seed ${seed} 하루 기록`,
      ).toBe(balances);
      for (const b of Object.values(s.buildings)) {
        expect(b.id).toBe(`w${b.n}:${b.memberId}`);
        expect(s.members[b.memberId]?.isLeader).toBe(false);
      }
      const lots = occupiedLots(s);
      for (const a of lots)
        for (const b of lots)
          if (a !== b)
            expect(
              lotTiles(a).some(([ax, ay]) =>
                lotTiles(b).some(([bx, by]) => Math.abs(ax - bx) <= 1 && Math.abs(ay - by) <= 1),
              ),
              `seed ${seed} ${JSON.stringify(a)} ${JSON.stringify(b)}`,
            ).toBe(false);
      for (const run of Object.values(s.runs))
        if (run.wage !== undefined && run.memberId)
          expect(
            Object.values(s.buildings).some((b) => b.memberId === run.memberId && b.floor >= 1),
            `seed ${seed} ${run.runId}`,
          ).toBe(true);
    }
    // 이 무작위가 정말 큰 건물·두 번째 일터·두 가지 대기를 지나갔나
    expect(seen.maxFloor).toBe(fz.workplace.levels.length);
    expect([seen.second > 0, seen.materials > 0, seen.level > 0]).toEqual([true, true, true]);
  });
});

describe('점수·자리·설정 (B1 리뷰)', () => {
  test('점수는 소수 오차로 층을 놓치지 않는다: 33 + 31×1.2 + 4×1.2 = 75 → 2층', () => {
    const free = makeConfig({
      overrides: {
        workplace: {
          levels: [
            { points: 0, cost: 0, level: 1 },
            { points: 75, cost: 0, level: 1 },
            { points: 225, cost: 0, level: 4 },
          ],
        },
      },
    });
    const s = play(
      [
        roster,
        ...work('a1', 'backend-dev', 1, 33),
        ...work('a2', 'backend-dev', 10, 31, { tested: true }),
        ...work('a3', 'backend-dev', 20, 4, { tested: true }),
      ],
      free,
    );
    expect(wp(s)).toMatchObject({ points: 75, floor: 2 });
  });

  test('일터 셋이면 섬을 넓힌다 (ring 0엔 3×3이 남·동 하나씩), 상한이면 맵 밖 + 안내 (02 문서 8.1, D10)', () => {
    const ev = [
      roster,
      ...work('a1', 'backend-dev', 1, 1),
      ...work('a2', 'frontend-dev', 5, 1),
      ...work('a3', 'qa-reviewer', 9, 1),
    ];
    const s = play(ev);
    expect(s.ring).toBe(1);
    expect([wp(s)?.lot, wp(s, 'w1:frontend-dev')?.lot]).toEqual([
      { x: 10, y: 10, size: 3 },
      { x: 10, y: 3, size: 3 },
    ]);
    const lots = occupiedLots(s); // 집·시설·일터 모두 1칸 이상 떨어진다
    for (const a of lots)
      for (const b of lots)
        if (a !== b)
          expect(
            lotTiles(a).some(([ax, ay]) =>
              lotTiles(b).some(([bx, by]) => Math.abs(ax - bx) <= 1 && Math.abs(ay - by) <= 1),
            ),
          ).toBe(false);
    expect(s.feed.some((f) => f.text.includes('자리가 없음'))).toBe(false);

    const capped = makeConfig({ overrides: { layout: { maxRing: 0 } } });
    const c = play(ev, capped, initialState('p', capped));
    expect(c.ring).toBe(0);
    const out = c.buildings['w1:qa-reviewer']?.lot;
    expect(out && lotTiles(out).every(([x, y]) => x < 0 && y < 0)).toBe(true); // ring 0 맵 [0, 16) 밖
    expect(c.feed.some((f) => f.text === '일터 지을 자리가 없음: qa-reviewer')).toBe(true);
  });

  test('손으로 고친 설정의 일터 층 표가 비었거나 잘못되면 기본 표 (빈 표면 실행마다 새 일터가 생긴다)', () => {
    const row = (points: number, cost: number) => ({ points, cost, level: 1 });
    for (const workplace of [
      { levels: [row(0, 0)] }, // 줄 하나 = 1층이 곧 큰 건물 → 실행마다 새 일터
      { levels: [row(0, 0), row(50, -10)] }, // 자재비 음수 = 돈이 생김
      { levels: [row(0, 0), row(50, 10), row(40, 20)] }, // 점수가 줄어듦
      { levels: [] },
      { levels: 'x' },
      { levels: [{ points: 'a', cost: 0, level: 1 }] },
      { levels: [null] },
      5,
    ])
      expect(makeConfig({ overrides: { workplace } }).workplace.levels, JSON.stringify(workplace)).toEqual(
        cfg.workplace.levels,
      );
    const bad = makeConfig({ overrides: { workplace: { levels: [] } } });
    const s = play([roster, ...work('a1', 'backend-dev', 1, 3), ...work('a2', 'backend-dev', 10, 3)], bad);
    expect(Object.keys(s.buildings)).toEqual(['w1:backend-dev']);
  });
});

describe('성장 시뮬레이션 (15장, 5.3 보정 확인 — ×10 D31)', () => {
  /** 팀원 셋이 도구 15번짜리 실행을 번갈아. 호출 1번당 토큰값(진주): 절약 6.1 · 보통 10.3 · 낭비 20 (06 문서 3.4 실측 분위수). 3바퀴마다 하루 */
  function simulate(rounds: number, level = 1, c: GameConfig = cfg) {
    const perCall: Record<string, number> = { 'qa-reviewer': 6.1, 'backend-dev': 10.3, 'frontend-dev': 20 };
    let s = initialState('p', c);
    s.level = level;
    s = project(s, roster, c);
    const reached: Record<string, number | null> = { 'qa-reviewer': null, 'backend-dev': null, 'frontend-dev': null };
    let sec = 10;
    let day = 0;
    for (let i = 1; i <= rounds; i++) {
      for (const who of Object.keys(perCall)) {
        for (const e of work(`${who}-${i}`, who, sec, 15, { tokens: Math.round((perCall[who] ?? 0) * 15 * 1000) }))
          s = project(s, e, c);
        // ponytail: 끝난 실행은 버린다 — 층·점수·잔고·레벨 규칙은 끝난 실행을 다시 읽지 않는다(버려도 결과가 같음을 확인).
        // 안 버리면 이벤트마다 상태 복사가 실행 수만큼 커져 ×10 시뮬레이션이 30초를 넘는다
        s.runs = Object.fromEntries(Object.entries(s.runs).filter(([, r]) => r.endedAt === null));
        sec += 5;
        if (reached[who] === null && (s.buildings[`w1:${who}`]?.floor ?? 0) >= 2) reached[who] = i;
      }
      if (i % 3 === 0) s = project(s, { t: 'GameDayTick', at: at(sec), day: ++day }, c);
    }
    return { s, reached };
  }
  /** 층 게이지가 차는 실행 수 (도구 15번 = 15점): 2층 50 · 3층 150 · 큰 건물 300 */
  const runsTo = (floor: number) => Math.ceil((cfg.workplace.levels[floor - 1]?.points ?? 0) / 15);

  test('300건(팀원당 100번): 절약형이 먼저, 보통 팀원은 게이지가 찬 뒤(50번째) 그 40% 안에 2층, 낭비형은 더 늦거나 대기', () => {
    const { s, reached } = simulate(2 * runsTo(2));
    expect(reached['backend-dev']).not.toBeNull();
    // 자동 구매가 다음 층 자재비를 남겨(6.4) ×10에서도 보통 팀원은 51번째. 남기지 않으면 가구가 날마다 잔고를 먹어 78번째였다
    expect(reached['backend-dev'] ?? 999).toBeLessThanOrEqual(Math.ceil(runsTo(2) * 1.4));
    expect(reached['qa-reviewer'] ?? 999).toBeLessThanOrEqual(reached['backend-dev'] ?? 999);
    expect(reached['frontend-dev'] === null || (reached['frontend-dev'] ?? 0) > (reached['backend-dev'] ?? 0)).toBe(
      true,
    );
    expect(Object.keys(s.buildings).sort()).toEqual(['w1:backend-dev', 'w1:frontend-dev', 'w1:qa-reviewer']);
  });

  test('480건(팀원당 160번) · 레벨이 안 오르는 마을(Lv.1): 3층 게이지를 넘겨도 모두 2층 이하에서 멈추고 점수는 쌓인다 (5.9 레벨 게이트)', () => {
    const rounds = runsTo(3) + 10;
    const { s } = simulate(
      rounds,
      1,
      makeConfig({ overrides: { village: { levels: [{ points: 0, cost: 0, era: 'village' }] } } }),
    );
    for (const b of Object.values(s.buildings)) expect(b.floor).toBeLessThanOrEqual(2);
    expect(s.buildings['w1:backend-dev']).toMatchObject({ floor: 2, points: rounds * 15, waiting: 'level' });
  });

  test('990건(팀원당 330번) · Lv.7: 절약형은 큰 건물을 지나 두 번째 일터, 보통 팀원은 3층 이상', () => {
    const { s } = simulate(runsTo(4) + 30, 7);
    expect(s.buildings['w2:qa-reviewer']).toBeDefined();
    expect(s.buildings['w1:backend-dev']?.floor ?? 0).toBeGreaterThanOrEqual(3);
  });
});
