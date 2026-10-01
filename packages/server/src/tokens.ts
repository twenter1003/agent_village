// 토큰 사용량 읽기 (D11·D13, 02 문서 2.3): 훅에는 토큰 수가 없어 Claude Code 기록 파일(jsonl)에서 응답마다의 usage 숫자를 더한다.
// 영수증 재료(01 문서 6.7-2)도 여기서: 호출마다 맥락 크기로 기본 맥락·도구 결과(도구 이름별)·캐시 재작성 토큰을 나눈다.
// 대화 내용은 읽어도 남기지 않는다 — 도구 결과는 글자 수만. 형식이 "내부용, 버전마다 바뀜"이라 못 읽으면 null → 비용 없이 (01 문서 6.2)
import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Raw, Tokens, Usage } from '@tycoon/core';

interface Cursor {
  offset: number; // 여기까지 읽음 (완성된 줄 끝)
  ids: Set<string>; // 센 응답 id (한 응답이 여러 줄로 쪼개져 같은 usage가 되풀이된다)
  totals: Tokens;
  u: Usage;
  toolOf: Map<string, string>; // tool_use_id → 도구 이름 (결과가 오면 지움)
  gap: Map<string, number>; // 앞 호출 뒤에 들어온 도구 결과 글자 수 (이름별)
  alive: Map<string, number>; // 맥락에 남아 있는 도구 결과 토큰 (이름별) — 호출마다 다시 읽힌다
  prevOut: number; // 앞 호출의 출력 중 생각을 뺀 몫 (다음 맥락에 들어간다)
}

const zero = (): Tokens => ({ input: 0, output: 0, cacheWrite: 0, cacheWrite1h: 0, cacheRead: 0 });
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const CHUNK = 8 << 20;
/** 파일마다 읽은 위치 (메인 세션 기록은 자라므로 새로 붙은 줄만). 수집기를 다시 켜면 처음부터 한 번 */
const cursors = new Map<string, Cursor>();

const part = (u: Usage, k: string) => (u.parts[k] ??= zero());
const sum = (a: Tokens, b: Tokens) => {
  for (const k of Object.keys(b) as (keyof Tokens)[]) a[k] = (a[k] ?? 0) + (b[k] ?? 0);
};
/** 캐시 쓰기 x토큰을 그 호출의 5분·1시간 비율대로 */
const write = (t: Tokens, x: number, r1h: number) => {
  t.cacheWrite += x * (1 - r1h);
  t.cacheWrite1h = (t.cacheWrite1h ?? 0) + x * r1h;
};

/** 새 응답 하나 = 호출 하나 (01 문서 6.7-2) */
function call(c: Cursor, m: Record<string, unknown>) {
  const u = obj(m.usage);
  const cw = num(u.cache_creation_input_tokens);
  const w1h = Math.min(cw, num(obj(u.cache_creation).ephemeral_1h_input_tokens));
  const t: Tokens = {
    input: num(u.input_tokens),
    output: num(u.output_tokens),
    cacheWrite: cw - w1h,
    cacheWrite1h: w1h,
    cacheRead: num(u.cache_read_input_tokens),
  };
  sum(c.totals, t);
  const model = `${typeof m.model === 'string' ? m.model : 'unknown'}${u.speed === 'fast' ? ' fast' : ''}`;
  sum((c.u.models[model] ??= zero()), t);
  const ctx = t.input + cw + t.cacheRead;
  const r1h = cw ? w1h / cw : 0;
  if (c.u.calls === 0) {
    sum(part(c.u, 'base'), { ...t, output: 0 }); // 첫 호출 = 시스템 프롬프트·도구·CLAUDE.md·지시
    c.u.first = ctx;
  } else {
    if (ctx < c.u.last / 2) c.alive.clear(); // 압축: 그때까지의 결과는 요약돼 더 안 읽힌다
    // 캐시 읽기: 기본 맥락 → 남아 있는 도구 결과 → 나머지는 대화 누적(core가 계산)
    let read = t.cacheRead;
    const b = Math.min(c.u.first, read);
    part(c.u, 'base').cacheRead += b;
    read -= b;
    for (const [name, size] of c.alive) {
      if (read <= 0) break;
      const x = Math.min(size, read);
      part(c.u, `tool:${name}`).cacheRead += x;
      read -= x;
    }
    // 캐시 쓰기: 증가분을 넘는 몫 = 캐시 재작성, 그 안에서 새 도구 결과
    const growth = Math.max(0, ctx - c.u.last);
    const excess = Math.max(0, cw - growth);
    if (excess > 0) write(part(c.u, 'rebuild'), excess, r1h);
    let left = cw - excess;
    const chars = [...c.gap.values()].reduce((a, x) => a + x, 0);
    const added = Math.max(0, growth - c.prevOut); // 앞 출력(생각 뺌)을 뺀 증가분 = 도구 결과·프롬프트
    for (const [name, ch] of c.gap) {
      const size = Math.min(ch, (added * ch) / chars); // 실측 1글자 ≈ 0.6토큰, 글자보다 많을 수 없다
      const x = Math.min(size, left);
      write(part(c.u, `tool:${name}`), x, r1h);
      left -= x;
      c.alive.set(name, (c.alive.get(name) ?? 0) + size);
    }
  }
  c.gap.clear();
  c.u.last = ctx;
  c.prevOut = Math.max(0, t.output - num(obj(u.output_tokens_details).thinking_tokens));
  c.u.calls++;
}

function add(c: Cursor, line: string, main: boolean) {
  if (!line.includes('"usage"') && !line.includes('"tool_result"')) return; // 나머지 줄은 JSON을 풀지 않는다
  let o: { type?: unknown; isSidechain?: unknown; message?: unknown };
  try {
    o = JSON.parse(line) as typeof o;
  } catch {
    return;
  }
  if (main && o.isSidechain === true) return; // 팀장 몫 = 서브에이전트(사이드체인) 줄 빼고
  const m = obj(o.message);
  const blocks = Array.isArray(m.content) ? m.content.map(obj) : [];
  if (o.type === 'user') {
    for (const b of blocks) {
      if (b.type !== 'tool_result') continue;
      const id = typeof b.tool_use_id === 'string' ? b.tool_use_id : '';
      const name = c.toolOf.get(id) ?? 'unknown';
      c.toolOf.delete(id);
      const body = b.content;
      const chars =
        typeof body === 'string'
          ? body.length
          : Array.isArray(body)
            ? body.reduce(
                (a: number, x) => a + (typeof obj(x).text === 'string' ? (obj(x).text as string).length : 0),
                0,
              )
            : 0;
      c.gap.set(name, (c.gap.get(name) ?? 0) + chars);
    }
    return;
  }
  if (!m.usage) return;
  for (const b of blocks)
    if (b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string') c.toolOf.set(b.id, b.name);
  const id = typeof m.id === 'string' ? m.id : null;
  if (id) {
    if (c.ids.has(id)) return;
    c.ids.add(id);
  }
  call(c, m);
}

const round = (t: Tokens): Tokens => ({
  input: Math.round(t.input),
  output: Math.round(t.output),
  cacheWrite: Math.round(t.cacheWrite),
  cacheWrite1h: Math.round(t.cacheWrite1h ?? 0),
  cacheRead: Math.round(t.cacheRead),
});
const roundAll = (r: Record<string, Tokens>) => Object.fromEntries(Object.entries(r).map(([k, t]) => [k, round(t)]));

/** 기록 파일의 누적 사용량 + 영수증 재료. main = 메인 세션 기록(사이드체인 뺌). keep=false면 읽은 위치를 버린다(다 끝난 서브에이전트 기록) */
export function usageOf(path: string, { main = false, keep = true } = {}): { tokens: Tokens; usage: Usage } | null {
  if (!path.endsWith('.jsonl')) return null;
  try {
    const size = statSync(path).size;
    let c = cursors.get(path);
    if (!c || size < c.offset)
      // 처음이거나 파일이 새로 쓰였다
      c = {
        offset: 0,
        ids: new Set(),
        totals: zero(),
        u: { calls: 0, first: 0, last: 0, models: {}, parts: {} },
        toolOf: new Map(),
        gap: new Map(),
        alive: new Map(),
        prevOut: 0,
      };
    const fd = openSync(path, 'r');
    try {
      // ponytail: 동기 읽기. 이미 204를 보낸 뒤라 Claude Code는 안 기다린다. 첫 읽기가 수십 MB면 잠깐 서므로 느려지면 비동기로
      while (c.offset < size) {
        const buf = Buffer.alloc(Math.min(CHUNK, size - c.offset));
        const n = readSync(fd, buf, 0, buf.length, c.offset);
        const end = buf.subarray(0, n).lastIndexOf(10); // 마지막 줄바꿈까지만 (쓰는 중인 줄은 다음에)
        if (end < 0) break;
        for (const line of buf.subarray(0, end).toString('utf8').split('\n')) add(c, line, main);
        c.offset += end + 1;
      }
    } finally {
      closeSync(fd);
    }
    if (keep) cursors.set(path, c);
    else cursors.delete(path);
    const { calls, first, last, models, parts } = c.u;
    return { tokens: round(c.totals), usage: { calls, first, last, models: roundAll(models), parts: roundAll(parts) } };
  } catch {
    return null; // 없거나 못 읽음
  }
}

/** 훅 원문에 붙일 토큰 사용량: SubagentStop = 그 서브에이전트 기록 합, Stop = 메인 세션 누적 (02 문서 2.3) */
export function readTokens(raw: Raw): { tokens: Tokens; usage: Usage } | null {
  const main = typeof raw.transcript_path === 'string' ? raw.transcript_path : '';
  if (raw.hook_event_name === 'SubagentStop') {
    const id = typeof raw.agent_id === 'string' && /^[\w-]+$/.test(raw.agent_id) ? raw.agent_id : '';
    const path =
      typeof raw.agent_transcript_path === 'string'
        ? raw.agent_transcript_path
        : main && id
          ? join(main.replace(/\.jsonl$/, ''), 'subagents', `agent-${id}.jsonl`)
          : '';
    return path ? usageOf(path, { keep: false }) : null;
  }
  if (raw.hook_event_name === 'Stop' || raw.hook_event_name === 'StopFailure')
    return main ? usageOf(main, { main: true }) : null;
  return null;
}
