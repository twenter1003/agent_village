// 마을이 자라는 순서 (01 문서 3.3, D8·D9): 빈 섬 → 첫 일에 광장·팀장 집 → 팀원은 처음 일할 때 입주 → 시설은 외부인이 처음 올 때
import { describe, expect, test } from 'vitest';
import { defaultConfig as cfg } from '../config/config';
import { normalize, type DomainEvent } from '../events/normalize';
import { initialState, project } from '../projector/project';
import { LEADER_ID, type VillageState } from '../projector/types';
import { lotTiles } from '../layout/lots';
import { occupiedLots } from './growth';

const at = (sec: number) => 1_000_000 + sec * 1000;
const roster = (names: string[], sec = 0, tycoon: Record<string, unknown> | null = null) =>
  ({ t: 'RosterLoaded', at: at(sec), agents: names.map((name) => ({ name, description: '' })), tycoon }) as DomainEvent;
const start = (sec: number, runId: string, agentType: string): DomainEvent => ({
  t: 'AgentRunStarted',
  at: at(sec),
  runId,
  agentType,
});
const end = (sec: number, runId: string): DomainEvent => ({ t: 'AgentRunEnded', at: at(sec), runId, ok: true });
const play = (events: DomainEvent[], s: VillageState = initialState('p', cfg)) =>
  events.reduce((x, e) => project(x, e, cfg), s);

test('빈 모래섬에서 시작: 시설·집·광장 없음, md 팀원은 목록에만 (입주 전, 잔고 0)', () => {
  const s0 = initialState('p', cfg);
  expect([s0.facilities, s0.houses, s0.foundedAt]).toEqual([{}, {}, null]);
  const s = play([
    roster(['backend-dev', 'qa-reviewer']),
    { t: 'SessionStarted', at: at(1), project: 'p', sessionId: 's' },
  ]);
  expect(s.foundedAt).toBeNull(); // 세션만 열린 마을은 아직 빈 섬
  expect(Object.values(s.members).map((m) => [m.id, m.movedInAt, m.balance])).toEqual([
    [LEADER_ID, null, 0],
    ['backend-dev', null, 0],
    ['qa-reviewer', null, 0],
  ]);
  expect([s.houses, s.facilities]).toEqual([{}, {}]);
});

test('첫 일(프롬프트)에 마을을 세운다: 광장 + 팀장 입주(집, 입주 지원금 없음 D20), 한 번만', () => {
  const s = play([
    roster(['backend-dev']),
    { t: 'PromptSubmitted', at: at(5), sessionId: 's', preview: 'go' },
    { t: 'PromptSubmitted', at: at(9), sessionId: 's', preview: 'again' },
  ]);
  expect(s.foundedAt).toBe(at(5));
  expect(s.members[LEADER_ID]).toMatchObject({ movedInAt: at(5), balance: 0 });
  expect(Object.keys(s.houses)).toEqual([LEADER_ID]);
  expect(s.members['backend-dev']?.movedInAt).toBeNull();
  expect(s.feed.filter((f) => f.kind === 'task').map((f) => f.text)).toEqual([
    '마을을 세웠어요 · 광장과 시청이 생겼어요',
    '팀장 입주 · 집을 지었어요',
  ]);
  // 회의에는 입주한 팀원만 (입주 전 backend-dev는 마을에 없다)
  expect(s.meeting?.participants).toEqual([LEADER_ID]);
});

test('md 팀원은 처음 일할 때 입주, 작업 생성·서브에이전트 시작도 마을을 세운다', () => {
  const s = play([roster(['backend-dev', 'qa-reviewer']), start(3, 'a1', 'backend-dev'), end(9, 'a1')]);
  expect(s.foundedAt).toBe(at(3));
  expect(s.members['backend-dev']).toMatchObject({ movedInAt: at(3), balance: 0 });
  expect(s.runs.a1?.memberId).toBe('backend-dev');
  expect(Object.keys(s.houses).sort()).toEqual([LEADER_ID, 'backend-dev'].sort());
  expect(s.members['qa-reviewer']?.movedInAt).toBeNull();
  // 두 번째 실행은 다시 입주하지 않는다 (입주 시각 그대로)
  expect(play([start(20, 'a2', 'backend-dev')], s).members['backend-dev']?.movedInAt).toBe(at(3));
  expect(play([roster([]), { t: 'TaskCreated', at: at(1), taskId: 't1', subject: 'x' }]).foundedAt).toBe(at(1));
});

test('md에 없는 에이전트(플러그인·사용자 공통)도 처음 일하면 팀원 — 다음 슬롯, 이름으로 직업, tycoon 설정도 이름으로 (D9)', () => {
  const s = play([
    roster(['backend-dev'], 0, { members: { 'superpowers:code-reviewer': { species: 'otter' } } }),
    start(3, 'p1', 'superpowers:code-reviewer'),
  ]);
  const m = s.members['superpowers:code-reviewer'];
  expect(m).toMatchObject({ slot: 3, fromMd: false, movedInAt: at(3), job: 'qa', species: 'rabbit', departed: false });
  expect(s.runs.p1).toMatchObject({ memberId: 'superpowers:code-reviewer', visitorKind: null });
  expect(s.visitors).toEqual({});
  expect(s.houses['superpowers:code-reviewer']).toBeDefined();
  // 다음 roster(SessionStart)에도 md가 없다고 떠나지 않는다
  expect(play([roster(['backend-dev'], 30)], s).members['superpowers:code-reviewer']?.departed).toBe(false);
});

test('시설은 그 외부인이 처음 올 때 북쪽에 — 같은 종류가 또 와도 하나, 모르는 이름 없는 실행은 인력사무소', () => {
  const s = play([roster([]), start(1, 'x1', 'Explore'), end(2, 'x1'), start(3, 'x2', 'Explore')]);
  expect(Object.keys(s.facilities)).toEqual(['library']);
  const lib = s.facilities.library;
  expect(lib && lib.x + 1 < 6 && lib.y + 1 < 6).toBe(true);
  const t = play([start(4, 'g1', 'general-purpose'), start(5, 'n1', '')], s);
  expect(Object.keys(t.facilities).sort()).toEqual(['agency', 'library']);
  expect(t.visitors.n1).toMatchObject({ kind: 'general-purpose', facility: 'agency' });
});

test('첫 일에 시청 (06 문서 6.3): 광장 북쪽 가까이 3×3, 한 번만. 시설은 그 옆 북쪽 빈자리, 팀장 집은 그대로 (4장)', () => {
  const s = play([roster([]), start(1, 'x1', 'Explore')]);
  expect(s.hall).toEqual({ x: 3, y: 3, size: 3 });
  expect(Object.keys(s.houses)).toEqual([LEADER_ID]);
  expect(occupiedLots(s)).toContainEqual({ x: 3, y: 3, size: 3 });
  const lib = s.facilities.library;
  expect(lib && lotTiles(lib).every(([x, y]) => x < 2 || y < 2)).toBe(true); // 시청(3~5칸)과 1칸 띄움
  expect(play([start(2, 'x2', 'Plan')], s).hall).toEqual(s.hall);
  expect(play([roster([])]).hall).toBeNull(); // 빈 섬엔 없다
});

test('떠난 팀원이 다시 일하면 돌아온다 — md 없이 일하는 팀원이 돼 다음 roster에도 그대로', () => {
  const s = play([roster(['backend-dev']), start(1, 'a1', 'backend-dev'), end(2, 'a1'), roster([], 3)]);
  expect(s.members['backend-dev']?.departed).toBe(true);
  const back = play([start(4, 'a2', 'backend-dev'), roster([], 5)], s);
  expect(back.members['backend-dev']).toMatchObject({ departed: false, fromMd: false });
  expect(back.houses['backend-dev']).toEqual(s.houses['backend-dev']); // 집은 그대로
});

describe('실사용에서 찾은 것 (2026-09-30, 이 프로젝트에 훅을 달아 봄)', () => {
  const hook = (sec: number, e: Record<string, unknown>) => normalize({ _t: new Date(at(sec)).toISOString(), ...e });
  const agentPre = (sec: number, id: string, type: string, description = '') =>
    hook(sec, {
      hook_event_name: 'PreToolUse',
      tool_name: 'Agent',
      tool_use_id: id,
      subagentType: type,
      ...(description ? { subject: description } : {}),
    });
  const events = (...xs: DomainEvent[][]) => xs.flat();
  /** 서브에이전트 도구 한 번 (급여 = 실행의 도구 호출 수 × wagePerCall, D20) */
  const used = (sec: number, runId: string): DomainEvent => ({
    t: 'ToolUsed',
    at: at(sec),
    runId,
    tool: 'Read',
    phase: 'post',
    ok: true,
    kind: 'read',
    isTest: false,
  });

  test('Task 도구가 없는 마을: 메인 세션 Agent 호출 = 작업, 같은 종류의 다음 실행과 짝지어 끝나면 완료 (01 문서 5.1-5)', () => {
    const s = play(
      events(
        [roster(['backend-dev'])],
        agentPre(1, 'tu1', 'backend-dev', '결제 API 만들기'),
        agentPre(2, 'tu2', 'Explore', '결제 코드 찾기'),
        [start(3, 'r-exp', 'Explore'), start(4, 'r-be', 'backend-dev'), used(6, 'r-be')],
        hook(5, { hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_use_id: 'tu2', subagentType: 'Explore' }), // 백그라운드: 호출은 먼저 끝남
        [end(8, 'r-exp'), end(20, 'r-be')],
      ),
    );
    expect(s.tasks['agent:tu1']).toMatchObject({ subject: '결제 API 만들기', status: 'completed' });
    expect(s.tasks['agent:tu2']).toMatchObject({ subject: '결제 코드 찾기', status: 'completed' });
    expect([s.runs['r-be']?.taskId, s.runs['r-exp']?.taskId]).toEqual(['agent:tu1', 'agent:tu2']);
    expect(Object.keys(s.buildings)).toEqual(['w1:backend-dev']); // 작업이 아니라 일한 팀원마다 일터 (06 문서 5장)
    expect(s.tasks['agent:tu1']?.contributions['backend-dev']).toBeGreaterThan(0);
    expect(s.tasks['agent:tu1']?.salaryPaid).toBeGreaterThan(0); // 급여도 (실행마다, 짝지어진 작업에 적어 둠)
    expect(s.agentCalls).toEqual([]);
  });

  test('실패한 호출은 작업을 지우고, 제목이 없으면 "종류 작업", 서브에이전트 안의 Agent 호출은 작업이 아님', () => {
    const s = play(
      events(
        [roster([])],
        agentPre(1, 'tu1', 'Plan'),
        hook(2, {
          hook_event_name: 'PostToolUseFailure',
          tool_name: 'Agent',
          tool_use_id: 'tu1',
          subagentType: 'Plan',
        }),
        agentPre(3, 'tu2', 'Plan'),
        hook(4, {
          hook_event_name: 'PreToolUse',
          tool_name: 'Agent',
          tool_use_id: 'tu3',
          agent_id: 'r9',
          subagentType: 'Plan',
        }),
      ),
    );
    expect(s.tasks['agent:tu1']?.status).toBe('deleted');
    expect(s.tasks['agent:tu2']).toMatchObject({ subject: 'Plan 작업', status: 'in_progress' });
    expect(s.tasks['agent:tu3']).toBeUndefined();
  });

  test('SubagentStop을 잃고 세션이 닫히면 그 작업도 완료(급여), 짝 못 지은 호출은 지움, 이름 없는 실행도 짝짓는다 (실사용 리뷰)', () => {
    const s = play(
      events(
        [roster(['backend-dev'])],
        agentPre(1, 'tu1', 'backend-dev', '결제 API'),
        [start(2, 'r1', 'backend-dev'), used(3, 'r1')],
        agentPre(3, 'tu2', 'Plan', '짝 없음'),
        agentPre(4, 'tu3', 'general-purpose', '이름 없는 실행'),
        [start(5, 'r3', '')],
        [{ t: 'SessionEnded', at: at(60), sessionId: 's' } as DomainEvent],
      ),
    );
    expect(s.tasks['agent:tu1']).toMatchObject({ status: 'completed', completedAt: at(60) });
    expect(s.tasks['agent:tu1']?.salaryPaid).toBeGreaterThan(0);
    expect(s.tasks['agent:tu2']?.status).toBe('deleted');
    expect(s.runs.r3?.taskId).toBe('agent:tu3');
    expect(s.tasks['agent:tu3']?.status).toBe('completed');
    expect(s.agentCalls).toEqual([]);
  });

  test('TaskCreate를 한 번이라도 보면 Agent 호출은 더는 작업이 아니다 (이미 만든 건 그대로)', () => {
    const s = play(
      events(
        [roster([])],
        agentPre(1, 'tu1', 'Explore', '먼저'),
        [{ t: 'TaskCreated', at: at(2), taskId: 't1', subject: '진짜 작업' } as DomainEvent],
        agentPre(3, 'tu2', 'Explore', '나중'),
      ),
    );
    expect(Object.keys(s.tasks).sort()).toEqual(['agent:tu1', 't1']);
    expect(s.taskTool).toBe(true);
  });

  test('팀장(메인 세션)은 메인 턴 동안 작업 중, 턴이 끝나거나 10분 넘게 조용하면 휴식 (01 문서 4장)', () => {
    const tool = (sec: number) => hook(sec, { hook_event_name: 'PostToolUse', tool_name: 'Bash' });
    const working = play(events([roster([])], tool(1), tool(30)));
    expect(working.members[LEADER_ID]?.status).toBe('working');
    const done = play(events(hook(40, { hook_event_name: 'Stop' })), working);
    expect(done.members[LEADER_ID]?.status).toBe('resting');
    // Stop을 잃은 턴: 마지막 훅 뒤 10분이 지나고 오는 이벤트(시계 줄)에서 휴식
    const stale = play([{ t: 'Tick', at: at(30 + 601) }], working);
    expect(stale.members[LEADER_ID]?.status).toBe('resting');
  });

  test('앱이 넣은 메시지(<agent-message …>, <task-notification>)는 회의를 열지 않는다, 메인 턴은 연다 (01 문서 4.1)', () => {
    for (const prompt of ['<agent-message from="a1">보고', '<task-notification>\n<task-id>x']) {
      const s = play(
        events([roster([])], hook(1, { hook_event_name: 'UserPromptSubmit', preview: prompt.slice(0, 20) })),
      );
      expect([s.meeting, s.clock.mainTurn, s.foundedAt]).toEqual([null, true, at(1)]);
    }
    const human = play(
      events([roster([])], hook(1, { hook_event_name: 'UserPromptSubmit', preview: '<b>굵게</b> 해줘' })),
    );
    expect(human.meeting).toBeNull(); // 태그로 시작하면 사람 글이어도 회의 없음 (드묾, 받아들임)
    expect(
      play(events([roster([])], hook(1, { hook_event_name: 'UserPromptSubmit', preview: '로그인 고쳐줘' }))).meeting
        ?.preview,
    ).toBe('로그인 고쳐줘');
  });
});
