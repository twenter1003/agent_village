// 작업·기여 (01 문서 5장, 06 문서 5.8). 작업은 급여 기록·효율·회의·활동 기록·신문의 단위이고 건물을 만들지 않는다 —
// 건물은 팀원 일터 (rules/workplace.ts). 순수: 시각은 e.at
import type { DomainEvent, TaskStatus } from '../events/normalize';
import { LEADER_ID, type AgentRun, type Task, type VillageState } from '../projector/types';

export function applyTasks(s: VillageState, e: DomainEvent): void {
  if (e.t === 'TaskCreated') s.taskTool = true; // 이제 Agent 호출은 작업이 아니다 (5.1-5)
  if (e.t === 'TaskCreated' && !s.tasks[e.taskId]) create(s, e.taskId, e.subject, e.at);
  if (e.t === 'TaskStatusChanged') changeStatus(s, e.taskId, e.status, e.at);
  agentTasks(s, e);
  if (e.t === 'BuildingRenamed') {
    // 없는 일터·규칙에 안 맞는 이름은 버린다 (서버가 400으로 먼저 막는다). own 키만 (constructor 같은 이름으로 프로토타입을 집지 않게)
    const b = Object.hasOwn(s.buildings, e.buildingId) ? s.buildings[e.buildingId] : undefined;
    const name = cleanBuildingName(e.name);
    if (b && name !== null) b.name = name;
  }
  // 실행 중인 팀원은 자기 실행의 작업(Agent 호출 대체), 없으면 가장 최근에 시작된 진행 중 작업에 붙인다
  let cur: Task | undefined;
  for (const t of Object.values(s.tasks))
    if (t.status === 'in_progress' && (!cur || (t.startedAt ?? 0) >= (cur.startedAt ?? 0))) cur = t;
  for (const m of Object.values(s.members)) {
    const own = s.runs[m.currentRunId ?? '']?.taskId;
    m.currentTaskId = !m.currentRunId ? null : own && s.tasks[own]?.status === 'in_progress' ? own : (cur?.id ?? null);
  }
}

/** 이 이벤트로 완료된 작업 id들: TaskUpdate(completed), Agent 호출 대체 작업의 실행 끝 (5.1-5), 새 세션·세션 끝이 닫은 실행의
 *  대체 작업. 성격 표본이 쓴다 (급여는 작업이 아니라 실행이 끝날 때, D20). 늦은 중복 완료는 completedAt이 달라 빠진다 */
export function completedBy(s: VillageState, e: DomainEvent): string[] {
  const ids =
    e.t === 'TaskStatusChanged' && e.status === 'completed'
      ? [e.taskId]
      : e.t === 'AgentRunEnded'
        ? [s.runs[e.runId]?.taskId ?? '']
        : e.t === 'SessionStarted' || e.t === 'SessionEnded'
          ? Object.values(s.runs).map((r) => (r.endedAt === e.at ? (r.taskId ?? '') : ''))
          : [];
  return [...new Set(ids)].filter((id) => s.tasks[id]?.status === 'completed' && s.tasks[id]?.completedAt === e.at);
}

/** 5.1-5 대체: Task 도구를 못 본 마을에서 메인 세션의 Agent 호출 = 작업 하나. 같은 종류의 다음 실행과 짝짓고, 끝나면 완료 */
function agentTasks(s: VillageState, e: DomainEvent) {
  if (e.t === 'AgentCalled' && !s.taskTool) {
    const id = `agent:${e.callId}`;
    if (s.tasks[id]) return;
    create(s, id, e.subject || `${e.subagentType} 작업`, e.at);
    changeStatus(s, id, 'in_progress', e.at);
    s.agentCalls.push({ callId: e.callId, type: e.subagentType, taskId: id });
  }
  if (e.t === 'AgentCallFailed') {
    const i = s.agentCalls.findIndex((c) => c.callId === e.callId);
    if (i >= 0) changeStatus(s, s.agentCalls.splice(i, 1)[0]?.taskId ?? '', 'deleted', e.at);
  }
  if (e.t === 'AgentRunStarted') {
    const r = s.runs[e.runId];
    const type = e.agentType || 'general-purpose'; // 이름 없는 실행 = 호출 쪽 기본값과 같게 (normalize AgentCalled)
    const i = s.agentCalls.findIndex((c) => c.type === type);
    // 이어 받은 구간은 SendMessage로 온다 — 새 Agent 호출의 작업을 가져가지 않는다 (01 문서 6.1)
    if (r && r.taskId === undefined && !e.resumed && i >= 0) r.taskId = s.agentCalls.splice(i, 1)[0]?.taskId;
  }
  if (e.t === 'AgentRunEnded') {
    const id = s.runs[e.runId]?.taskId;
    if (id) changeStatus(s, id, 'completed', e.at);
  }
  if (e.t === 'SessionStarted' || e.t === 'SessionEnded') {
    // 세션이 닫은 실행(SubagentStop 유실)의 작업은 여기서 완료 — 안 하면 작업이 영영 안 끝난다 (M9 실사용 리뷰)
    for (const r of Object.values(s.runs))
      if (r.taskId && r.endedAt === e.at && s.tasks[r.taskId]?.status === 'in_progress')
        changeStatus(s, r.taskId, 'completed', e.at);
    // 실행과 짝짓지 못한 호출은 일한 흔적이 없다 → 지운다
    for (const c of s.agentCalls) changeStatus(s, c.taskId, 'deleted', e.at);
    s.agentCalls = [];
  }
}

export const NAME_MAX = 24;

// 5.3 보이지 않는 글자: 제어·서식 문자, 한글 채움(U+115F·U+1160·U+3164·U+FFA0), 점자 빈칸. \s가 못 잡는다
const INVISIBLE = /[\p{Cc}\p{Cf}\u115F\u1160\u3164\uFFA0\u2800]/gu;

/** 5.3 사용자 이름: 보이지 않는 글자는 공백으로(이모지 잇는 ZWJ만 둠), 앞뒤 공백을 떼고 연속 공백을 하나로,
 *  1~24자(코드 포인트), 보이는 글자가 하나 이상. 아니면 null. 서버 400과 같은 규칙 */
export function cleanBuildingName(v: unknown): string | null {
  const name =
    typeof v === 'string'
      ? v
          .replace(INVISIBLE, (c) => (c === '\u200D' ? c : ' '))
          .trim()
          .replace(/\s+/g, ' ')
      : '';
  const len = [...name].length;
  return len > 0 && len <= NAME_MAX && /[^\s\u200D]/.test(name) ? name : null;
}

function create(s: VillageState, id: string, subject: string, at: number) {
  s.tasks[id] = {
    id,
    subject,
    status: 'pending',
    createdAt: at,
    contributions: {},
    quality: 'noTests',
    toolCalls: 0,
    salaryPaid: 0,
  };
}

function changeStatus(s: VillageState, id: string, status: TaskStatus, at: number) {
  const t = s.tasks[id];
  // 지운 작업은 끝: 늦은 갱신이 되살리지 않는다 (01 문서 5.4 M7)
  if (!t || t.status === status || t.status === 'deleted') return;
  t.status = status;
  if (status === 'in_progress') t.startedAt ??= at;
  if (status !== 'completed') return;
  t.completedAt = at;
  const sh = shares(s, t, at);
  t.contributions = {};
  for (const x of sh) t.contributions[x.key] = (t.contributions[x.key] ?? 0) + x.ms;
  const runs = sh.flatMap((x) => (x.run ? [x.run] : []));
  t.toolCalls = runs.reduce((n, r) => n + r.toolCalls, 0);
  // 6.1: 실행 중 테스트 명령이 한 번이라도 성공 → testsPassed (실패 뒤 고쳐서 통과도)
  t.quality = runs.some((r) => r.ok === false)
    ? 'failed'
    : runs.some((r) => r.testsPassed > 0)
      ? 'testsPassed'
      : 'noTests';
}

/** 5.3 작업이 진행 중이던 [시작, to]와 겹친 실행들. 없으면(in_progress였던 적이 없어도) 팀장이 전부. 성격 표본(7장)·작업 기여가 쓴다 */
export function shares(s: VillageState, t: Task, to: number) {
  const from = t.startedAt ?? t.createdAt;
  const out: { key: string; ms: number; from: number; run?: AgentRun }[] = [];
  if (t.startedAt !== undefined)
    for (const run of Object.values(s.runs)) {
      const key = run.memberId ?? run.visitorKind;
      const start = Math.max(run.startedAt, from);
      const ms = Math.min(run.endedAt ?? to, to) - start;
      if (key && ms > 0) out.push({ key, ms, from: start, run });
    }
  return out.length ? out : [{ key: LEADER_ID, ms: Math.max(1, to - from), from }];
}
