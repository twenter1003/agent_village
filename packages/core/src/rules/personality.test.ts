// 성격 (01 문서 7장) + M8 완료 기준: 한 축이 30 → 60까지 가는 게임 일수, 글자는 55를 넘을 때 한 번만
import { describe, expect, test } from 'vitest';
import { defaultConfig as cfg, makeConfig } from '../config/config';
import { normalize, type DomainEvent } from '../events/normalize';
import { summarize } from '../events/summarize';
import { initialState, project } from '../projector/project';
import type { VillageState } from '../projector/types';
import { moveInAll } from './growth';

const T0 = Date.parse('2026-09-30T00:00:00.000Z');
const DAY = cfg.time.gameDayMs;
const at = (sec: number) => T0 + sec * 1000;
const NAMES = ['backend-dev', 'frontend-dev'];
const roster: DomainEvent = {
  t: 'RosterLoaded',
  at: T0,
  agents: NAMES.map((name) => ({ name, description: '' })),
  tycoon: { members: { 'backend-dev': { job: 'backend' }, 'frontend-dev': { job: 'frontend' } } },
};
/** roster 뒤에는 모두 입주한 마을로 (회의 참가 = 입주한 팀원, 01 문서 3.3) */
const play = (events: DomainEvent[], s: VillageState = initialState('p', cfg)) =>
  events.reduce((x, e) => {
    const y = project(x, e, cfg);
    return e.t === 'RosterLoaded' ? moveInAll(y, e.at, cfg) : y;
  }, s);
const tick = (day: number): DomainEvent => ({ t: 'GameDayTick', at: T0 + day * DAY, day });
const create = (sec: number, id: string): DomainEvent => ({ t: 'TaskCreated', at: at(sec), taskId: id, subject: id });
const status = (sec: number, id: string, s: 'in_progress' | 'completed'): DomainEvent => ({
  t: 'TaskStatusChanged',
  at: at(sec),
  taskId: id,
  status: s,
});
const startRun = (sec: number, runId: string, who: string): DomainEvent => ({
  t: 'AgentRunStarted',
  at: at(sec),
  runId,
  agentType: who,
});
const endRun = (sec: number, runId: string, lastMessage?: string): DomainEvent => ({
  t: 'AgentRunEnded',
  at: at(sec),
  runId,
  ok: true,
  ...(lastMessage === undefined ? {} : { lastMessage }),
});
/** Post 하나 (Pre 없이). kind는 정규화와 같은 표 */
const tool = (sec: number, runId: string, name: string, extra: Partial<Record<'ok' | 'isTest', boolean>> = {}) =>
  normalize(
    summarize({
      _t: new Date(at(sec)).toISOString(),
      hook_event_name: extra.ok === false ? 'PostToolUseFailure' : 'PostToolUse',
      session_id: 's',
      agent_id: runId,
      tool_name: name,
      tool_input: {},
    }),
  ).map((e) => (e.t === 'ToolUsed' ? { ...e, isTest: extra.isTest ?? false } : e));
const edit = (sec: number, runId: string, chars: number): DomainEvent[] =>
  normalize(
    summarize({
      _t: new Date(at(sec)).toISOString(),
      hook_event_name: 'PostToolUse',
      session_id: 's',
      agent_id: runId,
      tool_name: 'Edit',
      tool_input: { file_path: 'a.ts', new_string: 'x'.repeat(chars) },
    }),
  );
/** 작업 하나를 한 팀원이 혼자: 만들기 → 진행 → 실행(도구·메시지) → 완료 */
function solo(sec: number, id: string, who: string, msg?: string, tools: DomainEvent[] = []): DomainEvent[] {
  return [
    create(sec, id),
    status(sec + 1, id, 'in_progress'),
    startRun(sec + 2, `${id}-r`, who),
    ...tools,
    endRun(sec + 50, `${id}-r`, msg),
    status(sec + 51, id, 'completed'),
  ];
}
const sampleOf = (s: VillageState, who: string, taskId: string) =>
  s.members[who]?.personality.samples.find((x) => x.taskId === taskId);

describe('M8 완료 기준: 합성 데이터로 T/F 30 → 60', () => {
  const { emaAlpha, maxDriftPerDay, flipHysteresis } = cfg.personality;
  const [lo = 45, hi = 55] = flipHysteresis;
  // 하루 작업 3개 × 날수. 메시지가 feeling 낱말만이면 표본 T/F = 100
  function days(from: number, n: number, msg: string): DomainEvent[][] {
    return Array.from({ length: n }, (_, k) => {
      const d = from + k;
      const base = (d * DAY) / 1000;
      return [0, 1, 2].flatMap((i) => solo(base + 60 + i * 300, `d${d}t${i}`, 'backend-dev', msg)).concat(tick(d + 1));
    });
  }
  function start() {
    const s = play([roster]);
    const p = s.members['backend-dev']?.personality;
    if (p) p.TF = 30; // ISTJ, T/F만 30에서
    return s;
  }
  const tf = (s: VillageState) => s.members['backend-dev']?.personality.TF ?? NaN;
  const letter = (s: VillageState) => s.members['backend-dev']?.personality.letters[2];

  test('필요한 날수 = ⌈(60 − 30) ÷ maxDriftPerDay⌉ (한도가 늘 걸리는 설정), 글자는 55를 넘는 날 한 번만', () => {
    // 60 근처에서도 EMA 한 걸음이 하루 한도 이상이어야 날수가 한도만으로 정해진다
    expect(emaAlpha * (100 - 60)).toBeGreaterThanOrEqual(maxDriftPerDay);
    const expected = Math.ceil((60 - 30) / maxDriftPerDay);
    expect(expected).toBe(15);
    let s = start();
    let needed = 0;
    const seen: { tf: number; letter?: string }[] = [];
    for (const ev of days(0, 30, 'Thanks, great work! 고마워요')) {
      s = play(ev, s);
      seen.push({ tf: tf(s), letter: letter(s) });
      if (!needed && tf(s) >= 60) needed = seen.length;
    }
    expect(needed).toBe(expected);
    expect(seen.slice(0, 3).map((x) => x.tf)).toEqual([32, 34, 36]); // 하루에 딱 maxDriftPerDay
    const flipDay = seen.findIndex((x) => x.letter === 'F') + 1;
    expect(flipDay).toBe(Math.floor((hi - 30) / maxDriftPerDay) + 1); // 13일째 56
    expect(seen[flipDay - 1]?.tf).toBeGreaterThan(hi);
    expect(seen[flipDay - 2]?.tf).toBeLessThanOrEqual(hi);
    expect(seen.every((x) => x.tf > hi === (x.letter === 'F'))).toBe(true);
    const flips = s.feed.filter((f) => f.kind === 'personality');
    expect(flips.map((f) => f.text)).toEqual(['backend-dev 성격이 T → F로 바뀜 · 보고에 칭찬·고마움 말이 늘어서']);
    expect(s.toasts.filter((x) => x.kind === 'personality').map((x) => x.sticky)).toEqual([false]);
    expect(s.members['backend-dev']?.personality.letters).toBe('ISFJ');
  });

  test('45~55 사이에선 글자가 그대로, 45 아래로 가야 T로 돌아간다 (히스테리시스)', () => {
    let s = start();
    for (const ev of days(0, 20, 'thanks')) s = play(ev, s); // 70
    expect(tf(s)).toBe(70);
    const seen: { tf: number; letter?: string }[] = [];
    for (const ev of days(20, 40, 'error: must fix because it fails')) {
      s = play(ev, s);
      seen.push({ tf: tf(s), letter: letter(s) });
    }
    const band = seen.filter((x) => x.tf >= lo && x.tf <= hi);
    expect(band.length).toBeGreaterThan(3);
    expect(band.every((x) => x.letter === 'F')).toBe(true);
    expect(seen.every((x) => x.tf < lo === (x.letter === 'T'))).toBe(true);
    expect(s.feed.filter((f) => f.kind === 'personality').map((f) => f.text)).toEqual([
      'backend-dev 성격이 T → F로 바뀜 · 보고에 칭찬·고마움 말이 늘어서',
      'backend-dev 성격이 F → T로 바뀜 · 보고에 원인·오류 이야기가 늘어서',
    ]);
  });

  test('바뀌는 중: 반대쪽 목표가 당기는 축, 기준점 25 → 뒤집히는 선 55까지 간 비율', () => {
    let s = start();
    const [d1, d2] = days(0, 2, 'thanks');
    s = play(d1 ?? [], s);
    // 32 → (32 − 25) ÷ (55 − 25) = 23%
    expect(s.members['backend-dev']?.personality.drifting).toEqual({ axis: 'TF', toward: 'F', percent: 23 });
    s = play(d2 ?? [], s);
    expect(s.members['backend-dev']?.personality.drifting?.percent).toBe(30);
    for (const ev of days(2, 12, 'thanks')) s = play(ev, s);
    expect(letter(s)).toBe('F');
    expect(s.members['backend-dev']?.personality.drifting).toBeNull(); // 목표가 이미 같은 쪽
  });

  test('목표가 50은 넘어도 뒤집히는 선(55·45)을 못 넘으면 바뀌는 중이 아니다 (M8 리뷰)', () => {
    // 보고마다 thanks 8 · error 7 → 표본 T/F 53.3: 점수가 53.3에 머물러 T 그대로 — 전엔 "T가 F 쪽으로 94%"가 영영 떴음
    let s = start();
    for (const ev of days(0, 60, 'thanks '.repeat(8) + 'error '.repeat(7))) s = play(ev, s);
    expect(tf(s)).toBeCloseTo(160 / 3, 1);
    expect(letter(s)).toBe('T');
    expect(s.members['backend-dev']?.personality.drifting).toBeNull();
    // 뒤 글자 쪽도 같게: F(70)에서 목표 46.7이면 F 그대로, 바뀌는 중 아님
    s = start();
    for (const ev of days(0, 20, 'thanks')) s = play(ev, s);
    for (const ev of days(20, 60, 'thanks '.repeat(7) + 'error '.repeat(8))) s = play(ev, s);
    expect(tf(s)).toBeCloseTo(140 / 3, 1);
    expect(letter(s)).toBe('F');
    expect(s.members['backend-dev']?.personality.drifting).toBeNull();
  });

  test('keepLastMessage를 끄면 그때부터 T/F는 멈춘다 — 창 안 옛 표본도 당기지 않는다 (M8 리뷰)', () => {
    let s = start();
    for (const ev of days(0, 5, 'thanks')) s = play(ev, s);
    expect(tf(s)).toBe(40);
    const off = makeConfig({ overrides: { collector: { keepLastMessage: false } } });
    for (const ev of days(5, 5, '')) s = ev.reduce((x, e) => project(x, e, off), s); // 끈 뒤엔 메시지가 없다
    expect(tf(s)).toBe(40);
    expect(s.members['backend-dev']?.personality.drifting).toBeNull();
  });

  test('window 0이면 표본을 남기지 않는다 — 성격이 안 움직이고 쌓이지 않는다 (M8 리뷰)', () => {
    const zero = makeConfig({ overrides: { personality: { window: 0 } } });
    const s = days(0, 3, 'thanks')
      .flat()
      .reduce((x, e) => project(x, e, zero), start());
    expect(s.members['backend-dev']?.personality.samples).toEqual([]);
    expect(tf(s)).toBe(30);
  });

  test('driftToday는 틱마다 0 — 시계가 며칠을 건너뛰어도 한 번', () => {
    let s = play(days(0, 1, 'thanks')[0]?.slice(0, -1) ?? [], start());
    expect(s.members['backend-dev']?.personality.driftToday.TF).toBe(2);
    s = play([tick(7)], s);
    expect(s.members['backend-dev']?.personality.driftToday).toEqual({ EI: 0, SN: 0, TF: 0, JP: 0 });
  });

  test('같은 이벤트를 두 번 재생하면 같은 상태, 입력은 그대로', () => {
    const ev = [roster, ...days(0, 20, 'thanks 고마워요').flat()];
    const copy = structuredClone(ev);
    expect(play(ev)).toEqual(play(ev));
    expect(ev).toEqual(copy);
  });
});

describe('7장 지표 (축마다 표본 값)', () => {
  test('E/I: 혼자 = 1 − 다른 팀원과 겹친 비율, 불참 = 가장 최근 회의에 없었음', () => {
    // 회의 뒤 backend [10, 110], frontend [60, 110] (킥오프 창 10초 밖). 둘 다 회의 참석
    const ev: DomainEvent[] = [
      roster,
      { t: 'PromptSubmitted', at: at(1), sessionId: 's', preview: 'go' },
      create(2, 't1'),
      status(5, 't1', 'in_progress'),
      startRun(10, 'a', 'backend-dev'),
      startRun(60, 'b', 'frontend-dev'),
      endRun(110, 'a'),
      endRun(110, 'b'),
      status(111, 't1', 'completed'),
    ];
    const s = play(ev);
    expect(sampleOf(s, 'backend-dev', 't1')?.EI).toBe(25); // 평균(0.5, 0)
    expect(sampleOf(s, 'frontend-dev', 't1')?.EI).toBe(0); // 평균(0, 0)
    // 회의가 없으면 불참은 빼고 혼자만
    expect(sampleOf(play(ev.filter((e) => e.t !== 'PromptSubmitted')), 'backend-dev', 't1')?.EI).toBe(50);
    // 이유: E/I가 가장 멀리(75 → 25), 앞 글자 쪽에서 가장 큰 세부 지표 = 참석(1) > 동시(0.5)
    expect(s.members['backend-dev']?.personality.reason).toBe('회의에 꼬박꼬박 나와서');
  });

  test('E/I: 일하는 동안 열린 회의에 빠지면 불참 1, 혼자면 100', () => {
    const s = play([
      roster,
      create(2, 't1'),
      status(5, 't1', 'in_progress'),
      startRun(10, 'a', 'backend-dev'),
      { t: 'PromptSubmitted', at: at(20), sessionId: 's', preview: 'go' }, // backend는 실행 중이라 빠짐
      endRun(50, 'a'),
      status(51, 't1', 'completed'),
    ]);
    expect(sampleOf(s, 'backend-dev', 't1')?.EI).toBe(100);
    expect(s.members['frontend-dev']?.personality.lastMeetingAt).toBe(at(20));
    expect(s.members['backend-dev']?.personality.lastMeetingAt).toBeNull();
  });

  test('S/N: 읽기·검색·작은 편집·테스트 vs Write·웹·큰 편집 (chars ≥ bigEditChars), 셸·계획은 안 셈', () => {
    const r = 't1-r';
    const tools = [
      ...tool(10, r, 'Read'),
      ...tool(11, r, 'Grep'),
      ...edit(12, r, 10),
      ...tool(13, r, 'Bash', { isTest: true }),
      ...tool(14, r, 'Write'),
      ...tool(15, r, 'WebSearch'),
      ...edit(16, r, cfg.personality.bigEditChars),
      ...tool(17, r, 'Bash'),
      ...tool(18, r, 'TodoWrite'),
    ];
    const s = play([roster, ...solo(0, 't1', 'backend-dev', undefined, tools)]);
    expect(sampleOf(s, 'backend-dev', 't1')?.SN).toBeCloseTo((100 * 3) / 7);
    const one = ['read', 'search', 'edit', 'test', 'write', 'web', 'bigEdit', 'shell', 'plan'].map((k) => [k, 1]);
    expect(s.runs[r]?.habits?.kinds).toEqual(Object.fromEntries(one));
    // 도구가 없으면 null
    expect(sampleOf(play([roster, ...solo(0, 't1', 'backend-dev')]), 'backend-dev', 't1')?.SN).toBeNull();
  });

  test('T/F: 최종 메시지의 lexicon 낱말 수 (대소문자 무시, 부분 문자열), 메시지가 없으면 null', () => {
    const msg = 'Fixed the ERROR because of a typo. Thanks!'; // fix·error·because = 3, thanks = 1
    const s = play([roster, ...solo(0, 't1', 'backend-dev', msg)]);
    expect(sampleOf(s, 'backend-dev', 't1')?.TF).toBe(25);
    expect(sampleOf(play([roster, ...solo(0, 't1', 'backend-dev')]), 'backend-dev', 't1')?.TF).toBeNull();
  });

  test('J/P: 순서 바뀜 · 재시도 · 도구 전환', () => {
    const r = 't1-r';
    const s = play([
      roster,
      create(0, 't1'),
      create(1, 't2'),
      // t2를 먼저 끝냄 (앞 표본 없음 → 순서 0), 도구 없음 → 평균(0) = 0
      status(10, 't2', 'in_progress'),
      startRun(11, 't2-r', 'backend-dev'),
      endRun(20, 't2-r'),
      status(21, 't2', 'completed'),
      // t1: 앞 표본(t2)이 더 나중에 만든 작업 → 순서 1. Bash 실패 → Bash(재시도) → Read(전환)
      status(30, 't1', 'in_progress'),
      startRun(31, r, 'backend-dev'),
      ...tool(32, r, 'Bash', { ok: false }),
      ...tool(33, r, 'Bash'),
      ...tool(34, r, 'Read'),
      endRun(40, r),
      status(41, 't1', 'completed'),
    ]);
    expect(sampleOf(s, 'backend-dev', 't2')?.JP).toBe(0);
    expect(s.runs[r]?.habits).toMatchObject({ retries: 1, switches: 1 });
    expect(sampleOf(s, 'backend-dev', 't1')?.JP).toBeCloseTo((100 * (1 + 1 / 3 + 1 / 2)) / 3);
  });

  test('실행이 없으면 팀장 표본(회의·순서만), 외부인은 표본 없음', () => {
    const s = play([
      roster,
      create(0, 't1'),
      status(1, 't1', 'in_progress'),
      startRun(2, 'x', 'Explore'),
      endRun(9, 'x'),
      status(10, 't1', 'completed'),
      create(20, 't2'),
      status(21, 't2', 'completed'), // 실행 없음 → 팀장
    ]);
    expect(Object.values(s.members).flatMap((m) => m.personality.samples.map((x) => x.taskId))).toEqual(['t2']);
    expect(sampleOf(s, '@leader', 't2')).toMatchObject({ EI: null, SN: null, TF: null, JP: 0 });
  });
});

describe('개인 정보 (02 문서 2.3)', () => {
  test('메시지 원문은 실행의 lastMessage(요약본)에만, 성격·기록·토스트엔 숫자와 고정 문장뿐', () => {
    const secret = 'SECRET-만세-4242';
    const s = play([roster, ...solo(0, 't1', 'backend-dev', `${secret} thanks`)]);
    const { runs, ...rest } = s;
    expect(JSON.stringify(rest)).not.toContain(secret);
    expect(Object.values(runs).filter((r) => r.lastMessage?.includes(secret))).toHaveLength(1);
    expect(sampleOf(s, 'backend-dev', 't1')?.TF).toBe(100);
  });

  test('keepLastMessage: false면 메시지가 없어 T/F는 null', () => {
    const raw = { _t: new Date(at(50)).toISOString(), hook_event_name: 'SubagentStop', agent_id: 't1-r' };
    const stop = normalize(summarize({ ...raw, last_assistant_message: 'thanks' }, { keepLastMessage: false }));
    const ev = solo(0, 't1', 'backend-dev').map((e) => (e.t === 'AgentRunEnded' ? (stop[0] ?? e) : e));
    expect(sampleOf(play([roster, ...ev]), 'backend-dev', 't1')?.TF).toBeNull();
  });

  test('편집 크기는 숫자(chars)로만 온다', () => {
    const [e] = edit(1, 'r', 500);
    expect(e).toMatchObject({ t: 'ToolUsed', kind: 'edit', chars: 500 });
    expect(JSON.stringify(e)).not.toContain('xxx');
  });

  test('MultiEdit(edits[].new_string 합)·NotebookEdit(new_source)도 크기를 잰다 (M8 리뷰)', () => {
    const use = (tool_name: string, tool_input: object) =>
      normalize(summarize({ _t: new Date(at(1)).toISOString(), hook_event_name: 'PreToolUse', tool_name, tool_input }));
    const multi = use('MultiEdit', {
      file_path: 'a.ts',
      edits: [{ old_string: 'a', new_string: 'x'.repeat(300) }, { old_string: 'b', new_string: 'x'.repeat(200) }, {}],
    });
    expect(multi).toMatchObject([{ t: 'ToolUsed', kind: 'edit', chars: 500 }]);
    expect(use('NotebookEdit', { notebook_path: 'a.ipynb', new_source: 'x'.repeat(450) })).toMatchObject([
      { t: 'ToolUsed', kind: 'edit', chars: 450 },
    ]);
    expect(JSON.stringify(multi)).not.toContain('xxx');
  });
});
