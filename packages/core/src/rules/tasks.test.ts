import { seedPersonality } from './personality';
import { expect, test } from 'vitest';
import type { DomainEvent, TaskStatus } from '../events/normalize';
import { defaultConfig, makeConfig } from '../config/config';
import { initialState, replay } from '../projector/project';
import { LEADER_ID, type AgentRun, type Member, type VillageState } from '../projector/types';
import { applyTasks, firstSentence } from './tasks';

const T0 = Date.parse('2026-09-29T13:20:00.000Z');
const at = (sec: number) => T0 + sec * 1000;
const created = (id: string, sec: number, subject = `작업 ${id}`): DomainEvent => ({
  t: 'TaskCreated',
  at: at(sec),
  taskId: id,
  subject,
});
const status = (id: string, st: TaskStatus, sec: number): DomainEvent => ({
  t: 'TaskStatusChanged',
  at: at(sec),
  taskId: id,
  status: st,
});
function play(events: DomainEvent[], s: VillageState = initialState('p')) {
  for (const e of events) applyTasks(s, e);
  return s;
}
const member = (id: string, job: string): Member => ({
  id,
  slot: 1,
  name: id,
  description: '',
  fromMd: true,
  movedInAt: 0,
  job,
  species: 'bear',
  variant: 0,
  accessory: null,
  isLeader: false,
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
const run = (runId: string, who: Pick<AgentRun, 'memberId' | 'visitorKind'>, from: number, to: number | null) =>
  ({
    runId,
    agentType: who.memberId ?? who.visitorKind ?? '',
    ...who,
    startedAt: at(from),
    endedAt: to === null ? null : at(to),
    lastAt: at(from),
    ok: true,
    toolCalls: 0,
    failStreak: 0,
    testsPassed: 0,
    testsFailed: 0,
    openPre: {},
  }) satisfies AgentRun;

test('기여 = 작업 진행 중에 겹친 실행 시간, 품질·도구 수, 현재 작업 (5.3)', () => {
  const s = initialState('p');
  const qa = member('qa-reviewer', 'qa');
  s.members[qa.id] = qa;
  // qa-reviewer 21:02–23:40, Explore는 t1 완료 뒤라 안 겹침
  s.runs.a1 = { ...run('a1', { memberId: 'qa-reviewer', visitorKind: null }, 62, 220), toolCalls: 3, testsPassed: 12 };
  s.runs.a2 = run('a2', { memberId: null, visitorKind: 'Explore' }, 231, 270);
  play(
    ['t1', 't2', 't3', 't4', 't5', 't6'].map((id, i) => created(id, 20 + i)),
    s,
  );
  qa.currentRunId = 'a1';
  play([status('t1', 'in_progress', 60)], s);
  expect(qa.currentTaskId).toBe('t1');
  play([status('t1', 'completed', 221)], s);
  expect(qa.currentTaskId).toBeNull();
  expect(s.tasks.t1).toMatchObject({
    startedAt: at(60),
    completedAt: at(221),
    contributions: { 'qa-reviewer': 158_000 },
    quality: 'testsPassed',
    toolCalls: 3,
  });

  // 겹친 실행이 없으면 팀장이 전부, 실패한 실행이 있으면 failed
  play([status('t2', 'in_progress', 300), status('t2', 'completed', 310)], s);
  expect(s.tasks.t2?.contributions).toEqual({ [LEADER_ID]: 10_000 });
  s.runs.a3 = { ...run('a3', { memberId: 'qa-reviewer', visitorKind: null }, 320, 330), ok: false };
  play([status('t3', 'in_progress', 315), status('t3', 'completed', 340)], s);
  expect(s.tasks.t3).toMatchObject({ contributions: { 'qa-reviewer': 10_000 }, quality: 'failed' });
});

test('품질: 실패한 테스트 뒤 통과하면 testsPassed. in_progress 없이 완료하면 팀장이 전부 (6.1, 5.3)', () => {
  const s = initialState('p');
  s.members.qa = member('qa', 'qa');
  s.runs.r1 = { ...run('r1', { memberId: 'qa', visitorKind: null }, 2, 8), testsFailed: 1, testsPassed: 1 };
  s.runs.r2 = run('r2', { memberId: 'qa', visitorKind: null }, 12, 18);
  play([created('a', 0), created('b', 0), status('a', 'in_progress', 1), status('a', 'completed', 9)], s);
  expect(s.tasks.a?.quality).toBe('testsPassed');
  play([status('b', 'completed', 20)], s);
  expect(s.tasks.b?.contributions).toEqual({ [LEADER_ID]: 20_000 });
});

test('지운 작업은 끝: 늦은 갱신이 되살리지 않는다 (5.4 M7), 작업은 건물을 만들지 않는다 (06 문서 5.8)', () => {
  const s = play([created('a', 0), created('b', 1), status('a', 'deleted', 50), status('b', 'deleted', 51)]);
  play([status('a', 'in_progress', 60), status('a', 'completed', 61), status('b', 'pending', 62)], s);
  expect([s.tasks.a?.status, s.tasks.b?.status]).toEqual(['deleted', 'deleted']);
  expect(s.buildings).toEqual({});
});

test('한 줄 요약: 머리 기호·빈 줄을 건너뛴 첫 줄의 첫 문장, 80자 (06 문서 9장)', () => {
  expect(firstSentence('\n\n## 요약\n본문')).toBe('요약');
  expect(firstSentence('---\n\n- **입력 검증을 추가했다.** 테스트도 통과!')).toBe('입력 검증을 추가했다.');
  expect(firstSentence('```ts\nconst x = 1;\n```\n로그인 버그를 고쳤다. 테스트 통과')).toBe('로그인 버그를 고쳤다.'); // 코드 블록은 건너뜀
  expect(firstSentence('1. `index.ts` v1.2를 고쳤어요! 다음')).toBe('index.ts v1.2를 고쳤어요!');
  expect(firstSentence('끝났다。다음')).toBe('끝났다。');
  expect(firstSentence('마침표 없는 줄\n둘째 줄.')).toBe('마침표 없는 줄');
  expect(firstSentence('가'.repeat(100))).toBe('가'.repeat(80));
  expect(firstSentence('```\n')).toBe('');
});

const ev = (e: Record<string, unknown> & { t: DomainEvent['t'] }, sec: number) =>
  ({ ...e, at: at(sec) }) as DomainEvent;
const task = (order: 'runFirst' | 'taskFirst', lastMessage?: string, cfg = defaultConfig) => {
  const start = [
    ev({ t: 'AgentRunStarted', runId: 'a1', agentType: 'Explore' }, 1),
    ev({ t: 'TaskCreated', taskId: 't1', subject: '검색' }, 0),
    ev({ t: 'TaskStatusChanged', taskId: 't1', status: 'in_progress' }, 1),
  ];
  const end = ev({ t: 'AgentRunEnded', runId: 'a1', ok: true, ...(lastMessage ? { lastMessage } : {}) }, 5);
  const done = ev({ t: 'TaskStatusChanged', taskId: 't1', status: 'completed' }, order === 'runFirst' ? 6 : 4);
  return replay('p', [...start, ...(order === 'runFirst' ? [end, done] : [done, end])], cfg).tasks.t1;
};

test('요약 = 끝낸 실행의 보고: 실행 끝이 먼저든 작업 완료가 먼저든 같다, 보고가 없거나 저장을 끄면 없음', () => {
  expect(task('runFirst', '찾았다. 세 곳이다.')?.summary).toBe('찾았다.');
  expect(task('taskFirst', '찾았다. 세 곳이다.')).toMatchObject({ status: 'completed', summary: '찾았다.' });
  expect(task('runFirst')?.summary).toBeUndefined();
  const off = makeConfig({ overrides: { collector: { keepLastMessage: false } } });
  expect(task('runFirst', '찾았다.', off)?.summary).toBeUndefined();
  expect(task('taskFirst', '찾았다.', off)?.summary).toBeUndefined();
});

test('요약: Agent 호출 작업은 짝지어진 실행, 아니면 겹친 실행 중 가장 늦게 끝난 것', () => {
  const s = replay(
    'p',
    [
      ev({ t: 'AgentCalled', callId: 'c1', subagentType: 'Explore', subject: '찾기' }, 0),
      ev({ t: 'AgentRunStarted', runId: 'a1', agentType: 'Explore' }, 1),
      ev({ t: 'AgentRunStarted', runId: 'a2', agentType: 'Plan' }, 2),
      ev({ t: 'AgentRunEnded', runId: 'a2', ok: true, lastMessage: '늦게 끝남.' }, 9),
      ev({ t: 'AgentRunEnded', runId: 'a1', ok: true, lastMessage: '짝 실행.' }, 5),
    ],
    defaultConfig,
  );
  expect(s.tasks['agent:c1']?.summary).toBe('짝 실행.');
  const t = initialState('p');
  t.runs.r1 = { ...run('r1', { memberId: null, visitorKind: 'Explore' }, 1, 8), lastMessage: '나중.' };
  t.runs.r2 = { ...run('r2', { memberId: null, visitorKind: 'Explore' }, 1, 4), lastMessage: '먼저.' };
  play([created('x', 0), status('x', 'in_progress', 1), status('x', 'completed', 9)], t);
  expect(t.tasks.x?.summary).toBe('나중.');
});
