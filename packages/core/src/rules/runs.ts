// 실행·도구·막힘 (01 문서 3.2, 4장 / 02 문서 5.2)
import type { GameConfig } from '../config/config';
import type { DomainEvent, Tokens } from '../events/normalize';
import { nextId } from '../projector/project';
import { tokensDelta, usageDelta } from './economy';
import {
  LEADER_ID,
  type AgentRun,
  type Facility,
  type Member,
  type VillageState,
  type VisitorKind,
} from '../projector/types';

/** 막힘 진입(null → 값)일 때만 알림: 활동 기록 '작업' + 직접 닫는 실패 토스트 (01 문서 9장) */
function block(s: VillageState, m: Member | undefined, cause: 'permission' | 'failures', at: number, why: string) {
  if (!m) return;
  if (!m.blocked) {
    const text = `${m.name} 막힘 · ${why}`;
    s.feed.push({ at, kind: 'task', text, ref: m.id });
    s.toasts.push({ id: nextId(s, 'toast'), at, kind: 'failure', text, sticky: true, ref: m.id });
  }
  m.blocked = cause;
}

/** 가장 최근에 시작해 아직 안 끝난 실행 (같은 시각이면 runId가 큰 쪽) */
function latestOpen(s: VillageState, keep: (r: AgentRun) => boolean) {
  let r: AgentRun | undefined;
  for (const c of Object.values(s.runs))
    if (
      c.endedAt === null &&
      keep(c) &&
      (!r || c.startedAt > r.startedAt || (c.startedAt === r.startedAt && c.runId > r.runId))
    )
      r = c;
  return r;
}

/** 실행 종료. 같은 팀원의 다른 실행이 아직 돌면(병렬 위임) 그 실행이 현재 실행 */
function endRun(s: VillageState, r: AgentRun, at: number, ok: boolean | null) {
  r.endedAt = at;
  r.ok = ok;
  const m = r.memberId ? s.members[r.memberId] : undefined;
  // 현재 실행이 아닌 실행이 끝나면 현재 실행은 그대로
  // ponytail: 막힘은 팀원 단위라 병렬 실행 중 어느 실행이 막혔는지 모른다. 필요하면 AgentRun에 막힘을 둔다
  if (m?.currentRunId === r.runId) {
    m.currentRunId = latestOpen(s, (c) => c.memberId === m.id)?.runId ?? null;
    m.blocked = null; // 실행 종료 → 막힘 끝
  }
  Reflect.deleteProperty(s.visitors, r.runId);
}

type ToolUsed = Extract<DomainEvent, { t: 'ToolUsed' }>;

/** 도구 호출 한 번 (toolCalls를 세는 자리): 성격 S/N 종류·J/P 재시도·전환 (01 문서 7장) */
function habit(r: AgentRun, e: ToolUsed, cfg: GameConfig) {
  const h = (r.habits ??= { kinds: {}, retries: 0, switches: 0, last: null, failed: null });
  const big = e.kind === 'edit' && (e.chars ?? 0) >= cfg.personality.bigEditChars;
  const k = big ? 'bigEdit' : e.kind === 'shell' && e.isTest ? 'test' : e.kind;
  h.kinds[k] = (h.kinds[k] ?? 0) + 1;
  if (h.failed === e.tool) h.retries++;
  if (h.last !== null && h.last !== e.tool) h.switches++;
  h.last = e.tool;
  h.failed = null;
}

/** agent_id → 실행(구간) id (01 문서 6.1). 프로젝터가 규칙보다 먼저 부른다. 이어 받은 서브에이전트(SendMessage)는 같은
 *  agent_id로 다시 시작한다 → 마지막 구간이 끝났으면 시작이나 도구 호출(Pre)이 새 구간 `<agent_id>#n`을 연다. 시작을 못 본
 *  도구 호출은 시작(주인 = agent_type, 없으면 앞 구간)을 먼저 넣는다. 끝·늦게 온 Post·권한 요청은 마지막 구간에 붙고, 시작도
 *  도구도 못 본 끝(Claude Code 안쪽 포크 prompt_suggestion)은 그대로 둬 규칙이 버린다. 열린 구간에 온 시작은 같은 구간(중복).
 *  토큰: 기록 파일 합은 구간을 넘어 누적이라 앞 구간 끝에서 읽은 합(cum)과의 차이로 바꾼다 (같은 누적이 또 오면 0) */
export function segment(s: VillageState, e: DomainEvent): DomainEvent[] {
  if (!('runId' in e) || !e.runId) return [e];
  const aid = e.runId;
  const id = (k: number) => (k > 1 ? `${aid}#${k}` : aid);
  let n = 0;
  while (s.runs[id(n + 1)]) n++;
  const cur = n ? s.runs[id(n)] : undefined;
  // ponytail: SubagentStop 뒤에 늦게 온 Pre(비동기 훅 순서)도 새 구간(도구 1번)을 연다. 실제 기록엔 없었다 — 보이면 끝 뒤 몇 초는 끝난 구간에 붙인다
  const fresh = e.t === 'AgentRunStarted' || (e.t === 'ToolUsed' && (e.phase === 'pre' || !cur));
  if (cur?.endedAt !== null && fresh) {
    const runId = id(n + 1);
    const resumed = n ? { resumed: true } : {};
    if (e.t === 'AgentRunStarted') return [{ ...e, runId, ...resumed }];
    const agentType = (e.t === 'ToolUsed' && e.agentType) || cur?.agentType || '';
    return [
      { t: 'AgentRunStarted', at: e.at, runId, agentType, ...resumed },
      { ...e, runId },
    ];
  }
  if (!cur) return [e];
  // 열린 구간에 온 시작: #2부터는 이어 받은 구간 (Pre가 먼저 열었어도 Agent 호출 작업을 가져가지 않게)
  if (e.t === 'AgentRunStarted') return [{ ...e, runId: cur.runId, ...(n > 1 ? { resumed: true } : {}) }];
  if (e.t !== 'AgentRunEnded' || !e.tokens) return [{ ...e, runId: cur.runId }];
  let before: AgentRun['cum'];
  for (let k = n; k > 0 && !before; k--) before = s.runs[id(k)]?.cum;
  cur.cum ??= { tokens: e.tokens, ...(e.usage ? { usage: e.usage } : {}) }; // 늦게 온 중복 끝(작은 합)이 누적을 내리지 않게
  const sum = (t: Tokens) => t.input + t.output + t.cacheWrite + (t.cacheWrite1h ?? 0) + t.cacheRead;
  // 누적이 줄었다 = 기록 파일이 새로 쓰였다 → 새 합이 이 구간 몫
  const reset =
    !!before && (e.usage && before.usage ? e.usage.calls < before.usage.calls : sum(e.tokens) < sum(before.tokens));
  if (!before || reset) return [{ ...e, runId: cur.runId }];
  const usage = e.usage ? { usage: usageDelta(e.usage, before.usage) } : {};
  return [{ ...e, runId: cur.runId, tokens: tokensDelta(e.tokens, before.tokens), ...usage }];
}

export function applyRuns(s: VillageState, e: DomainEvent, cfg: GameConfig): void {
  switch (e.t) {
    case 'SessionStarted':
    case 'SessionEnded': {
      // 새 세션·세션 끝이면 그 세션의 실행은 끝났다 (SubagentStop 유실·중단). 권한 요청도 끝. 결과는 모름 → ok null (01 문서 4장)
      // ponytail: 한 마을에 동시 세션 하나로 본다. 같은 폴더에서 세션 둘을 돌리면 실행에 sessionId를 둔다
      for (const r of Object.values(s.runs)) if (r.endedAt === null) endRun(s, r, e.at, null);
      const leader = s.members[LEADER_ID];
      if (leader) leader.blocked = null;
      return;
    }
    case 'AgentRunStarted': {
      if (s.runs[e.runId]?.endedAt === null) return; // 같은 시작이 두 번 옴 (중복 전달)
      // 등록된 md 이름 → 팀원, 기본 에이전트 → 외부인, 그 밖 → 알 수 없는 외부인(인력사무소)
      const m = s.members[e.agentType];
      const memberId = m && !m.isLeader ? m.id : null;
      const kind: VisitorKind | null = memberId
        ? null
        : Object.hasOwn(cfg.visitors, e.agentType)
          ? (e.agentType as VisitorKind)
          : 'general-purpose';
      s.runs[e.runId] = {
        runId: e.runId,
        agentType: e.agentType,
        memberId,
        visitorKind: kind,
        startedAt: e.at,
        endedAt: null,
        lastAt: e.at,
        ok: null,
        toolCalls: 0,
        failStreak: 0,
        testsPassed: 0,
        testsFailed: 0,
        openPre: {},
      };
      if (m && memberId) m.currentRunId = e.runId;
      if (kind)
        s.visitors[e.runId] = {
          runId: e.runId,
          kind,
          facility: cfg.visitors[kind].facility as Facility,
          startedAt: e.at,
        };
      return;
    }
    case 'AgentRunEnded': {
      const r = s.runs[e.runId];
      if (!r) return;
      if (e.lastMessage !== undefined) r.lastMessage = e.lastMessage;
      endRun(s, r, e.at, e.ok);
      return;
    }
    case 'ToolUsed': {
      const r = e.runId ? s.runs[e.runId] : undefined;
      if (e.runId && !r) return;
      // runId null = 메인 세션(팀장). 외부인 실행이면 팀원 변화 없음
      const owner = r ? (r.memberId ? s.members[r.memberId] : undefined) : s.members[LEADER_ID];
      if (e.phase === 'pre') {
        if (r) {
          r.toolCalls++;
          habit(r, e, cfg);
          r.openPre[e.tool] = (r.openPre[e.tool] ?? 0) + 1;
        }
        return;
      }
      // ponytail: 메인 세션은 실행 기록이 없어 도구 수·연속 실패를 세지 않는다. 팀장 실패 막힘이 필요하면 메인용 AgentRun 추가
      if (r) {
        const open = r.openPre[e.tool] ?? 0;
        // 짝이 되는 Pre를 이미 셌으면 다시 세지 않는다
        if (open > 0) r.openPre[e.tool] = open - 1;
        else {
          r.toolCalls++;
          habit(r, e, cfg);
        }
        if (r.habits) r.habits.failed = e.ok ? null : e.tool;
        r.failStreak = e.ok ? 0 : r.failStreak + 1;
        if (e.isTest) {
          if (e.ok) r.testsPassed++;
          else r.testsFailed++;
        }
      }
      if (e.ok) {
        if (owner) owner.blocked = null; // 다음 도구 성공 → 막힘 끝
      } else if (r && r.failStreak >= cfg.status.blockedOnToolFailureStreak) {
        block(s, owner, 'failures', e.at, `도구가 ${r.failStreak}번 연달아 실패했어요`);
      }
      return;
    }
    case 'PermissionPrompt': {
      if (!cfg.status.blockedOnPermissionPrompt) return;
      // agent_id가 없으면 가장 최근에 시작해 아직 안 끝난 실행 (같은 시각이면 runId가 큰 쪽), 없으면 메인 세션
      const r = e.runId ? s.runs[e.runId] : latestOpen(s, () => true);
      if (e.runId && !r) return;
      const m = r ? (r.memberId ? s.members[r.memberId] : undefined) : s.members[LEADER_ID];
      block(s, m, 'permission', e.at, '권한 요청을 기다려요');
      return;
    }
    case 'MainTurnEnded': {
      // 메인 세션 턴 끝 = 팀장의 "실행 종료"
      const leader = s.members[LEADER_ID];
      if (leader) leader.blocked = null;
      return;
    }
    default:
      return;
  }
}
