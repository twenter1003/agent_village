// 마을 신문 계산 (06 문서 9장): 이 컴퓨터 날짜로 묶기 · 1면 · 기사 · 단신 · 옆 칸. 시각은 로컬 Date로 만들어 시간대와 무관
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { defaultConfig as cfg, type AgentRun, type DayRecord, type Task, type VillageState } from '@tycoon/core';
import { dayKey, isDayKey, paper, workDays } from './paper';

const at = (d: number, h: number, min = 0) => new Date(2026, 9, d, h, min).getTime(); // 2026-10-d h:min (로컬)
const TODAY = '2026-10-03';

const task = (id: string, toolCalls: number, done: number | undefined, x: Partial<Task> = {}): Task => ({
  id,
  subject: `작업 ${id}`,
  status: done === undefined ? 'in_progress' : 'completed',
  createdAt: at(1, 9),
  startedAt: done === undefined ? undefined : done - 90_000,
  completedAt: done,
  contributions: { 'backend-dev': 1000 },
  quality: 'noTests',
  toolCalls,
  salaryPaid: 0,
  ...x,
});
const run = (runId: string, memberId: string | null, endedAt: number, x: Partial<AgentRun> = {}): AgentRun => ({
  runId,
  agentType: memberId ?? 'Explore',
  memberId,
  visitorKind: memberId ? null : 'Explore',
  startedAt: endedAt - 60_000,
  endedAt,
  lastAt: endedAt,
  ok: true,
  toolCalls: 5,
  failStreak: 0,
  testsPassed: 0,
  testsFailed: 0,
  openPre: {},
  ...x,
});
const rec = (when: number, x: Partial<DayRecord>): DayRecord => ({
  day: 1,
  at: when,
  wages: 0,
  tax: 0,
  purchases: 0,
  tokens: 0,
  leaderTokens: 0,
  leaderUnpaid: 0,
  leaderPurchases: 0,
  materials: 0,
  works: 0,
  fund: 0,
  balances: {},
  ...x,
});

function village(): VillageState {
  const s = JSON.parse(
    readFileSync(join(import.meta.dirname, '../../../../../fixtures/sample-session.golden.json'), 'utf8'),
  ) as VillageState;
  s.tasks = Object.fromEntries(
    [
      // 오늘: A(도구 10·통과, 기여는 frontend-dev가 큼) > B(5) > C(2 = 단신)
      task('A', 10, at(3, 15), {
        quality: 'testsPassed',
        contributions: { 'backend-dev': 5000, 'frontend-dev': 9000 },
        summary: '주문 API를 붙였어요.',
      }),
      task('B', 5, at(3, 11)),
      task('C', 2, at(3, 23, 59)),
      task('D', 30, at(2, 23, 59)), // 어제 (자정 전)
      task('E', 30, undefined), // 아직 하는 중
      task('F', 1, at(5, 10)), // 실행 없이 끝낸 작업만 있는 날
    ].map((x) => [x.id, x]),
  );
  s.runs = Object.fromEntries(
    [
      run('r1', 'backend-dev', at(3, 10), { toolCalls: 10, testsPassed: 1, tokens: 12_000, wage: 312 }),
      run('r2', 'frontend-dev', at(3, 12), { toolCalls: 5, tokens: 3_000, wage: 130 }),
      run('r3', null, at(3, 13), { tokens: 1_499 }), // 외부인: 급여 없음, 토큰값은 셈
      run('r4', 'backend-dev', at(2, 10), { tokens: 99_000, wage: 999 }), // 어제
      run('r5', 'qa-reviewer', at(3, 9), { endedAt: null }), // 안 끝남
    ].map((r) => [r.runId, r]),
  );
  s.feed = [
    { at: at(2, 12), kind: 'task', text: '마을 레벨 Lv.2', ref: '@level:2:village' }, // 어제
    { at: at(3, 12), kind: 'task', text: '마을 레벨 Lv.3', ref: '@level:3:town' },
    { at: at(3, 12), kind: 'task', text: 'backend-dev 일터 2층 완공', ref: 'w1:backend-dev' },
    { at: at(3, 12), kind: 'economy', text: 'backend-dev 일터 3층 자재비 대기 · 100', ref: 'w1:backend-dev' },
    { at: at(3, 12), kind: 'task', text: 'backend-dev 2번째 일터 부지를 잡았어요', ref: 'w2:backend-dev' },
  ];
  s.clock.now = at(3, 16);
  s.economy.history = [];
  s.economy.today = { ...s.economy.today, tax: 0, leaderTokens: 0, leaderPurchases: 0, works: 0 };
  const b = s.members['backend-dev'];
  if (b) b.receipt.parts = { base: 100 }; // 기본 맥락 100% → 처방 팁 base
  return s;
}

test('하루 = 이 컴퓨터 날짜 (자정 기준)', () => {
  expect(dayKey(at(3, 23, 59))).toBe('2026-10-03');
  expect(dayKey(at(4, 0))).toBe('2026-10-04');
  expect(['2026-10-03', '2026-02-30', '2026-13-01', 'nope'].map(isDayKey)).toEqual([true, false, false, false]);
});

test('1면 = 일 점수가 가장 큰 작업, 나머지는 기사(점수 순)·단신(도구 2번 이하). 그날 끝낸 작업만', () => {
  const p = paper(village(), cfg, [], TODAY);
  expect(p.front).toMatchObject({ task: { id: 'A' }, points: 12, who: 'frontend-dev', ms: 90_000 });
  expect(p.subs.map((x) => x.task.id)).toEqual(['B']);
  expect(p.briefs.map((x) => x.task.id)).toEqual(['C']);
  expect(p.side.done).toBe(3);
  expect(paper(village(), cfg, [], '2026-10-02').front?.task.id).toBe('D');
});

test('옆 칸: 번 진주·쓴 토큰값·기금·레벨업·층 올림·효율 1등·날씨·팁', () => {
  const s = village();
  s.economy.today = { ...s.economy.today, tax: 5, leaderTokens: 2 }; // 오늘(마지막 이벤트 날) 정산 전 몫
  const history = [
    rec(at(3, 1), { tax: 60, leaderTokens: 7, leaderPurchases: 10, works: 100 }),
    rec(at(2, 1), { tax: 999 }), // 어제
  ];
  const { side } = paper(s, cfg, history, TODAY);
  expect(side.earned).toBe(312 + 130);
  // 실행마다 반올림(청구와 같게) 12 + 3 + 1, 팀장 7 + 2
  expect(side.spent).toBe(12 + 3 + 1 + 7 + 2);
  expect(side.fund).toBe(60 + 5 - 7 - 2 - 10 - 100);
  expect(side.growth.map((f) => f.ref)).toEqual(['@level:3:town', 'w1:backend-dev']);
  // backend 12000 ÷ (10 × 1.2) = 1000, frontend 3000 ÷ 5 = 600 → frontend
  expect(side.best).toEqual({ id: 'frontend-dev', perPoint: 600 });
  expect(side.weather.kind).toBe('sunny');
  // 토큰을 가장 많이 쓴 팀원 = backend-dev
  expect(side.tip).toEqual({ id: 'backend-dev', tip: expect.objectContaining({ key: 'base' }) });
});

test('일이 없는 날: 빈 신문, 기록 없음, 잔잔', () => {
  const p = paper(village(), cfg, [], '2026-09-01');
  expect(p.front).toBeNull();
  expect(p.side).toMatchObject({ done: 0, earned: 0, spent: 0, fund: null, growth: [], best: null, tip: null });
  expect(p.side.weather.kind).toBe('calm');
});

test('달력 점: 그날 끝난 실행의 일 점수 합, 작업만 끝낸 날도 점', () => {
  const days = workDays(village(), cfg);
  expect(days.get(TODAY)).toBe(12 + 5 + 5);
  expect(days.get('2026-10-02')).toBe(5);
  expect(days.get('2026-10-05')).toBe(0);
  expect(days.has('2026-10-04')).toBe(false);
});
