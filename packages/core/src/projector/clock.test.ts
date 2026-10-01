// 게임 시간 = 활동 시간 (01 문서 6.2, D4 2026-09-30): 에이전트가 일하는 동안만 날이 간다. 프로젝터가 GameDayTick을 만든다
import { describe, expect, test } from 'vitest';
import { defaultConfig as cfg, makeConfig, type GameConfig } from '../config/config';
import { normalize, type DomainEvent } from '../events/normalize';
import { activeUntil, initialState, project, replay } from './project';
import type { VillageState } from './types';

const T0 = Date.parse('2026-09-30T00:00:00.000Z');
const MIN = 60_000;
const DAY = cfg.time.gameDayMs; // 1시간
const CAP = cfg.time.activeGapCapMs; // 10분
const at = (min: number) => T0 + min * MIN;
const roster: DomainEvent = {
  t: 'RosterLoaded',
  at: T0,
  agents: [{ name: 'backend-dev', description: '' }],
  tycoon: null,
};
const play = (events: DomainEvent[], c: GameConfig = cfg, s: VillageState = initialState('p', c)) =>
  events.reduce((x, e) => project(x, e, c), s);
const start = (min: number, runId = 'r1'): DomainEvent => ({
  t: 'AgentRunStarted',
  at: at(min),
  runId,
  agentType: 'backend-dev',
});
const end = (min: number, runId = 'r1'): DomainEvent => ({ t: 'AgentRunEnded', at: at(min), runId, ok: true });
const tool = (min: number, runId: string | null = 'r1'): DomainEvent => ({
  t: 'ToolUsed',
  at: at(min),
  runId,
  tool: 'Read',
  phase: 'post',
  ok: true,
  kind: 'read',
  isTest: false,
});
const tick = (min: number): DomainEvent => ({ t: 'Tick', at: at(min) });
const prompt = (min: number): DomainEvent => ({ t: 'PromptSubmitted', at: at(min), sessionId: 's', preview: '' });

describe('활동 시간', () => {
  test('쉬는 틈(열린 실행·메인 턴 없음)은 시간이 안 간다', () => {
    const s = play([
      roster,
      { t: 'SessionStarted', at: at(0), project: 'p', sessionId: 's' },
      { t: 'TaskCreated', at: at(60), taskId: 't1', subject: 'x' },
      start(24 * 60),
    ]);
    expect(s.clock).toMatchObject({ activeMs: 0, day: 0, now: at(24 * 60) });
    expect(s.economy.history).toEqual([]);
    expect(activeUntil(s, cfg)).toBe(at(24 * 60) + CAP); // 마지막 실행이 열림 → 다음 이벤트부터 센다
  });

  test('프롬프트를 못 봤어도 메인 세션 도구 호출이 오면 메인 턴이 열린다 (훅·수집기를 턴 도중에 켬, 01 문서 6.2)', () => {
    const s = play([roster, tool(0, null), tool(4, null), tool(30, null)]);
    // 0~4분 + 4분 뒤 상한 10분(14분)까지 → 14분, 30분 호출은 새 틈이 아니라 상한에 막힘
    expect(s.clock).toMatchObject({ mainTurn: true, activeMs: 14 * MIN });
    expect(s.foundedAt).toBe(at(0)); // 첫 일 = 마을 세우기 (01 문서 3.3)
  });

  test('실행 하나를 열어 둔 채 딱 gameDayMs → 정산 한 번, 그 전엔 0', () => {
    const ev = [roster, start(0), ...Array.from({ length: 12 }, (_, i) => tool(5 * (i + 1)))]; // 5분마다, 60분까지
    const before = play(ev.slice(0, -1));
    expect(before.clock).toMatchObject({ activeMs: 55 * MIN, day: 0 });
    const s = play(ev);
    expect(s.clock).toMatchObject({ activeMs: DAY, day: 1 });
    expect(s.economy.history.map((r) => [r.day, r.at])).toEqual([[1, at(60)]]); // 틱 at = 날을 넘긴 이벤트 시각
    expect(play([end(61)], cfg, s).economy.history).toHaveLength(1);
  });

  test('진짜 이벤트가 끊긴 틈은 activeGapCapMs까지만 — Tick이 몇 번 와도 늘지 않는다', () => {
    // 실행이 버려짐(SubagentStop 유실): 다음 이벤트가 3시간 뒤여도 10분
    expect(play([roster, start(0), tool(180)]).clock.activeMs).toBe(CAP);
    // 시계 줄: 1분마다 30번 → 마지막 진짜 이벤트(0분)에서 10분까지만. 그 뒤 진짜 이벤트가 오면 거기서 다시 센다
    const ticks = Array.from({ length: 30 }, (_, i) => tick(i + 1));
    const s = play([roster, start(0), ...ticks]);
    expect(s.clock).toMatchObject({ activeMs: CAP, lastEventAt: at(0), now: at(30) });
    expect(play([tool(40), tick(41)], cfg, s).clock.activeMs).toBe(CAP + MIN);
  });

  test('메인 턴(PromptSubmitted ~ MainTurnEnded)도 일하는 중', () => {
    const s = play([roster, prompt(0), tool(3, null), { t: 'MainTurnEnded', at: at(5), sessionId: 's' }]);
    expect(s.clock).toMatchObject({ activeMs: 5 * MIN, mainTurn: false });
    expect(play([prompt(100)], cfg, s).clock.activeMs).toBe(5 * MIN); // 끝난 턴 뒤 쉰 95분은 안 셈
    expect(play([prompt(100)], cfg, s).clock.mainTurn).toBe(true);
  });

  test('새 세션·세션 끝은 메인 턴을 닫는다 (Stop 유실)', () => {
    for (const close of [
      { t: 'SessionStarted', at: at(2), project: 'p', sessionId: 's2' },
      { t: 'SessionEnded', at: at(2), sessionId: 's' },
    ] as DomainEvent[]) {
      const s = play([roster, prompt(0), close, tick(9)]);
      expect(s.clock).toMatchObject({ activeMs: 2 * MIN, mainTurn: false });
    }
  });

  test('SubagentStop을 잃은 실행은 그 실행의 마지막 이벤트 뒤 10분만 — 다음 턴들이 되살리지 않는다 (리뷰)', () => {
    const stop = (min: number): DomainEvent => ({ t: 'MainTurnEnded', at: at(min), sessionId: 's' });
    const ticks = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => tick(from + i)); // 수집기 시계 줄
    // 턴마다 2분 일하고 20분 쉼. 첫 턴에서 연 실행 'lost'는 끝이 안 옴
    const turn = (k: number) => [
      prompt(22 * k),
      tool(22 * k + 1, null),
      stop(22 * k + 2),
      ...ticks(22 * k + 3, 22 * k + 22),
    ];
    const first = [prompt(0), start(0, 'lost'), tool(1, 'lost'), stop(2), ...ticks(3, 22)];
    const s = play([roster, ...first, ...turn(1), ...turn(2), ...turn(3)]);
    expect(s.runs.lost?.endedAt).toBeNull();
    expect(s.clock.activeMs).toBe(11 * MIN + 3 * 2 * MIN); // 첫 턴은 실행의 마지막 이벤트(1분) + 10분, 나머지 턴은 2분씩
    expect(activeUntil(s, cfg)).toBe(at(11)); // 수집기도 시계 줄을 더 넣지 않는다
  });

  test('사용자 행동·팀원 목록은 상한을 다시 열지 않는다, 중단된 턴(Stop 없음)은 idle_prompt가 닫는다 (리뷰)', () => {
    const rename: DomainEvent = { t: 'BuildingRenamed', at: at(9), buildingId: 'b1', name: 'x' };
    const buy: DomainEvent = {
      t: 'FurniturePurchased',
      at: at(19),
      memberId: 'backend-dev',
      kind: 'bed',
      fabric: null,
    };
    // 중단된 턴: 마지막 도구(1분) 뒤 10분만. 9·19분에 마을을 만지고 팀원 목록을 다시 읽어도 늘지 않는다
    const s = play([
      roster,
      prompt(0),
      tool(1, null),
      tick(5),
      rename,
      tick(15),
      buy,
      { ...roster, at: at(20) },
      tick(25),
    ]);
    expect(s.clock).toMatchObject({ activeMs: 11 * MIN, lastEventAt: at(1), mainTurn: true });
    const idle = (hook: string, extra = {}) =>
      normalize({ _t: new Date(at(2)).toISOString(), hook_event_name: hook, session_id: 's', ...extra });
    for (const end of [idle('Notification', { notification_type: 'idle_prompt' }), idle('StopFailure'), idle('Stop')]) {
      expect(end).toEqual([{ t: 'MainTurnEnded', at: at(2), sessionId: 's' }]);
      expect(play([roster, prompt(0), tool(1, null), ...end, tick(30)]).clock).toMatchObject({
        activeMs: 2 * MIN,
        mainTurn: false,
      });
    }
  });

  test('늦게 온 이벤트(시각이 앞)는 시간을 되돌리거나 더하지 않는다', () => {
    const s = play([roster, start(0), tool(8), tool(3)]);
    expect(s.clock).toMatchObject({ activeMs: 8 * MIN, now: at(8), lastEventAt: at(8) });
  });

  test('한 이벤트가 여러 날을 넘으면 GameDayTick 한 번에 날마다 정산, 성격 하루 한도도 풀림', () => {
    const short = makeConfig({ overrides: { time: { gameDayMs: MIN } } });
    const s0 = play([roster, start(0)], short);
    const bd = s0.members['backend-dev'];
    if (bd) bd.personality.driftToday.TF = 2;
    const s = play([tool(5)], short, s0);
    expect(s.clock.day).toBe(5);
    expect(s.economy.history.map((r) => r.day)).toEqual([1, 2, 3, 4, 5]);
    expect(s.members['backend-dev']?.personality.driftToday.TF).toBe(0);
  });

  test('하루 길이를 바꾸면 지금 날에서 이어 간다 — 지난 활동을 새 길이로 다시 나누지 않음 (M9 설정)', () => {
    const s0 = play([roster, start(0), ...[10, 20, 30, 40, 50].map((m) => tool(m))]);
    expect(s0.clock).toMatchObject({ day: 0, activeMs: 50 * MIN, dayMs: DAY });
    // 60분 → 10분: 설정이 바뀌는 roster 줄에서 오늘 지난 50분은 새 하루 한 번만큼 → 1일 (floor(50 / 10)이면 5일 정산)
    const ten = makeConfig({ overrides: { time: { gameDayMs: 10 * MIN } } });
    const s1 = play([{ ...roster, at: at(50) }], ten, s0);
    expect(s1.clock).toMatchObject({ day: 1, dayMs: 10 * MIN, dayStartMs: 50 * MIN });
    expect(s1.economy.history.map((r) => r.day)).toEqual([1]);
    expect(play([tool(59)], ten, s1).clock.day).toBe(1);
    expect(play([tool(59), tool(60)], ten, s1).clock.day).toBe(2);
    // 60분 → 120분: 오늘이 길어질 뿐
    const long = makeConfig({ overrides: { time: { gameDayMs: 120 * MIN } } });
    const l = play([tool(55)], long, s0);
    expect(l.clock).toMatchObject({ day: 0, dayMs: 120 * MIN, dayStartMs: 0 });
    expect(
      play(
        [65, 75, 85, 95, 105, 115].map((m) => tool(m)),
        long,
        l,
      ).clock.day,
    ).toBe(0);
    expect(
      play(
        [65, 75, 85, 95, 105, 115, 120].map((m) => tool(m)),
        long,
        l,
      ).clock.day,
    ).toBe(1);
  });

  test('줄일 때 설정이 바뀌는 이벤트의 틈도 먼저 더한 뒤 자른다 — 새 하루는 한 번만 (M9 리뷰)', () => {
    const s0 = play([roster, start(0), ...[10, 20, 30, 40, 50].map((m) => tool(m))]); // 마지막 훅 50분, 실행은 열림
    const one = makeConfig({ overrides: { time: { gameDayMs: MIN } } });
    const s = play([{ ...roster, at: at(60) }], one, s0); // 10분 틈 뒤에 1분 하루로
    expect(s.clock).toMatchObject({ activeMs: 60 * MIN, day: 1, dayStartMs: 60 * MIN });
    expect(s.economy.history.map((r) => r.day)).toEqual([1]);
  });

  test('손으로 고친 이상한 하루 길이는 기본값 — 날이 NaN으로 멈추거나 정산이 끝없이 돌지 않는다 (M9 리뷰)', () => {
    for (const gameDayMs of ['1h', {}, 0, true, -5, 1.5, null])
      expect(makeConfig({ overrides: { time: { gameDayMs } } }).time.gameDayMs).toBe(DAY);
    expect(makeConfig({ overrides: { time: { activeGapCapMs: 'x' } } }).time).toMatchObject({ activeGapCapMs: CAP });
    expect(makeConfig({ overrides: { time: 5 } }).time).toMatchObject({ gameDayMs: DAY, activeGapCapMs: CAP });
    expect(makeConfig({ overrides: { time: { gameDayMs: 2000 } } }).time.gameDayMs).toBe(2000); // e2e 값은 그대로
    const bad = makeConfig({ overrides: { time: { gameDayMs: '1h' } } });
    const s = play([roster, start(0), ...[10, 20, 30, 40, 50, 60].map((m) => tool(m))], bad);
    expect(s.clock).toMatchObject({ day: 1, dayStartMs: DAY });
  });

  test("수집기 'clock' 줄 → Tick (옛 줄의 벽시계 day는 버림), 재생은 결정적", () => {
    const _t = new Date(at(90)).toISOString();
    expect(normalize({ _t, hook_event_name: 'clock', cwd: '/w', day: 5 })).toEqual([{ t: 'Tick', at: at(90) }]);
    // 쉬는 마을에 옛 시계 줄이 와도 날은 그대로
    const idle = play([roster, ...normalize({ _t, hook_event_name: 'clock', cwd: '/w', day: 5 })]);
    expect(idle.clock).toMatchObject({ day: 0, activeMs: 0, now: at(90), lastEventAt: 0 }); // 팀원 목록·시계 줄은 훅 이벤트가 아님
    const ev = [roster, start(0), tool(5), tick(10), end(12), tool(120, null), start(130, 'r2'), tick(135)];
    const s = replay('p', ev, cfg);
    expect(s.clock.activeMs).toBe(27 * MIN); // 0~12분 + 120분 메인 도구 호출이 턴을 열어 120~135분
    expect(replay('p', structuredClone(ev), cfg)).toEqual(s);
    expect(play(ev.slice(4), cfg, play(ev.slice(0, 4)))).toEqual(s); // 중간 상태에서 이어 가도 같음
  });
});
