import { expect, test } from 'vitest';
import { normalize } from './normalize';
import { isTestCommand, summarize } from './summarize';

const _t = '2026-09-29T13:20:00.000Z';
const post = (hook: string, tool: string, input: object, extra: object = {}) =>
  normalize(summarize({ _t, hook_event_name: hook, session_id: 's', tool_name: tool, tool_input: input, ...extra }));

test('실패한 TaskCreate·TaskUpdate는 작업을 만들거나 바꾸지 않는다 (5.1-1)', () => {
  expect(post('PostToolUseFailure', 'TaskCreate', { subject: 'x' })).toEqual([]);
  expect(post('PostToolUseFailure', 'TaskUpdate', { taskId: 't1', status: 'completed' })).toEqual([]);
  expect(post('PostToolUse', 'TaskCreate', { subject: 'x' }, { tool_response: { taskId: 't1' } })).toEqual([
    { t: 'TaskCreated', at: Date.parse(_t), taskId: 't1', subject: 'x' },
  ]);
});

test('프로토타입 키가 id로 오면 줄째 버린다', () => {
  for (const id of ['__proto__', 'constructor', 'toString']) {
    expect(normalize({ _t, hook_event_name: 'SubagentStop', agent_id: id, lastMessage: 'x' })).toEqual([]);
    expect(post('PostToolUse', 'TaskUpdate', { taskId: id, status: 'completed' })).toEqual([]);
    expect(post('PostToolUse', id, {})).toEqual([]);
  }
});

test('압축(compact)은 세션 경계가 아니다', () => {
  expect(normalize({ _t, hook_event_name: 'SessionStart', session_id: 's', source: 'compact' })).toEqual([]);
  expect(normalize({ _t, hook_event_name: 'SessionStart', session_id: 's', source: 'clear' })).toHaveLength(1);
});

test('테스트 명령은 명령 자리(맨 앞 또는 실행기 뒤)에서만 (01 문서 6.1)', () => {
  const yes = ['pnpm test src/login', 'npx vitest run', 'python -m pytest -q', 'go test ./...', 'npm run test'];
  const more = ['cd pkg && pnpm -r test', 'CI=1 jest', 'cargo test', 'pytest | tee log', 'yarn test'];
  const no = ['rm -rf test', 'cd test && ls', 'echo test', 'mkdir test', 'test -f x', 'git commit -m "add test"'];
  expect([...yes, ...more].filter((c) => !isTestCommand(c))).toEqual([]);
  expect(no.filter((c) => isTestCommand(c))).toEqual([]);
});

test("수집기 'ui' 줄: purchase·move → 가구 이벤트 (가구 종류는 furniture 필드), 프로토타입 키는 버림", () => {
  const at = Date.parse(_t);
  const ui = (extra: object) => normalize({ _t, hook_event_name: 'ui', ...extra });
  expect(ui({ kind: 'purchase', memberId: 'm', furniture: 'bed', fabric: 'blue' })).toEqual([
    { t: 'FurniturePurchased', at, memberId: 'm', kind: 'bed', fabric: 'blue' },
  ]);
  expect(ui({ kind: 'purchase', memberId: 'm', furniture: 'desk', fabric: 5 })).toEqual([
    { t: 'FurniturePurchased', at, memberId: 'm', kind: 'desk', fabric: null },
  ]);
  expect(ui({ kind: 'move', memberId: 'm', furnitureId: 'f1', placed: { x: 1, y: 2, rot: 1 } })).toEqual([
    { t: 'FurnitureMoved', at, memberId: 'm', furnitureId: 'f1', placed: { x: 1, y: 2, rot: 1 } },
  ]);
  expect(ui({ kind: 'move', memberId: 'm', furnitureId: 'f1', placed: null })).toEqual([
    { t: 'FurnitureMoved', at, memberId: 'm', furnitureId: 'f1', placed: null },
  ]);
  expect(ui({ kind: 'move', memberId: 'm' })).toEqual([]);
  expect(ui({ kind: 'nope', memberId: 'm' })).toEqual([]);
  for (const id of ['__proto__', 'constructor']) {
    expect(ui({ kind: 'purchase', memberId: id, furniture: 'bed', fabric: null })).toEqual([]);
    expect(ui({ kind: 'purchase', memberId: 'm', furniture: id, fabric: null })).toEqual([]);
    expect(ui({ kind: 'move', memberId: 'm', furnitureId: id, placed: null })).toEqual([]);
  }
});

test('SessionEnd → SessionEnded (열린 실행을 닫는다, 01 문서 4장)', () => {
  expect(
    normalize(summarize({ _t, hook_event_name: 'SessionEnd', session_id: 's', cwd: '/w', reason: 'clear' })),
  ).toEqual([{ t: 'SessionEnded', at: Date.parse(_t), sessionId: 's' }]);
});

test('프롬프트 앞 앱 태그 블록은 떼고 안건, 태그만이면 앱 메시지, 옛 기록은 잘린 태그도 (01 문서 4.1)', () => {
  const opts = {};
  const prompt = (p: string) => {
    const sum = summarize({ hook_event_name: 'UserPromptSubmit', session_id: 's', cwd: '/p', prompt: p }, opts);
    return normalize({ ...sum, _t: '2026-09-30T00:00:00.000Z' })[0];
  };
  expect(
    prompt('<artifact-view-context artifact="x">\n{"a":1}\n</artifact-view-context>\n\n우리 프로젝트 마을 보여줘'),
  ).toMatchObject({ t: 'PromptSubmitted', preview: '우리 프로젝트 마을 보여줘', injected: false });
  expect(prompt('<agent-message from="qa">다 했어요</agent-message>')).toMatchObject({ injected: true });
  expect(prompt('<task-notification>\n끝</task-notification>')).toMatchObject({ injected: true });
  expect(prompt('그냥 질문')).toMatchObject({ preview: '그냥 질문', injected: false });
  // 옛 기록: 미리보기 20자가 태그 중간에서 잘림
  expect(
    normalize({
      hook_event_name: 'UserPromptSubmit',
      session_id: 's',
      preview: '<artifact-view-conte',
      _t: '2026-09-30T00:00:00.000Z',
    })[0],
  ).toMatchObject({ injected: true });
});

test('서브에이전트 도구 호출은 agent_type을 싣는다 (시작을 못 본 실행의 팀원, 02 문서 5.2)', () => {
  const [e] = post('PreToolUse', 'Read', {}, { agent_id: 'a1', agent_type: 'backend-dev' });
  expect(e).toMatchObject({ t: 'ToolUsed', runId: 'a1', agentType: 'backend-dev' });
  expect(post('PreToolUse', 'Read', {})[0]).not.toHaveProperty('agentType');
});
