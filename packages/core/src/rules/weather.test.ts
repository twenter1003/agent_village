import { expect, test } from 'vitest';
import { defaultConfig as cfg, makeConfig } from '../config/config';
import type { DomainEvent } from '../events/normalize';
import { replay } from '../projector/project';
import type { AgentRun } from '../projector/types';
import { weatherFrom, weatherOf } from './weather';

const run = (i: number, ok: boolean | null, testsPassed = 0, endedAt: number | null = i): AgentRun => ({
  runId: `r${String(i).padStart(2, '0')}`,
  agentType: 'Explore',
  memberId: null,
  visitorKind: 'Explore',
  startedAt: 0,
  endedAt,
  lastAt: 0,
  ok,
  toolCalls: 1,
  failStreak: 0,
  testsPassed,
  testsFailed: 0,
  openPre: {},
});
const runs = (oks: (boolean | null)[], passed = 0) =>
  oks.map((ok, i) => run(i + 1, ok, i >= oks.length - passed ? 1 : 0));
const kind = (rs: AgentRun[], blocked = 0, active = true) => weatherFrom(rs, blocked, active, cfg).kind;

test('위에서부터 먼저: 잔잔 > 폭풍 > 흐림 > 무지개 > 맑음 (06 문서 10장)', () => {
  expect(kind(runs([false, false]), 3, false)).toBe('calm');
  expect(kind([], 2)).toBe('storm');
  expect(kind(runs([true, false]))).toBe('storm'); // 실패 50%
  expect(kind(runs([true, true, true, true, false]), 1)).toBe('cloudy');
  expect(kind(runs([true, true, true, true, false]))).toBe('cloudy'); // 20%
  expect(kind(runs([true, true, true, true, true], 3))).toBe('rainbow');
  expect(kind(runs([true, true, true, true, true], 3), 1)).toBe('cloudy');
  expect(kind([])).toBe('sunny'); // 실행 0개 = 비율 0
});

test('경계값: 실패 비율은 최근 10개, 무지개는 최근 5개 중 통과 3개·실패 0', () => {
  // 오래된 실패 9개는 최근 10개 밖 → 1/10 = 10% → 흐림 아님
  const old = [...Array<boolean>(9).fill(false), false, ...Array<boolean>(9).fill(true)];
  expect(weatherFrom(runs(old), 0, true, cfg)).toMatchObject({ kind: 'sunny', runs: 10, failures: 1 });
  expect(kind(runs([...Array<boolean>(8).fill(true), false, false]))).toBe('cloudy'); // 2/10 = 20%
  expect(kind(runs([...Array<boolean>(6).fill(true), false, false, false, true]))).toBe('cloudy'); // 30%
  expect(kind(runs([...Array<boolean>(5).fill(true), ...Array<boolean>(5).fill(false)]))).toBe('storm'); // 50%
  expect(kind(runs([true, true, true, true, true], 2))).toBe('sunny'); // 통과 2개
  // 최근 5개 밖의 실패 1개(10%)는 무지개를 막지 않는다, 안의 실패는 막는다 (null = 결과 모름 = 실패 아님)
  expect(kind(runs([false, ...Array<boolean>(9).fill(true)], 3))).toBe('rainbow');
  const r = runs([...Array<boolean>(9).fill(true), null], 4);
  expect(weatherFrom(r, 0, true, cfg)).toMatchObject({ kind: 'rainbow', passed: 4, failures: 0 });
  // 기준값은 설정에서
  const strict = makeConfig({ overrides: { weather: { cloudyFailRatio: 0.1, stormBlocked: 'x' } } });
  expect(weatherFrom(runs(old), 0, true, strict).kind).toBe('cloudy'); // 10% ≥ 0.1
  expect(strict.weather.stormBlocked).toBe(2);
});

test('안 끝난 실행은 빼고 endedAt 순으로 센다', () => {
  const rs = [run(20, false), run(0, true), run(5, false, 0, null), ...runs(Array<boolean>(9).fill(true))];
  // 끝난 것 중 가장 늦은 r20(실패)이 최근 10개 안, 가장 이른 r00은 밖
  expect(weatherFrom(rs, 0, true, cfg)).toMatchObject({ runs: 10, failures: 1, kind: 'sunny' });
});

const ev = (e: Record<string, unknown> & { t: DomainEvent['t'] }, ms: number) => ({ ...e, at: ms }) as DomainEvent;
const cap = cfg.time.activeGapCapMs;

test('weatherOf: 일하는 중 = 메인 턴 또는 진행 중 실행, 마지막 훅 이벤트 뒤 activeGapCapMs까지. 막힌 팀원은 팀장 포함', () => {
  const start = [
    ev({ t: 'RosterLoaded', agents: [], tycoon: null }, 0), // 팀장
    ev({ t: 'SessionStarted', project: 'p', sessionId: 's' }, 0),
    ev({ t: 'AgentRunStarted', runId: 'a1', agentType: 'Explore' }, 1000),
  ];
  expect(weatherOf(replay('p', start, cfg), cfg).kind).toBe('sunny');
  // 끝 이벤트를 잃은 실행: 시계 줄이 상한을 넘기면 잔잔
  expect(weatherOf(replay('p', [...start, ev({ t: 'Tick' }, 1000 + cap - 1)], cfg), cfg).kind).toBe('sunny');
  expect(weatherOf(replay('p', [...start, ev({ t: 'Tick' }, 1000 + cap)], cfg), cfg).kind).toBe('calm');
  const ended = [...start, ev({ t: 'AgentRunEnded', runId: 'a1', ok: false }, 2000)];
  expect(weatherOf(replay('p', ended, cfg), cfg)).toMatchObject({ kind: 'calm', runs: 1, failures: 1 });
  // 메인 턴 + 팀장 권한 요청 = 막힘 1 → 흐림이 아니라 실패 100% → 폭풍. 턴이 끝나면 잔잔
  const turn = [
    ...ended,
    ev({ t: 'PromptSubmitted', sessionId: 's', preview: '' }, 3000),
    ev({ t: 'PermissionPrompt', runId: null }, 4000),
  ];
  expect(weatherOf(replay('p', turn, cfg), cfg)).toMatchObject({ kind: 'storm', blocked: 1 });
  expect(weatherOf(replay('p', [...turn, ev({ t: 'MainTurnEnded', sessionId: 's' }, 5000)], cfg), cfg).kind).toBe(
    'calm',
  );
});

test('실패한 실행 = ok false, 또는 테스트가 실패만 하고 통과 없이 끝남 (SubagentStop은 ok가 늘 true)', () => {
  const failedTests = { ...run(1, true), testsFailed: 2 };
  const fixed = { ...run(2, true, 1), testsFailed: 2 }; // 실패 뒤 고쳐서 통과 = 실패 아님
  expect(weatherFrom([failedTests, fixed], 0, true, cfg)).toMatchObject({ kind: 'storm', failures: 1 }); // 1/2
});
