// 토큰 사용량 읽기 (D11, 02 문서 2.3): 응답 id로 한 번씩, 팀장 몫은 사이드체인 뺌, 쓰는 중인 줄은 다음에, 자라는 파일은 새 줄만
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { readTokens, usageOf } from './tokens';

const dir = mkdtempSync(join(tmpdir(), 'tycoon-tokens-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const line = (id: string, usage: Record<string, number>, extra: Record<string, unknown> = {}) =>
  `${JSON.stringify({ type: 'assistant', ...extra, message: { id, content: [{ type: 'text', text: '비밀' }], usage } })}\n`;
const u = (input: number, output: number, cw = 0, cr = 0) => ({
  input_tokens: input,
  output_tokens: output,
  cache_creation_input_tokens: cw,
  cache_read_input_tokens: cr,
});

test('메인 기록: 같은 응답이 여러 줄이어도 한 번, 사이드체인·사용자 줄은 뺌, 쓰는 중인 줄은 다음에, 자라면 새 줄만', () => {
  const main = join(dir, 'session.jsonl');
  writeFileSync(
    main,
    line('m1', u(1, 10, 100, 1000)) +
      line('m1', u(1, 10, 100, 1000)) + // 내용 블록마다 되풀이
      line('s1', u(5, 50), { isSidechain: true }) +
      `${JSON.stringify({ type: 'user', message: { content: '안녕' } })}\n` +
      line('m2', u(2, 20)).slice(0, 30), // 아직 쓰는 중
  );
  expect(usageOf(main, { main: true })?.tokens).toMatchObject({
    input: 1,
    output: 10,
    cacheWrite: 100,
    cacheRead: 1000,
  });
  appendFileSync(main, `${line('m2', u(2, 20)).slice(30)}${line('m3', u(3, 30))}`);
  expect(usageOf(main, { main: true })?.tokens).toMatchObject({
    input: 6,
    output: 60,
    cacheWrite: 100,
    cacheRead: 1000,
  });
  // 못 읽는 것: 없는 파일, .jsonl이 아님
  expect(usageOf(join(dir, 'none.jsonl'))).toBeNull();
  expect(usageOf(join(dir, 'x.txt'))).toBeNull();
});

test('SubagentStop: <세션>/subagents/agent-<id>.jsonl 합 (agent_transcript_path가 있으면 그것), 이상한 id는 안 읽음', () => {
  const main = join(dir, 'abc.jsonl');
  writeFileSync(main, '');
  mkdirSync(join(dir, 'abc', 'subagents'), { recursive: true });
  writeFileSync(join(dir, 'abc', 'subagents', 'agent-a1.jsonl'), line('x', u(4, 40), { isSidechain: true }));
  const stop = (extra: Record<string, unknown>) =>
    readTokens({ hook_event_name: 'SubagentStop', transcript_path: main, ...extra });
  expect(stop({ agent_id: 'a1' })?.tokens).toMatchObject({ input: 4, output: 40, cacheWrite: 0, cacheRead: 0 }); // 서브에이전트 기록은 전부
  expect(stop({ agent_id: '../abc' })).toBeNull();
  expect(stop({ agent_id: 'nope' })).toBeNull();
  expect(stop({ agent_transcript_path: join(dir, 'abc', 'subagents', 'agent-a1.jsonl') })?.tokens).toMatchObject({
    output: 40,
  });
  expect(readTokens({ hook_event_name: 'PostToolUse', transcript_path: main })).toBeNull();
  expect(readTokens({ hook_event_name: 'Stop' })).toBeNull();
});

test('영수증 재료 (D13, 01 문서 6.7-2): 기본 맥락·도구 결과(증가분을 글자 비율로)·캐시 재작성, 1시간 쓰기·모델, 결과 내용은 안 남김', () => {
  const f = join(dir, 'receipt.jsonl');
  const call = (id: string, cw: number, cr: number, out: number, tool?: [string, string], h1 = false) =>
    `${JSON.stringify({
      type: 'assistant',
      message: {
        id,
        model: 'claude-opus-5-5',
        content: tool ? [{ type: 'tool_use', id: tool[0], name: tool[1], input: { command: '비밀' } }] : [],
        usage: {
          input_tokens: 0,
          output_tokens: out,
          cache_creation_input_tokens: cw,
          cache_read_input_tokens: cr,
          cache_creation: { ephemeral_5m_input_tokens: h1 ? 0 : cw, ephemeral_1h_input_tokens: h1 ? cw : 0 },
        },
      },
    })}\n`;
  const result = (id: string, chars: number) =>
    `${JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: '비'.repeat(chars) }] } })}\n`;
  writeFileSync(
    f,
    call('a', 1000, 0, 100, ['t1', 'Bash']) + // 첫 호출 = 기본 맥락 1000
      result('t1', 500) + // 맥락 1000 → 1400: 앞 출력 100을 빼면 결과 300토큰
      call('b', 400, 1000, 50, ['t2', 'Read']) +
      result('t2', 200) + // 1400 → 1550: 출력 50을 빼면 100
      call('c', 150, 1400, 20) +
      call('d', 1570, 0, 10, undefined, true), // 캐시가 풀려 맥락 전체를 1시간 캐시로 다시 씀
  );
  const r = usageOf(f, { keep: false });
  expect(r?.tokens).toEqual({ input: 0, output: 180, cacheWrite: 1550, cacheWrite1h: 1570, cacheRead: 2400 });
  expect(r?.usage).toMatchObject({ calls: 4, first: 1000, last: 1570 });
  expect(Object.keys(r?.usage.models ?? {})).toEqual(['claude-opus-5-5']);
  const z = { input: 0, output: 0, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0 };
  expect(r?.usage.parts).toEqual({
    base: { ...z, cacheWrite: 1000, cacheRead: 2000 }, // 첫 호출 + 뒤 두 호출이 1000씩 다시 읽음 (넷째는 캐시가 풀려 0)
    'tool:Bash': { ...z, cacheWrite: 300, cacheRead: 300 }, // 한 번 쓰고 셋째 호출이 다시 읽음
    'tool:Read': { ...z, cacheWrite: 100 },
    rebuild: { ...z, cacheWrite1h: 1550 }, // 1570 − 증가분 20
  });
  expect(JSON.stringify(r)).not.toContain('비밀');
});
