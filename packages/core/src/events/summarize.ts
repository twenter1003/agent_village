// 훅 원문 → 저장용 요약 (02 문서 2.3). 도구 입력·출력 원문은 남기지 않는다.
import { defaultConfig } from '../config/config';

export type Raw = Record<string, unknown>;

export const DEFAULT_TEST_COMMANDS = defaultConfig.collector.testCommands;
/** 실행기. 바로 뒤(플래그 건너뜀)에 오는 말도 명령 자리로 본다 */
const RUNNERS = new Set('npm pnpm yarn npx bun bunx deno make uv python python3 run exec'.split(' '));

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Raw) : {});
/** 프롬프트 맨 앞의 태그 블록 하나 (<이름 …>…</이름>) */
const TAG_BLOCK = /^\s*<([a-z][\w-]*)\b[^>]*>[\s\S]*?<\/\1>\s*/;

/** 명령 자리(맨 앞, 또는 실행기 뒤)에 목록의 말이 오면 테스트. rm -rf test·echo test는 인자라 아님 (01 문서 6.1) */
export function isTestCommand(cmd: string, list = DEFAULT_TEST_COMMANDS) {
  return cmd.split(/&&|\|\|?|;/).some((part) => {
    const words = part
      .trim()
      .split(/\s+/)
      .filter((w) => !/^\w+=/.test(w)); // CI=1 같은 환경 변수
    let i = 0;
    while (RUNNERS.has(words[i] ?? '') || (i > 0 && words[i]?.startsWith('-'))) i++;
    // 맨 앞의 test는 셸 내장(`test -f x`) → 실행기 뒤에서만 (pnpm test)
    return list.some((t) => (i > 0 || t !== 'test') && t.split(' ').every((w, j) => words[i + j] === w));
  });
}

export function summarize(raw: Raw, opts: { keepLastMessage?: boolean; testCommands?: string[] } = {}): Raw {
  const out: Raw = {};
  for (const k of [
    '_t',
    'hook_event_name',
    'session_id',
    'cwd',
    'agent_id',
    'agent_type',
    'tool_name',
    'tool_use_id',
    'notification_type',
    'source',
  ])
    if (raw[k] !== undefined) out[k] = raw[k];
  const tool = str(raw.tool_name);
  const input = obj(raw.tool_input);
  const resp = obj(raw.tool_response);
  if (tool === 'TaskCreate') {
    out.subject = str(input.subject);
    out.taskId = str(resp.taskId) ?? str(resp.id) ?? str(obj(resp.task).id);
  }
  if (tool === 'TaskUpdate') {
    out.taskId = str(input.taskId);
    out.status = str(input.status);
  }
  if (tool === 'Agent' || tool === 'Task') {
    out.subagentType = str(input.subagent_type);
    // 호출 설명(3~5단어)은 작업 제목으로 (01 문서 5.1-5, TaskCreate subject와 같은 급). 프롬프트 본문은 안 남긴다
    const d = str(input.description);
    if (d) out.subject = d.slice(0, 60);
  }
  const cmd = str(input.command);
  if (cmd) {
    out.cmdHead = cmd.trim().split(/\s+/)[0];
    out.isTest = isTestCommand(cmd, opts.testCommands);
  }
  const fp = str(input.file_path);
  if (fp) out.ext = /\.[\w]+$/.exec(fp)?.[0] ?? '';
  // 편집·쓰기 글자 수 (01 문서 7장 큰 편집): Write·Edit·NotebookEdit 본문, MultiEdit은 edits[].new_string 합
  const content =
    str(input.content) ??
    str(input.new_string) ??
    str(input.new_source) ??
    (Array.isArray(input.edits) ? input.edits.map((x) => str(obj(x).new_string) ?? '').join('') : undefined);
  if (content !== undefined) out.chars = content.length;
  if (raw.hook_event_name === 'PostToolUse' && typeof resp.exit_code === 'number') out.exitCode = resp.exit_code;
  if (raw.hook_event_name === 'PostToolUseFailure') out.failed = true;
  const prompt = str(raw.prompt);
  if (prompt !== undefined) {
    // 앱이 앞에 붙인 태그 블록(<artifact-view-context …>…</…>)은 떼고 사람이 쓴 첫 줄만. 태그만 남으면 앱 메시지 (01 문서 4.1)
    let body = prompt;
    for (let m = TAG_BLOCK.exec(body); m; m = TAG_BLOCK.exec(body)) body = body.slice(m[0].length);
    const injected = !body.trim() || /^\s*<[a-z][\w-]*[\s>/]/.test(body);
    if (injected) out.injected = true;
    out.preview = ((injected ? prompt : body).trim().split('\n')[0] ?? '').slice(0, 20);
  }
  const last = str(raw.last_assistant_message);
  if (last !== undefined && (opts.keepLastMessage ?? true)) out.lastMessage = last.slice(0, 2000);
  // 토큰 사용량 (D11·D13): 수집기가 기록 파일에서 읽어 붙인 숫자만 — 모델·원인 키는 짧은 이름만, 개수 제한
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  const tokens = (v: unknown) => {
    const t = obj(v);
    const x = {
      input: num(t.input),
      output: num(t.output),
      cacheWrite: num(t.cacheWrite),
      cacheRead: num(t.cacheRead),
    };
    return num(t.cacheWrite1h) ? { ...x, cacheWrite1h: num(t.cacheWrite1h) } : x;
  };
  const record = (v: unknown, max: number) =>
    Object.fromEntries(
      Object.entries(obj(v))
        .filter(([k]) => /^[\w.:@ -]{1,100}$/.test(k))
        .slice(0, max)
        .map(([k, x]) => [k, tokens(x)]),
    );
  if (raw.tokens && typeof raw.tokens === 'object') out.tokens = tokens(raw.tokens);
  if (out.tokens && raw.usage && typeof raw.usage === 'object') {
    const u = obj(raw.usage);
    out.usage = {
      calls: num(u.calls),
      first: num(u.first),
      last: num(u.last),
      models: record(u.models, 10),
      parts: record(u.parts, 60),
    };
  }
  return out;
}
