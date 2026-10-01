import { seedPersonality } from './personality';
import { expect, test } from 'vitest';
import { makeConfig } from '../config/config';
import type { DomainEvent } from '../events/normalize';
import { initialState } from '../projector/project';
import { LEADER_ID, type Member, type VillageState } from '../projector/types';
import { applyMeeting } from './meeting';
import { applyRuns } from './runs';
import { deriveStatus } from './status';

const cfg = makeConfig();
const mem = (id: string): Member => ({
  id,
  slot: 1,
  name: id,
  description: '',
  fromMd: true,
  movedInAt: 0,
  job: 'other',
  species: 'bear',
  variant: 0,
  accessory: null,
  isLeader: id === LEADER_ID,
  departed: false,
  status: 'resting',
  blocked: null,
  currentRunId: null,
  currentTaskId: null,
  cheerUntil: null,
  balance: 0,
  furniture: [],
  hardship: false,
  boughtToday: 0,
  tokens: 0,
  tokenCostToday: 0,
  materialsToday: 0,
  eff: { recent: [] },
  receipt: { parts: {}, runs: 0, calls: 0, models: {} },
  personality: seedPersonality('ISTJ'),
});
function village(...ids: string[]) {
  const s = initialState('p');
  for (const id of [LEADER_ID, ...ids]) s.members[id] = mem(id);
  return s;
}
function play(s: VillageState, c: typeof cfg, ...events: DomainEvent[]) {
  for (const e of events) {
    applyRuns(s, e, c);
    applyMeeting(s, e, c);
    deriveStatus(s, e.at, c);
  }
  return s;
}
const prompt = (at: number, preview = ''): DomainEvent => ({ t: 'PromptSubmitted', at, sessionId: 's', preview });
const start = (at: number, runId: string, agentType: string): DomainEvent => ({
  t: 'AgentRunStarted',
  at,
  runId,
  agentType,
});
const stop = (at: number): DomainEvent => ({ t: 'MainTurnEnded', at, sessionId: 's' });
const statuses = (s: VillageState) => Object.fromEntries(Object.values(s.members).map((m) => [m.id, m.status]));

test('프롬프트 회의: 팀장과 쉬는 팀원만, 첫 서브에이전트 시작에 흩어짐', () => {
  const s = village('a', 'b', 'gone');
  (s.members.gone as Member).departed = true;
  play(s, cfg, start(0, 'r1', 'a'), prompt(1000));
  expect(s.meeting).toMatchObject({ kind: 'prompt', until: 1000 + cfg.meetings.maxMs, preview: '…' });
  expect(s.meeting?.participants).toEqual([LEADER_ID, 'b']);
  expect(statuses(s)).toEqual({ [LEADER_ID]: 'meeting', a: 'working', b: 'meeting', gone: 'resting' });
  expect(s.feed.at(-1)).toMatchObject({ kind: 'meeting' });
  expect(s.toasts.at(-1)).toMatchObject({ kind: 'meeting', sticky: true });
  play(s, cfg, start(20000, 'r2', 'b')); // r1과 킥오프 창 밖
  expect(s.meeting).toBeNull();
  expect(statuses(s)).toMatchObject({ [LEADER_ID]: 'resting', b: 'working' });
});

test('프롬프트 회의: 메인 턴 끝, maxMs 지나면 끝. onUserPrompt=false면 안 모임', () => {
  const s = play(village('a'), cfg, prompt(0, '로그인 개선'), stop(10));
  expect(s.meeting).toBeNull();
  play(s, cfg, prompt(100));
  deriveStatus(s, 100 + cfg.meetings.maxMs, cfg); // 이벤트 없이 시각만 지나도 상태는 풀림
  expect(s.members.a?.status).toBe('resting');
  play(s, cfg, { t: 'GameDayTick', at: 100 + cfg.meetings.maxMs, day: 1 });
  expect(s.meeting).toBeNull();
  const off = { ...cfg, meetings: { ...cfg.meetings, onUserPrompt: false } };
  expect(play(village('a'), off, prompt(0)).meeting).toBeNull();
});

test('킥오프: kickoffWindowMs 안에 팀원 2명 시작 → kickoffMs 동안 광장, 외부인은 안 셈', () => {
  const w = cfg.meetings.kickoffWindowMs;
  const s = play(village('a', 'b', 'c'), cfg, start(0, 'x', 'Explore'), start(0, 'r1', 'a'));
  expect(s.meeting).toBeNull();
  play(s, cfg, start(w, 'r2', 'b'));
  expect(s.meeting).toMatchObject({ kind: 'kickoff', until: w + cfg.meetings.kickoffMs, participants: ['a', 'b'] });
  expect(statuses(s)).toMatchObject({ a: 'meeting', b: 'meeting', c: 'resting', [LEADER_ID]: 'resting' });
  expect(s.toasts.at(-1)?.text).toBe('광장 회의 시작 · 병렬 작업 킥오프'); // 안건이 없어 까닭 (01 문서 9장, 전엔 "…")
  // 킥오프 중 늦게 온 팀원은 합류, 알림은 한 번
  play(s, cfg, start(w + 1, 'r3', 'c'));
  expect(s.meeting?.participants).toEqual(['a', 'b', 'c']); // a는 창 밖이지만 이미 참가 중
  expect(s.toasts.filter((t) => t.kind === 'meeting')).toHaveLength(1);
  play(s, cfg, { t: 'GameDayTick', at: w + 1 + cfg.meetings.kickoffMs, day: 1 });
  expect(s.meeting).toBeNull();
  expect(statuses(s)).toMatchObject({ a: 'working', b: 'working', c: 'working' });
});

test('킥오프: 창보다 늦게 시작하면 회의 없음', () => {
  const s = play(village('a', 'b'), cfg, start(0, 'r1', 'a'), start(cfg.meetings.kickoffWindowMs + 1, 'r2', 'b'));
  expect(s.meeting).toBeNull();
});

test('킥오프: 이미 끝난 실행은 병렬이 아니다 (4.1)', () => {
  const s = play(village('zeta', 'alpha'), cfg, start(1000, 'r1', 'zeta'), {
    t: 'AgentRunEnded',
    at: 2000,
    runId: 'r1',
    ok: true,
  });
  play(s, cfg, start(5000, 'r2', 'alpha'));
  expect(s.meeting).toBeNull();
  expect(s.toasts).toEqual([]);
});
