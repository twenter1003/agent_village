// 골든 재생 (02 문서 10장, 04 문서 M4 완료 기준). 합성 픽스처 + 예제 프로젝트 팀원 → 수집기와 같은 길로 재생
// 골든 다시 만들기: pnpm vitest run -u packages/core/src/projector/replay.test.ts (규칙을 바꿨을 때만, diff를 눈으로 확인)
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { makeConfig, type TycoonConfig } from '../config/config';
import { normalize } from '../events/normalize';
import { summarize, type Raw } from '../events/summarize';
import { replay, TOAST_MAX } from './project';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const lines = readFileSync(join(root, 'fixtures/sample-session.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l) as Raw);
const dir = join(root, 'examples/target-project/.claude');
const agents = readdirSync(join(dir, 'agents'))
  .filter((f) => f.endsWith('.md'))
  .sort()
  .map((f) => {
    const md = readFileSync(join(dir, 'agents', f), 'utf8');
    const get = (k: string) => new RegExp(`^${k}:\\s*(.*)$`, 'm').exec(md)?.[1]?.trim() ?? '';
    return { name: get('name'), description: get('description') };
  });
const tycoon = JSON.parse(readFileSync(join(dir, 'tycoon.sea.json'), 'utf8')) as Raw;
// roster는 수집기가 만든 내부 이벤트라 요약하지 않고 그대로 저장된다 (server/store.ts)
const roster: Raw = { _t: lines[0]?._t, hook_event_name: 'roster', agents, tycoon };
const events = [roster, ...lines.map((l) => summarize(l))].flatMap(normalize);
const cfg = makeConfig(tycoon as TycoonConfig);
const run = (n = events.length) => replay('-work-my-shop-app', events.slice(0, n), cfg);

test('sample-session 재생 → M4 완료 기준 + M13 일터', async () => {
  const s = run();
  const workers = new Set(Object.values(s.runs).flatMap((r) => (r.memberId ? [r.memberId] : [])));
  expect(new Set(Object.values(s.buildings).map((b) => b.memberId))).toEqual(workers); // 일터 수 = 일한 팀원 수 (06 문서 16장)
  expect(s.buildings['w1:qa-reviewer']).toMatchObject({ floor: 1, lot: { x: 10, y: 10, size: 3 } }); // 끝낸 실행 → 1층 (남)
  expect(s.buildings['w1:backend-dev']).toMatchObject({ floor: 0, lot: { x: 10, y: 3, size: 3 } }); // 권한 기다리는 첫 실행 → 현장 (동)
  expect(Object.values(s.tasks).filter((t) => t.status === 'completed')).toHaveLength(1);
  expect(s.members['qa-reviewer']).toMatchObject({ species: 'raccoon', status: 'resting' });
  expect(s.members['backend-dev']).toMatchObject({ species: 'bear', status: 'blocked', blocked: 'permission' });
  await expect(JSON.stringify(s, null, 2) + '\n').toMatchFileSnapshot(
    join(root, 'fixtures/sample-session.golden.json'),
  );
});

test('너구리는 작업 중이었다가 쉰다', () => {
  const i = events.findIndex((e) => e.t === 'AgentRunStarted' && e.agentType === 'qa-reviewer');
  expect(run(i + 1).members['qa-reviewer']?.status).toBe('working');
});

test('Explore 외부인: 등장했다가 퇴장', () => {
  const i = events.findIndex((e) => e.t === 'AgentRunStarted' && e.agentType === 'Explore');
  const runId = events[i]?.t === 'AgentRunStarted' ? events[i].runId : '';
  expect(run(i + 1).visitors[runId]).toMatchObject({ kind: 'Explore', facility: 'library' });
  const s = run();
  expect(s.visitors[runId]).toBeUndefined();
  expect(s.runs[runId]?.endedAt).not.toBeNull();
});

test('두 번 재생하면 같은 결과, 입력은 그대로', () => {
  const copy = structuredClone(events);
  expect(run()).toEqual(run());
  expect(events).toEqual(copy);
});

test('토스트는 최근 TOAST_MAX개만 (SSE 스냅샷이 끝없이 커지지 않게)', () => {
  const prompts = Array.from({ length: TOAST_MAX + 5 }, (_, i) => ({
    t: 'PromptSubmitted' as const,
    at: i * 1000,
    sessionId: 's',
    preview: `p${i}`,
  }));
  const s = replay('p', prompts, cfg);
  expect(s.toasts).toHaveLength(TOAST_MAX);
  expect(s.toasts.at(-1)?.text).toContain(`p${TOAST_MAX + 4}`);
});
