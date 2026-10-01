import { seedPersonality } from './personality';
import { expect, test } from 'vitest';
import type { DomainEvent, TaskStatus } from '../events/normalize';
import { initialState } from '../projector/project';
import { LEADER_ID, type AgentRun, type Member, type VillageState } from '../projector/types';
import { applyTasks } from './tasks';

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
