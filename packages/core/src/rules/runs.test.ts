import { seedPersonality } from './personality';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { makeConfig } from '../config/config';
import { normalize, type DomainEvent } from '../events/normalize';
import { summarize, type Raw } from '../events/summarize';
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
/** project()와 같은 순서로 내 규칙만 돌린다 */
function play(s: VillageState, ...events: DomainEvent[]) {
  for (const e of events) {
    applyRuns(s, e, cfg);
    applyMeeting(s, e, cfg);
    deriveStatus(s, e.at, cfg);
  }
  return s;
}
const start = (at: number, runId: string, agentType: string): DomainEvent => ({
  t: 'AgentRunStarted',
  at,
  runId,
  agentType,
});
const end = (at: number, runId: string): DomainEvent => ({ t: 'AgentRunEnded', at, runId, ok: true });
const tool = (at: number, runId: string | null, phase: 'pre' | 'post', ok = true, isTest = false): DomainEvent => ({
  t: 'ToolUsed',
  at,
  runId,
  tool: 'Bash',
  phase,
  ok,
  kind: 'shell',
  isTest,
});
const perm = (at: number, runId: string | null = null): DomainEvent => ({ t: 'PermissionPrompt', at, runId });

test('합성 픽스처: 너구리(qa) 작업 → 휴식, 곰(backend) 권한 막힘, Explore 외부인 등장·퇴장', () => {
  const lines = readFileSync(new URL('../../../../fixtures/sample-session.jsonl', import.meta.url), 'utf8')
    .split('\n')
    .filter(Boolean);
  const s = village('backend-dev', 'frontend-dev', 'qa-reviewer');
  let sawVisitor = false;
  for (const l of lines)
    for (const e of normalize(summarize(JSON.parse(l) as Raw))) {
      play(s, e);
      sawVisitor ||= s.visitors.a2?.facility === 'library';
    }
  expect(sawVisitor).toBe(true);
  expect(s.visitors).toEqual({});
  expect(s.runs.a1).toMatchObject({ memberId: 'qa-reviewer', toolCalls: 3, testsPassed: 1, ok: true });
  expect(s.runs.a2).toMatchObject({ visitorKind: 'Explore', memberId: null });
  // 권한 요청은 agent_id가 없지만 열린 실행 a3에 붙는다
  expect(s.runs.a3).toMatchObject({ toolCalls: 1, failStreak: 1, testsFailed: 1, endedAt: null });
  expect(s.members['backend-dev']).toMatchObject({ status: 'blocked', blocked: 'permission', currentRunId: 'a3' });
  expect(s.members['qa-reviewer']?.status).toBe('resting');
  expect(s.members[LEADER_ID]?.status).toBe('resting');
  expect(s.meeting).toBeNull();
  expect(s.toasts.map((t) => [t.kind, t.sticky])).toEqual([
    ['meeting', true],
    ['failure', true],
  ]);
});

test('권한 요청: runId 없으면 가장 최근에 시작한 열린 실행, 같은 시각이면 큰 runId, 없으면 팀장', () => {
  const s = play(village('a', 'b', 'c'), start(0, 'r1', 'a'), start(1000, 'r2', 'b'), start(1000, 'r3', 'c'));
  play(s, end(2000, 'r3'), perm(3000));
  expect(s.members.b?.blocked).toBe('permission'); // r3은 끝났으니 r2
  play(s, start(4000, 'r4', 'c'), start(4000, 'r5', 'Explore'), perm(5000));
  expect(s.members.c?.blocked).toBeNull(); // r5(외부인)가 더 큰 runId → 팀원 변화 없음
  play(s, end(6000, 'r1'), end(6000, 'r2'), end(6000, 'r4'), end(6000, 'r5'), perm(7000));
  expect(s.members[LEADER_ID]?.blocked).toBe('permission');
  // 메인 세션 도구 성공이 팀장 막힘을 푼다
  play(s, tool(8000, null, 'post'));
  expect(s.members[LEADER_ID]?.status).toBe('resting');
});

test('막힘 진입 때만 실패 토스트, 실행 종료로 풀림', () => {
  const s = play(village('a'), start(0, 'r1', 'a'), perm(1000, 'r1'), perm(2000, 'r1'));
  expect(s.toasts.filter((t) => t.kind === 'failure')).toHaveLength(1);
  expect(s.feed.filter((f) => f.kind === 'task')).toHaveLength(1);
  play(s, end(3000, 'r1'));
  expect(s.members.a).toMatchObject({ blocked: null, currentRunId: null, status: 'resting' });
});

test('도구 3번 연속 실패 → 막힘, 다음 성공 → 풀림', () => {
  const s = play(village('a'), start(0, 'r1', 'a'), tool(1, 'r1', 'post', false), tool(2, 'r1', 'post', false));
  play(s, tool(3, 'r1', 'post'), tool(4, 'r1', 'post', false), tool(5, 'r1', 'post', false));
  expect(s.members.a?.status).toBe('working'); // 중간 성공이 연속을 끊음
  play(s, tool(6, 'r1', 'post', false, true));
  expect(s.members.a).toMatchObject({ status: 'blocked', blocked: 'failures' });
  expect(s.runs.r1?.testsFailed).toBe(1);
  play(s, tool(7, 'r1', 'pre'));
  expect(s.members.a?.blocked).toBe('failures'); // Pre는 성공이 아니다
  play(s, tool(8, 'r1', 'post', true, true));
  expect(s.members.a).toMatchObject({ status: 'working', blocked: null });
  expect(s.runs.r1).toMatchObject({ failStreak: 0, testsPassed: 1 });
});

test('Pre+Post는 한 번, Post만 와도 한 번', () => {
  const s = play(village('a'), start(0, 'r1', 'a'), tool(1, 'r1', 'pre'), tool(2, 'r1', 'post'));
  expect(s.runs.r1?.toolCalls).toBe(1);
  play(s, tool(3, 'r1', 'post'));
  expect(s.runs.r1?.toolCalls).toBe(2);
  play(s, tool(4, 'r1', 'pre'), tool(5, 'r1', 'pre'), tool(6, 'r1', 'post'), tool(7, 'r1', 'post'));
  expect(s.runs.r1).toMatchObject({ toolCalls: 4, openPre: { Bash: 0 } });
});

test('외부인: 기본 에이전트는 시설, 모르는 종류는 인력사무소, 종료하면 사라지고 실행 기록은 남음', () => {
  const s = play(village('a'), start(0, 'x', 'Explore'), start(0, 'p', 'Plan'), start(0, 'u', 'mystery'));
  expect(Object.values(s.visitors).map((v) => [v.runId, v.kind, v.facility])).toEqual([
    ['x', 'Explore', 'library'],
    ['p', 'Plan', 'plan'],
    ['u', 'general-purpose', 'agency'],
  ]);
  play(s, start(1, 'm', 'a'));
  expect(s.visitors.m).toBeUndefined();
  play(s, end(2, 'x'), end(2, 'p'), end(2, 'u'));
  expect(s.visitors).toEqual({});
  expect(s.runs.u).toMatchObject({ visitorKind: 'general-purpose', endedAt: 2 });
});

test('모르는 runId 이벤트는 무시', () => {
  const s = village('a');
  const before = structuredClone(s);
  play(s, end(1, 'nope'), tool(2, 'nope', 'post', false), perm(3, 'nope'));
  expect(s).toEqual(before);
});

test('같은 팀원 병렬 실행: 나중 것이 먼저 끝나도 앞 실행이 돌면 계속 작업 중 (4장)', () => {
  const s = play(village('a'), start(1000, 'r1', 'a'), start(1500, 'r2', 'a'), end(30000, 'r2'));
  expect(s.members.a).toMatchObject({ status: 'working', currentRunId: 'r1' });
  play(s, end(31000, 'r1'));
  expect(s.members.a).toMatchObject({ status: 'resting', currentRunId: null });
});

test('같은 시작이 두 번 와도 실행을 새로 만들지 않는다 (중복 전달)', () => {
  const s = play(village('a'), start(0, 'r1', 'a'), tool(1, 'r1', 'pre'), start(0, 'r1', 'a'));
  expect(s.runs.r1?.toolCalls).toBe(1);
});

test('새 세션: SubagentStop이 없던 실행은 끝낸다, 권한 요청은 팀장에게', () => {
  const s = play(village('a'), start(0, 'r1', 'a'), start(0, 'x', 'Explore'), perm(10));
  play(s, { t: 'SessionStarted', at: 5000, project: 'p', sessionId: 's2' }, perm(6000));
  expect(s.runs.r1).toMatchObject({ endedAt: 5000, ok: null });
  expect(s.visitors).toEqual({});
  expect(s.members.a).toMatchObject({ status: 'resting', blocked: null, currentRunId: null });
  expect(s.members[LEADER_ID]?.blocked).toBe('permission');
});

test('세션 끝(SessionEnd): 열린 실행을 ok null로 닫고 작업 중·막힘이 풀린다 (4장 M7)', () => {
  const s = play(village('a', 'b'), start(0, 'r1', 'a'), start(0, 'r2', 'b'), start(0, 'x', 'Explore'), perm(10, 'r1'));
  expect(s.members.a?.status).toBe('blocked');
  play(s, { t: 'SessionEnded', at: 20000, sessionId: 's' }); // 킥오프 회의(8초) 뒤
  expect(s.runs.r1).toMatchObject({ endedAt: 20000, ok: null });
  expect(s.runs.r2).toMatchObject({ endedAt: 20000, ok: null });
  expect(s.visitors).toEqual({});
  expect(s.members.a).toMatchObject({ status: 'resting', blocked: null, currentRunId: null });
  expect(s.members.b).toMatchObject({ status: 'resting', currentRunId: null });

  const lead = play(village(), perm(1));
  expect(lead.members[LEADER_ID]?.blocked).toBe('permission');
  play(lead, { t: 'SessionEnded', at: 2, sessionId: 's' });
  expect(lead.members[LEADER_ID]).toMatchObject({ blocked: null, status: 'resting' });
});
