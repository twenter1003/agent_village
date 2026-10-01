// 요약된 훅 → 도메인 이벤트 (02 문서 5.2)
import type { Raw } from './summarize';

export type ToolKind = 'read' | 'search' | 'edit' | 'write' | 'shell' | 'web' | 'plan' | 'other';
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'deleted';

/** 응답 usage 합 (D11, 02 문서 2.3). 수집기가 Claude Code 기록 파일에서 읽어 훅 요약본에 붙인다 */
export interface Tokens {
  input: number;
  output: number;
  cacheWrite: number; // 5분 캐시 쓰기 (옛 기록은 1시간 몫도 여기)
  cacheWrite1h?: number; // 1시간 캐시 쓰기 (D13, 무게 2)
  cacheRead: number;
}

/** 영수증 재료 (D13, 01 문서 6.7-2): 수집기가 기록 파일에서 호출마다 맥락 크기로 나눈 토큰 수. 숫자와 도구 이름만 */
export interface Usage {
  calls: number; // 호출(응답) 수
  first: number; // 첫 호출 맥락 크기 (기본 맥락)
  last: number; // 마지막 호출 맥락 크기 (팀장 대화 크기 게이지)
  models: Record<string, Tokens>; // 모델 id별 (빠른 모드면 뒤에 ' fast')
  parts: Record<string, Tokens>; // base | rebuild | tool:<이름> (출력·대화 누적은 나머지로 계산)
}

export interface AgentDef {
  name: string;
  description: string;
}

export type DomainEvent =
  | { t: 'SessionStarted'; at: number; project: string; sessionId: string }
  | { t: 'RosterLoaded'; at: number; agents: AgentDef[]; tycoon: Raw | null }
  | { t: 'PromptSubmitted'; at: number; sessionId: string; preview: string; injected?: boolean } // injected = 앱이 넣은 메시지(태그로 시작) → 회의 없음 (01 문서 4.1)
  | { t: 'AgentCalled'; at: number; callId: string; subagentType: string; subject: string } // 메인 세션의 Agent 호출 (5.1-5 대체 작업)
  | { t: 'AgentCallFailed'; at: number; callId: string }
  | { t: 'TaskCreated'; at: number; taskId: string; subject: string }
  | { t: 'TaskStatusChanged'; at: number; taskId: string; status: TaskStatus }
  | { t: 'AgentRunStarted'; at: number; runId: string; agentType: string; resumed?: boolean } // resumed = 이어 받은 구간 (프로젝터가 붙임, 01 문서 6.1)
  | { t: 'AgentRunEnded'; at: number; runId: string; ok: boolean; lastMessage?: string; tokens?: Tokens; usage?: Usage }
  | {
      t: 'ToolUsed';
      at: number;
      runId: string | null;
      tool: string;
      phase: 'pre' | 'post';
      ok: boolean;
      kind: ToolKind;
      isTest: boolean;
      toolUseId?: string;
      chars?: number; // 편집·쓰기 내용 글자 수 (성격 큰 편집, 01 문서 7장). 숫자만
      agentType?: string; // 서브에이전트 도구 호출의 agent_type — 시작을 못 본 실행의 주인 (01 문서 6.1)
    }
  | { t: 'PermissionPrompt'; at: number; runId: string | null }
  | { t: 'MainTurnEnded'; at: number; sessionId: string; tokens?: Tokens; usage?: Usage } // tokens·usage = 그 세션 메인 기록 누적
  | { t: 'Tick'; at: number } // 수집기 'clock' 줄: 시간만 흐름 (01 문서 6.2 활동 시간)
  | { t: 'GameDayTick'; at: number; day: number } // 프로젝터 안에서만 만든다 (02 문서 6.1). 규칙 테스트는 직접 넣어도 됨
  | { t: 'BuildingRenamed'; at: number; buildingId: string; name: string }
  | { t: 'SessionEnded'; at: number; sessionId: string } // M7: 열린 실행을 닫는다 (01 문서 4장)
  // 사용자 행동 (수집기가 hook 'ui'로 기록, 02 문서 9). M7: 가구 사기·옮기기
  | { t: 'FurniturePurchased'; at: number; memberId: string; kind: string; fabric: string | null }
  | { t: 'FurnitureMoved'; at: number; memberId: string; furnitureId: string; placed: Placement | null };

/** 방 칸 자리: 왼쪽 위 칸, rot 1 = 2×1을 1×2로 돌림 (01 문서 8.4). 모양 검사는 rules/furniture.ts isPlacement */
export type Placement = { x: number; y: number; rot: 0 | 1 };

const KIND: Record<string, ToolKind> = {
  Read: 'read',
  NotebookRead: 'read',
  Grep: 'search',
  Glob: 'search',
  LS: 'search',
  Edit: 'edit',
  MultiEdit: 'edit',
  NotebookEdit: 'edit',
  Write: 'write',
  Bash: 'shell',
  WebFetch: 'web',
  WebSearch: 'web',
  TaskCreate: 'plan',
  TaskUpdate: 'plan',
  TodoWrite: 'plan',
  Agent: 'plan',
  Task: 'plan',
};
export const toolKind = (tool: string): ToolKind => KIND[tool] ?? 'other';

/** 문자열 해시 (작업 id가 응답에 없을 때) */
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

const s = (v: unknown) => (typeof v === 'string' ? v : '');
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
const tk = (v: unknown): Tokens => {
  const t = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const out: Tokens = {
    input: n(t.input),
    output: n(t.output),
    cacheWrite: n(t.cacheWrite),
    cacheRead: n(t.cacheRead),
  };
  if (n(t.cacheWrite1h)) out.cacheWrite1h = n(t.cacheWrite1h);
  return out;
};
/** 모델·원인 키 → 사용량. 프로토타입 키(__proto__ 등)는 버린다 (규칙이 Record에 더한다) */
const tkRecord = (v: unknown): Record<string, Tokens> =>
  Object.fromEntries(
    Object.entries(v && typeof v === 'object' ? v : {})
      .filter(([k]) => !(k in {}))
      .map(([k, x]) => [k, tk(x)]),
  );
/** 요약본의 tokens·usage → { tokens, usage }. 없거나 모양이 틀리면 뺀다 (비용 없음) */
const tokensOf = (v: unknown, u?: unknown): { tokens?: Tokens; usage?: Usage } => {
  if (!v || typeof v !== 'object') return {};
  if (!u || typeof u !== 'object') return { tokens: tk(v) };
  const x = u as Record<string, unknown>;
  const usage = {
    calls: n(x.calls),
    first: n(x.first),
    last: n(x.last),
    models: tkRecord(x.models),
    parts: tkRecord(x.parts),
  };
  return { tokens: tk(v), usage };
};

/** 한 줄의 요약 훅 → 도메인 이벤트 0~1개. roster/clock/ui는 수집기가 만든 내부 이벤트 */
export function normalize(e: Raw): DomainEvent[] {
  // 프로토타입 키(__proto__·constructor·toString…)가 id로 오면 규칙의 Record 조회가 공유 객체를 고친다 → 줄째 버린다
  if (
    [e.agent_id, e.agent_type, e.taskId, e.tool_name, e.buildingId, e.memberId, e.furnitureId, e.furniture].some(
      (v) => typeof v === 'string' && v in Object.prototype,
    )
  )
    return [];
  const at = Date.parse(s(e._t));
  const hook = s(e.hook_event_name);
  const runId = s(e.agent_id) || null;
  const tool = s(e.tool_name);
  switch (hook) {
    case 'SessionStart':
      if (e.source === 'compact') return []; // 압축은 세션 경계가 아니다
      return [{ t: 'SessionStarted', at, project: s(e.cwd), sessionId: s(e.session_id) }];
    case 'roster':
      return [{ t: 'RosterLoaded', at, agents: (e.agents as AgentDef[]) ?? [], tycoon: (e.tycoon as Raw) ?? null }];
    case 'clock': // 날은 프로젝터가 활동 시간으로 정한다. 옛 줄(벽시계)의 day 필드는 버린다 (01 문서 6.2)
      return [{ t: 'Tick', at }];
    case 'ui': // 사용자 행동 (02 문서 5.1·9장). 이름·가구 검사는 프로젝터가 한다
      if (e.kind === 'rename' && s(e.buildingId))
        return [{ t: 'BuildingRenamed', at, buildingId: s(e.buildingId), name: s(e.name) }];
      // 줄의 kind가 행동 이름이라 가구 종류는 furniture 필드
      if (e.kind === 'purchase' && s(e.memberId))
        return [
          {
            t: 'FurniturePurchased',
            at,
            memberId: s(e.memberId),
            kind: s(e.furniture),
            fabric: typeof e.fabric === 'string' ? e.fabric : null,
          },
        ];
      if (e.kind === 'move' && s(e.memberId) && s(e.furnitureId))
        return [
          {
            t: 'FurnitureMoved',
            at,
            memberId: s(e.memberId),
            furnitureId: s(e.furnitureId),
            placed: (e.placed ?? null) as Placement | null,
          },
        ];
      return [];
    case 'UserPromptSubmit':
      // 서브에이전트 보고·백그라운드 알림처럼 앱이 넣은 메시지는 태그로 시작한다 (<agent-message …>, <task-notification>)
      return [
        {
          t: 'PromptSubmitted',
          at,
          sessionId: s(e.session_id),
          preview: s(e.preview),
          // 수집기가 전체 프롬프트로 정한 값. 옛 기록은 미리보기가 태그로 시작하면 (20자에서 잘렸어도)
          injected: e.injected === true || /^\s*<[a-z][\w-]*(?:[\s>/]|$)/.test(s(e.preview)),
        },
      ];
    case 'SubagentStart':
      return runId ? [{ t: 'AgentRunStarted', at, runId, agentType: s(e.agent_type) }] : [];
    case 'SubagentStop':
      return runId
        ? [
            {
              t: 'AgentRunEnded',
              at,
              runId,
              ok: true,
              ...(e.lastMessage ? { lastMessage: s(e.lastMessage) } : {}),
              ...tokensOf(e.tokens, e.usage),
            },
          ]
        : [];
    case 'Notification':
      if (e.notification_type === 'permission_prompt') return [{ t: 'PermissionPrompt', at, runId }];
      // 입력을 기다림 = 턴 끝. 사용자가 중단하면 Stop이 안 오고 이것만 온다 (01 문서 6.2 활동 시간)
      return e.notification_type === 'idle_prompt' ? [{ t: 'MainTurnEnded', at, sessionId: s(e.session_id) }] : [];
    case 'Stop':
    case 'StopFailure': // API 오류로 끝난 턴은 Stop 대신 이것 (Claude Code 2.1.278)
      return [{ t: 'MainTurnEnded', at, sessionId: s(e.session_id), ...tokensOf(e.tokens, e.usage) }];
    case 'SessionEnd':
      return [{ t: 'SessionEnded', at, sessionId: s(e.session_id) }];
    case 'PreToolUse':
    case 'PostToolUse':
    case 'PostToolUseFailure': {
      const post = hook !== 'PreToolUse';
      const ok = hook === 'PostToolUse' && (e.exitCode === undefined || e.exitCode === 0);
      const toolEvent = (): DomainEvent[] => [
        {
          t: 'ToolUsed',
          at,
          runId,
          tool,
          phase: post ? 'post' : 'pre',
          ok: post ? ok : true,
          kind: toolKind(tool),
          isTest: e.isTest === true,
          ...(e.tool_use_id ? { toolUseId: s(e.tool_use_id) } : {}),
          ...(typeof e.chars === 'number' ? { chars: e.chars } : {}),
          ...(runId && s(e.agent_type) ? { agentType: s(e.agent_type) } : {}),
        },
      ];
      // 작업은 성공한 호출만 (실패한 TaskCreate엔 작업이 없다, 5.1-1)
      // D2 대체 (01 문서 5.1-5): 메인 세션의 Agent 호출 = 작업 하나 (Task 도구를 못 본 마을에서만 — 규칙 tasks.ts가 정함)
      const agentCall = (tool === 'Agent' || tool === 'Task') && !runId && s(e.tool_use_id);
      if (agentCall && hook === 'PreToolUse') {
        const call: DomainEvent = {
          t: 'AgentCalled',
          at,
          callId: s(e.tool_use_id),
          subagentType: s(e.subagentType) || 'general-purpose',
          subject: s(e.subject),
        };
        return [call, ...toolEvent()];
      }
      if (agentCall && hook === 'PostToolUseFailure')
        return [{ t: 'AgentCallFailed', at, callId: s(e.tool_use_id) }, ...toolEvent()];
      if (ok && tool === 'TaskCreate') {
        const subject = s(e.subject);
        return [{ t: 'TaskCreated', at, taskId: s(e.taskId) || `h${hash(subject + at)}`, subject }];
      }
      if (ok && tool === 'TaskUpdate' && e.taskId && e.status)
        return [{ t: 'TaskStatusChanged', at, taskId: s(e.taskId), status: s(e.status) as TaskStatus }];
      if (tool === 'TaskCreate' || tool === 'TaskUpdate') return [];
      return toolEvent();
    }
    default:
      return [];
  }
}

/** 중복 제거 키 (session, tool_use_id|시각, hook) */
export const dedupeKey = (e: Raw) =>
  `${s(e.session_id)}|${s(e.tool_use_id) || s(e._t)}|${s(e.hook_event_name)}|${s(e.agent_id)}`;
