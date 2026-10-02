// 경제 (01 문서 6장, 06 문서 3·4장): 급여·세금, 게임 하루 정산(레벨업·자동 구매·공공시설), 마을 기금(= 팀장 지갑, D21). 순수.
// 금액은 모두 정수 진주. 난수는 seed 해시만 (02 문서 1장 원칙 3)
import type { GameConfig } from '../config/config';
import type { DomainEvent, Tokens, Usage } from '../events/normalize';
import { nextId } from '../projector/project';
import { LEADER_ID, type AgentRun, type Member, type Task, type VillageState } from '../projector/types';
import { findSpot } from './furniture';
import { buildPublicWork, levelUp } from './village';
import { accrue, materialsReserve, raiseAll, waitingMaterials } from './workplace';

/** 6.4 가구 가격 = basePrice (고정, D20 규칙 2 — 물가 없음). 모르는 가구는 null */
export function furniturePrice(kind: string, cfg: GameConfig): number | null {
  return cfg.furniture.find((x) => x.id === kind)?.basePrice ?? null;
}

/** 일 점수 (06 문서 5.2) = 도구 호출 수 × 품질. 급여·효율·(M13) 일터 게이지의 공통 단위. 서브에이전트 실행 하나를 센다 */
export function workPoints(t: Pick<Task, 'toolCalls' | 'quality'>, cfg: GameConfig): number {
  return t.toolCalls * cfg.economy.quality[t.quality];
}

/** 6.1 급여(세전, 반올림 정수) = wagePerCall × 도구 호출 수 × 품질 (D20). 쪼개도 합이 같다 */
export function salary(toolCalls: number, quality: Task['quality'], cfg: GameConfig): number {
  return Math.max(0, Math.round(cfg.economy.wagePerCall * workPoints({ toolCalls, quality }, cfg)));
}

/** 실행의 품질 (06 문서 3.4): 실패로 끝나면 failed, 테스트가 통과만 했으면 testsPassed, 그 밖 noTests */
function runQuality(r: AgentRun): Task['quality'] {
  return r.ok === false ? 'failed' : r.testsPassed > 0 && r.testsFailed === 0 ? 'testsPassed' : 'noTests';
}

/** 실행 하나의 일 점수 */
export const runPoints = (r: AgentRun, cfg: GameConfig) =>
  workPoints({ toolCalls: r.toolCalls, quality: runQuality(r) }, cfg);

/** 모델 단가 (D13, 01 문서 6.7-1): 모델 id에 match가 들어간 첫 줄, 빠른 모드(' fast')는 × fastScale. 모르면 배율 1·기본 캐시 읽기 */
function priceOf(model: string | undefined, cfg: GameConfig) {
  const c = cfg.economy.tokens;
  const row = model === undefined ? undefined : c.models.find((r) => model.includes(r.match));
  return {
    scale: (row?.scale ?? 1) * (model?.endsWith(' fast') ? c.fastScale : 1),
    cacheRead: row?.cacheRead ?? c.weights.cacheRead,
  };
}

/** 비용 환산 토큰 (D11·D13) = 모델 배율 × (입력 × 1 + 출력 × 5 + 캐시 쓰기 5분 × 1.25 + 1시간 × 2 + 캐시 읽기 × 0.1(모델마다)).
 *  모델을 모르면 D11 그대로 (economy.tokens.weights) */
export function tokenWeight(t: Tokens, cfg: GameConfig, model?: string): number {
  const w = cfg.economy.tokens.weights;
  const p = priceOf(model, cfg);
  return (
    p.scale *
    (t.input * w.input +
      t.output * w.output +
      t.cacheWrite * w.cacheWrite +
      (t.cacheWrite1h ?? 0) * w.cacheWrite1h +
      t.cacheRead * p.cacheRead)
  );
}

const ZERO: Tokens = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
const sumOf = (xs: number[]) => xs.reduce((a, x) => a + x, 0);
const median = (xs: number[]) => {
  const a = [...xs].sort((x, y) => x - y);
  const k = a.length >> 1;
  return a.length % 2 ? (a[k] ?? 0) : ((a[k - 1] ?? 0) + (a[k] ?? 0)) / 2;
};
/** 가장 많이 쓴 키 (같으면 앞) */
const top = (r: Record<string, number>) =>
  Object.entries(r).reduce<[string, number] | null>((b, x) => (!b || x[1] > b[1] ? x : b), null);

/** 토큰 영수증 (01 문서 6.7-2): 모델별 실제 비용 합 + 원인별 비용(가장 많이 쓴 모델의 무게). 대화 누적 = 나머지.
 *  근사라 원인 합이 실제보다 크면 실제에 맞게 줄인다 */
export function receiptOf(u: Usage, cfg: GameConfig) {
  const models = Object.fromEntries(Object.entries(u.models).map(([k, t]) => [k, tokenWeight(t, cfg, k)]));
  const total = sumOf(Object.values(models));
  const main = top(models)?.[0];
  const output = { ...ZERO, output: sumOf(Object.values(u.models).map((t) => t.output)) };
  const parts: Record<string, number> = {};
  for (const [k, t] of [...Object.entries(u.parts), ['output', output] as const]) {
    const x = tokenWeight(t, cfg, main);
    if (x > 0) parts[k] = x;
  }
  const known = sumOf(Object.values(parts));
  if (known > total) for (const k of Object.keys(parts)) parts[k] = ((parts[k] ?? 0) * total) / known;
  else if (total - known > 0) parts.talk = total - known;
  return { total, parts, models };
}

/** 누적 토큰끼리의 차이 (이어 받은 서브에이전트 구간, 01 문서 6.1) */
export const tokensDelta = (a: Tokens, b: Tokens = ZERO): Tokens => ({
  input: Math.max(0, a.input - b.input),
  output: Math.max(0, a.output - b.output),
  cacheWrite: Math.max(0, a.cacheWrite - b.cacheWrite),
  cacheWrite1h: Math.max(0, (a.cacheWrite1h ?? 0) - (b.cacheWrite1h ?? 0)),
  cacheRead: Math.max(0, a.cacheRead - b.cacheRead),
});

/** 세션 누적끼리의 차이 (팀장은 메인 턴마다 새로 쓴 몫, D11·D13. 이어 받은 서브에이전트 구간도) */
export function usageDelta(now: Usage, before: Usage | undefined): Usage {
  const minus = tokensDelta;
  const each = (r: Record<string, Tokens>, p: Record<string, Tokens> = {}) =>
    Object.fromEntries(Object.entries(r).map(([k, t]) => [k, minus(t, Object.hasOwn(p, k) ? p[k] : undefined)]));
  return {
    calls: Math.max(0, now.calls - (before?.calls ?? 0)),
    first: now.first,
    last: now.last,
    models: each(now.models, before?.models),
    parts: each(now.parts, before?.parts),
  };
}

function addReceipt(m: Member, r: ReturnType<typeof receiptOf>, calls: number) {
  const add = (to: Record<string, number>, from: Record<string, number>) => {
    for (const [k, x] of Object.entries(from)) to[k] = (Object.hasOwn(to, k) ? (to[k] ?? 0) : 0) + x;
  };
  m.receipt.runs++;
  m.receipt.calls += calls;
  add(m.receipt.parts, r.parts);
  add(m.receipt.models, r.models);
}

/** 원인 이름 (알림 글자. 화면은 이름 사전 house.parts) */
const causeName = (k: string) =>
  k.startsWith('tool:')
    ? `${k.slice(5)} 결과`
    : (({ base: '기본 맥락', output: '출력', rebuild: '캐시 재작성', talk: '대화 누적' } as Record<string, string>)[
        k
      ] ?? k);
/** 큰 토큰 수를 알림 글자로: 496,039 → 49.6만 */
const man = (n: number) => `${Math.round(n / 1000) / 10}만`;

/** 가장 큰 원인과 비중 (0~1). 영수증이 비었으면 null */
export function topCause(parts: Record<string, number>): { key: string; share: number } | null {
  const t = top(parts);
  const total = sumOf(Object.values(parts));
  return t && total > 0 ? { key: t[0], share: t[1] / total } : null;
}

/** 처방 팁 (6.7-3): 규칙만 (모델 호출 없음). 영수증 비중이 기준을 넘는 원인 큰 순 2줄 + 모델·재시도 신호, 최대 3줄.
 *  p = 비중(0~1), n = 실행당 호출 수, tool = 도구 이름. 글자는 화면 이름 사전 house.tip.<key> */
export type Tip = {
  key: 'base' | 'baseLeader' | 'tool' | 'rebuild' | 'output' | 'talk' | 'talkLeader' | 'model' | 'retry';
  p: number;
  n?: number;
  tool?: string;
};
export function tips(s: VillageState, m: Member): Tip[] {
  const parts = m.receipt.parts;
  const total = sumOf(Object.values(parts));
  if (total <= 0) return [];
  const share = (k: string) => (Object.hasOwn(parts, k) ? (parts[k] ?? 0) : 0) / total;
  const perRun = m.receipt.runs ? Math.round(m.receipt.calls / m.receipt.runs) : 0;
  const found: Tip[] = [];
  if (share('base') >= 0.35) found.push({ key: m.isLeader ? 'baseLeader' : 'base', p: share('base') });
  for (const k of Object.keys(parts))
    if (k.startsWith('tool:') && share(k) >= 0.2) found.push({ key: 'tool', p: share(k), tool: k.slice(5) });
  if (share('rebuild') >= 0.1) found.push({ key: 'rebuild', p: share('rebuild') });
  if (share('output') >= 0.2) found.push({ key: 'output', p: share('output') });
  if (share('talk') >= 0.4) found.push({ key: m.isLeader ? 'talkLeader' : 'talk', p: share('talk'), n: perRun });
  found.sort((a, b) => b.p - a.p);
  const flags: Tip[] = [];
  if (!m.isLeader) {
    const model = top(m.receipt.models)?.[0] ?? '';
    if (/opus|fable|mythos/.test(model) && m.receipt.runs > 0 && perRun <= 8)
      flags.push({ key: 'model', p: 1, n: perRun });
    const runs = Object.values(s.runs).filter((r) => r.memberId === m.id);
    const calls = sumOf(runs.map((r) => r.toolCalls));
    const retries = sumOf(runs.map((r) => r.habits?.retries ?? 0));
    if (calls >= 10 && retries / calls >= 0.15) flags.push({ key: 'retry', p: retries / calls });
  }
  return [...found.slice(0, 2), ...flags].slice(0, 3);
}

/** 6.7-6 비싼 실행: 최근 실행 비용 중앙값 × ratio를 넘고 minTokens 이상이면 알림 */
function alertRun(
  s: VillageState,
  m: Member,
  cost: number,
  parts: Record<string, number> | null,
  at: number,
  cfg: GameConfig,
) {
  const { ratio, minTokens } = cfg.efficiency.alert;
  const xs = m.eff.recent.map((x) => x.tokens).filter((x) => x > 0);
  if (xs.length < cfg.efficiency.minTasks || cost < minTokens) return;
  const med = median(xs);
  if (cost <= med * ratio) return;
  const cause = parts && topCause(parts);
  const text = `${m.name} 실행 한 번이 평소의 ${(cost / med).toFixed(1)}배 · ${man(cost)}${cause ? ` · 주원인 ${causeName(cause.key)} ${Math.round(cause.share * 100)}%` : ''}`;
  s.feed.push({ at, kind: 'economy', text, ref: m.id });
  s.toasts.push({ id: nextId(s, 'toast'), at, kind: 'tokens', text, sticky: false, ref: m.id });
}

/** 6.7-4 팀장 대화 크기: 마지막 호출 맥락 크기. 기준을 넘으면 세션마다 한 번 알림, 기준 아래로 줄면(압축) 다시 알릴 수 있다 */
function gauge(s: VillageState, sessionId: string, u: Usage, at: number, cfg: GameConfig) {
  const warn = cfg.efficiency.leaderCtxWarn;
  const model = top(Object.fromEntries(Object.entries(u.models).map(([k, t]) => [k, tokenWeight(t, cfg, k)])))?.[0];
  const p = priceOf(model, cfg);
  const perCall = u.last * p.cacheRead * p.scale;
  const was = s.mainCtx?.sessionId === sessionId && s.mainCtx.warned;
  const over = u.last >= warn;
  s.mainCtx = { sessionId, tokens: u.last, perCall, at, warned: over };
  if (!over || was) return;
  const text = `팀장 대화가 ${man(u.last)} 토큰 · 호출마다 약 ${man(perCall)}씩 다시 읽어요 · /compact나 새 세션으로 줄여요`;
  s.feed.push({ at, kind: 'economy', text, ref: LEADER_ID });
  s.toasts.push({ id: nextId(s, 'toast'), at, kind: 'tokens', text, sticky: false, ref: LEADER_ID });
}

/** 치운 세션 누적은 남기지 않는다 — 스냅샷이 세션마다 커지지 않게 (D13) */
export const MAIN_USAGE_KEEP = 20;
function remember(s: VillageState, sessionId: string, u: Usage) {
  Reflect.deleteProperty(s.mainUsage, sessionId);
  s.mainUsage[sessionId] = u; // 최근이 뒤
  const keys = Object.keys(s.mainUsage);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAIN_USAGE_KEEP))) Reflect.deleteProperty(s.mainUsage, k);
}

/** 토큰 비용 내기 (팀원): 진주 = 비용 환산 ÷ perPearl 반올림. 모자라면 가진 만큼 + 형편이 어려움, 다 내면 풀림.
 *  0진주 청구는 형편을 바꾸지 않는다 (형편 = 마지막 진짜 청구를 못 냄). 낸 돈은 사라진다. runId = 그 실행의 효율 줄에 토큰을 더한다 */
function chargeTokens(s: VillageState, m: Member, runId: string, weight: number, at: number, cfg: GameConfig) {
  m.tokens += weight;
  const row = m.eff.recent.find((x) => x.runId === runId);
  if (row) row.tokens += weight;
  const cost = Math.round(weight / cfg.economy.tokens.perPearl);
  if (cost <= 0) return;
  const paid = Math.min(cost, Math.max(0, m.balance));
  m.balance -= paid;
  m.tokenCostToday += paid;
  s.economy.today.tokens += paid;
  if (paid < cost) {
    if (!m.hardship)
      s.feed.push({ at, kind: 'economy', text: `${m.name} 형편이 어려움 · 토큰 비용을 다 못 냈어요`, ref: m.id });
    m.hardship = true;
  } else m.hardship = false;
}

/** 팀장 = 시장 (D21): 팀장 토큰값은 마을 기금에서. 모자라면 가진 만큼 + 시청 적자 (들어갈 때 한 줄), 못 낸 몫은 leaderUnpaid로
 *  기록만 (돈이 아님, 06 문서 3.3). 적자는 붙어 있다: 다 낸 청구로는 안 풀리고 정산이 푼다 (settle). 0진주 청구는 아무것도 바꾸지 않는다 */
function chargeLeader(s: VillageState, leader: Member, weight: number, at: number, cfg: GameConfig) {
  leader.tokens += weight;
  const cost = Math.round(weight / cfg.economy.tokens.perPearl);
  if (cost <= 0) return;
  const ec = s.economy;
  const paid = Math.min(cost, Math.max(0, ec.fund));
  ec.fund -= paid;
  ec.today.leaderTokens += paid;
  ec.today.leaderUnpaid += cost - paid;
  leader.tokenCostToday += paid;
  if (paid < cost) {
    // 들어갈 때 한 번: 활동 기록 + 알림 (06 문서 13장)
    if (!ec.deficit) {
      const text = '시청 적자 · 마을 기금이 팀장 토큰값을 다 못 냈어요';
      s.feed.push({ at, kind: 'economy', text, ref: LEADER_ID });
      s.toasts.push({ id: nextId(s, 'toast'), at, kind: 'tokens', text, sticky: false, ref: LEADER_ID });
    }
    ec.deficit = true;
  }
}

/** 성격 글자 4개 = 히스테리시스를 거친 personality.letters (01 문서 6.4·7장, M8) */
export function personalityLetters(m: Member): string {
  return m.personality.letters;
}

/** seed 난수 [0, 1): 같은 (n, k)면 같은 값. mulberry32 한 걸음이라 상태가 없다 */
function rand(n: number, k = 0) {
  let t = (n + Math.imul(k, 0x9e3779b9) + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** 실행이 끝나면 한 번 (D20, 06 문서 3.4): 급여 = wagePerCall × 그 실행의 도구 호출 × 품질을 그 팀원에게.
 *  세금 round(급여 × taxRate)는 기금, 나머지는 잔고. 외부인 실행은 급여 없음(팀장은 실행이 없다). 짝지어진 작업엔 salaryPaid로 적고,
 *  효율 줄(D23)을 하나 연다 — 토큰은 청구할 때 더한다. 한 번만: r.wage가 있으면 이미 끝낸 실행 */
function finishRun(s: VillageState, r: AgentRun, cfg: GameConfig) {
  const m = r.memberId ? s.members[r.memberId] : undefined;
  if (!m || r.wage !== undefined) return;
  const gross = salary(r.toolCalls, runQuality(r), cfg);
  const tax = Math.round(gross * cfg.economy.taxRate);
  r.wage = gross;
  m.balance += gross - tax;
  s.economy.fund += tax;
  s.economy.today.tax += tax;
  s.economy.today.wages += gross;
  const t = r.taskId ? s.tasks[r.taskId] : undefined;
  if (t) t.salaryPaid += gross;
  m.eff.recent = [...m.eff.recent, { runId: r.runId, tokens: 0, credit: runPoints(r, cfg) }].slice(
    -cfg.efficiency.window,
  );
  accrue(s, m, runPoints(r, cfg), r.endedAt ?? r.lastAt, cfg); // 일터 게이지 (06 문서 5.2) — 급여와 같은 실행 단위
}

export function applyEconomy(s: VillageState, e: DomainEvent, cfg: GameConfig): void {
  const ec = s.economy;
  // 급여 (D20): 서브에이전트 실행이 끝나면 한 번, 토큰 청구보다 먼저 (새 팀원의 첫 실행이 괜히 형편이 어려워지지 않게).
  // 끝 이벤트를 잃고 세션이 닫혀 끝난 실행(applyRuns가 같은 시각으로 닫음)도 받는다
  if (e.t === 'AgentRunEnded') {
    const r = s.runs[e.runId];
    if (r) finishRun(s, r, cfg);
  } else if (e.t === 'SessionStarted' || e.t === 'SessionEnded')
    for (const r of Object.values(s.runs)) if (r.endedAt === e.at) finishRun(s, r, cfg);
  // 토큰 비용 (D11): 서브에이전트는 끝날 때 그 실행(구간) 몫을 그 팀원이 한 번 (이어 받은 구간은 segment가 차이로 바꿔 둠), 팀장은 메인 턴 끝에 그 세션에서 새로 쓴 몫.
  // 영수증 재료(usage)가 있으면 모델 단가로 셈하고 영수증에 더한다 (D13)
  if (cfg.economy.tokens.enabled && e.t === 'AgentRunEnded' && e.tokens) {
    const r = s.runs[e.runId];
    const m = r?.memberId ? s.members[r.memberId] : undefined;
    if (r && r.tokens === undefined) {
      const rec = e.usage ? receiptOf(e.usage, cfg) : null;
      r.tokens = rec ? rec.total : tokenWeight(e.tokens, cfg);
      if (m) {
        // 외부인 몫은 아무도 안 낸다
        alertRun(s, m, r.tokens, rec?.parts ?? null, e.at, cfg);
        chargeTokens(s, m, r.runId, r.tokens, e.at, cfg);
        if (rec && e.usage) addReceipt(m, rec, e.usage.calls);
      }
    }
  }
  // 일터 층 (06 문서 5.4): 급여와 그 실행의 토큰값을 다 셈한 뒤 — 자재비를 먼저 내고 토큰값을 못 내는 일이 없게 (5.9)
  if (e.t === 'AgentRunEnded' || e.t === 'SessionStarted' || e.t === 'SessionEnded') raiseAll(s, e.at, cfg);
  if (e.t === 'MainTurnEnded' && e.usage) gauge(s, e.sessionId, e.usage, e.at, cfg);
  if (cfg.economy.tokens.enabled && e.t === 'MainTurnEnded' && e.tokens) {
    const seen = Object.hasOwn(s.mainTokens, e.sessionId);
    const before = s.mainTokens[e.sessionId] ?? { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
    const now = e.tokens;
    const d = {
      input: Math.max(0, now.input - before.input),
      output: Math.max(0, now.output - before.output),
      cacheWrite: Math.max(0, now.cacheWrite - before.cacheWrite),
      cacheRead: Math.max(0, now.cacheRead - before.cacheRead),
    };
    s.mainTokens[e.sessionId] = {
      input: Math.max(now.input, before.input),
      output: Math.max(now.output, before.output),
      cacheWrite: Math.max(now.cacheWrite, before.cacheWrite),
      cacheRead: Math.max(now.cacheRead, before.cacheRead),
    };
    const leader = s.members[LEADER_ID];
    // 영수증 재료로: 이 세션 누적이 남아 있거나 처음 보는 세션. 오래돼 치운 세션이 이어지면 tokens 차이로만 (MAIN_USAGE_KEEP)
    let w = tokenWeight(d, cfg);
    let rec: ReturnType<typeof receiptOf> | null = null;
    let calls = 0;
    if (e.usage && (Object.hasOwn(s.mainUsage, e.sessionId) || !seen)) {
      const delta = usageDelta(e.usage, s.mainUsage[e.sessionId]);
      rec = receiptOf(delta, cfg);
      w = rec.total;
      calls = delta.calls;
      remember(s, e.sessionId, e.usage);
    } else if (e.usage) {
      // 영수증 전에 청구하던 세션·치운 세션: 새로 쓴 몫 = 누적 비용 × (tokens 차이 ÷ 누적), 원인은 누적 비율대로. 다음 턴부터 정확히
      const all = receiptOf(e.usage, cfg);
      const whole = tokenWeight(now, cfg);
      const k = whole > 0 ? w / whole : 0;
      const scale = (r: Record<string, number>) => Object.fromEntries(Object.entries(r).map(([x, v]) => [x, v * k]));
      rec = { total: all.total * k, parts: scale(all.parts), models: scale(all.models) };
      w = rec.total;
      calls = Math.round(e.usage.calls * k); // 호출 수도 같은 비율로 어림
      remember(s, e.sessionId, e.usage);
    }
    if (leader && leader.movedInAt !== null && w > 0) {
      chargeLeader(s, leader, w, e.at, cfg);
      if (rec) addReceipt(leader, rec, calls);
    }
  }
  // 정산: 시계가 여러 날 건너뛰어도 하루씩 (6.2)
  // history는 여기서 끝없이 쌓인다. 수집기가 투영 뒤 최근 60일만 상태에 남기고 옛날은 따로 둔다 (server store.ts HISTORY_KEEP)
  if (e.t === 'GameDayTick') for (let d = (ec.history.at(-1)?.day ?? 0) + 1; d <= e.day; d++) settle(s, d, e.at, cfg);
}

/** 효율 순위 (D23, 06 문서 3.6): 입주한 팀원(팀장·떠난 팀원 뺌)의 최근 window개 실행 토큰 ÷ 일 점수, 적은 순.
 *  rank null = 순위 밖 (few: 실행 minTasks개 미만, noTokens: 토큰을 못 읽음). 일 점수가 0(실패·도구 없음만)이면 perPoint Infinity로 꼴찌.
 *  team = 마을 전체(팀장·외부인 포함) 지금까지 토큰 ÷ 끝난 실행(팀원·외부인)의 일 점수 합 */
export function efficiency(s: VillageState, cfg: GameConfig) {
  const rows = Object.values(s.members)
    .filter((m) => !m.isLeader && !m.departed && m.movedInAt !== null)
    .map((m) => {
      const tokens = m.eff.recent.reduce((a, x) => a + x.tokens, 0);
      const points = m.eff.recent.reduce((a, x) => a + x.credit, 0);
      const runs = m.eff.recent.length;
      const why = runs < cfg.efficiency.minTasks ? 'few' : tokens <= 0 ? 'noTokens' : null;
      return { m, runs, tokens, perPoint: points > 0 ? tokens / points : Infinity, why, rank: null as number | null };
    })
    .sort((a, b) => Number(!!a.why) - Number(!!b.why) || (a.why ? 0 : a.perPoint - b.perPoint) || a.m.slot - b.m.slot);
  rows.forEach((r, i) => (r.rank = r.why ? null : i + 1));
  const visitors = Object.values(s.runs).reduce((a, r) => a + (r.memberId ? 0 : (r.tokens ?? 0)), 0);
  const tokens = Object.values(s.members).reduce((a, m) => a + m.tokens, visitors);
  const points = Object.values(s.runs).reduce((a, r) => a + (r.endedAt === null ? 0 : runPoints(r, cfg)), 0);
  const leader = s.members[LEADER_ID]?.tokens ?? 0;
  return {
    rows,
    ranked: rows.filter((r) => r.rank !== null).length,
    team: { tokens, points, perPoint: points ? tokens / points : null, leaderShare: tokens ? leader / tokens : 0 },
  };
}

/** 하루 정산 (6.2 순서): 레벨업 → 일터 층 → 자동 구매 → 공공시설 → 기록 → today 비우기. 관리비·물가·금리 없음 (D20) */
function settle(s: VillageState, day: number, at: number, cfg: GameConfig) {
  const ec = s.economy;

  // 레벨업 (06 문서 6.1): 맨 앞 — 일터 층보다 먼저라 "Lv.N 필요"였던 일터가 같은 정산에서 오른다 (5.4·6.4)
  levelUp(s, at, cfg);
  // 일터 층 (06 문서 5.4): 자동 구매보다 먼저 — 돈이 일터로 먼저 가게
  raiseAll(s, at, cfg);
  // 자동 구매 (6.4): 팀장은 사지 않는다 (D21 — 사용자가 사 주면 기금에서), 자재비를 기다리는 팀원은 쉰다 (5.4)
  for (const m of Object.values(s.members)) m.boughtToday = 0;
  if (cfg.economy.autoBuy.enabled)
    for (const m of Object.values(s.members))
      if (!m.isLeader && !m.departed && s.houses[m.id] && !waitingMaterials(s, m.id)) autoBuy(s, m, day, at, cfg);
  // 공공시설 (06 문서 6.2·6.4): 하루 하나 — 레벨업 공사비 대기 중이면 모으고, 오늘 팀장 토큰값 청구만큼 남긴다
  buildPublicWork(s, day, at, cfg);

  const { wages, tax, purchases, tokens, leaderTokens, leaderUnpaid, leaderPurchases, materials, works } = ec.today;
  ec.history.push({
    day,
    at,
    wages,
    tax,
    purchases,
    tokens,
    leaderTokens,
    leaderUnpaid,
    leaderPurchases,
    materials,
    works,
    fund: ec.fund,
    balances: Object.fromEntries(Object.values(s.members).map((m) => [m.id, m.balance])),
  });
  ec.today = {
    wages: 0,
    tax: 0,
    purchases: 0,
    tokens: 0,
    leaderTokens: 0,
    leaderUnpaid: 0,
    leaderPurchases: 0,
    materials: 0,
    works: 0,
  };
  ec.deficit = leaderUnpaid > 0; // 시청 적자 = 오늘 또는 지난 정산 날에 못 낸 몫이 있다 → 못 낸 몫이 없는 날이 정산되면 꺼진다 (06 문서 3.3)
  for (const m of Object.values(s.members)) {
    m.tokenCostToday = 0;
    m.materialsToday = 0;
  }

  // 알림 (01 문서 9장): 급여는 받은 날만, 자동으로 사라짐
  if (wages > 0) {
    const text = `${day}일째 정산 · 급여 ${wages}${tokens ? ` · 토큰 ${tokens}` : ''}${leaderTokens ? ` · 시청 ${leaderTokens}` : ''}`;
    s.feed.push({ at, kind: 'economy', text });
    s.toasts.push({ id: nextId(s, 'toast'), at, kind: 'salary', text, sticky: false });
  }
}

/** 02 문서 6.2 태그: 가진 가구 수가 짝수면 E/I 축(E decor · I rest), 홀수면 J/P 축(J work · P seed 무작위) */
function preferredTag(m: Member, day: number, cfg: GameConfig) {
  const L = personalityLetters(m);
  if (m.furniture.length % 2 === 0) return L[0] === 'E' ? 'decor' : 'rest';
  if (L[3] === 'J') return 'work';
  const tags = [...new Set(cfg.furniture.map((f) => f.tag))];
  return tags[Math.floor(rand(cfg.economy.autoBuy.seed + day, m.slot) * tags.length)];
}

/** 6.4 자동 구매: 하루 maxPerDay개, 오늘 가격 ≤ 예산 = 잔고 − max(잔고 × keepReserveRatio, 남길 자재비 — 게이지가 찼을 때만, D33). 태그 안에서 덜 가진 것, 같으면 설정 순서 */
function autoBuy(s: VillageState, m: Member, day: number, at: number, cfg: GameConfig) {
  const { maxPerDay, keepReserveRatio } = cfg.economy.autoBuy;
  const owned = (kind: string) => m.furniture.filter((x) => x.kind === kind).length;
  const keep = materialsReserve(s, m.id, cfg); // 다음 층 게이지가 찼으면 자재비는 남긴다 (D33)
  while (m.boughtToday < maxPerDay) {
    const tag = preferredTag(m, day, cfg);
    const budget = m.balance - Math.max(m.balance * keepReserveRatio, keep);
    let pick: { f: GameConfig['furniture'][number]; price: number } | undefined;
    for (const f of cfg.furniture) {
      if ('outdoor' in f && f.outdoor) continue; // 꽃밭은 방에 못 놓아 창고로만 간다
      const price = furniturePrice(f.id, cfg) ?? Infinity;
      if (f.tag === tag && price <= budget && (!pick || owned(f.id) < owned(pick.f.id))) pick = { f, price };
    }
    if (!pick) return; // 그 태그에 살 게 없으면 모은다
    const { f, price } = pick;
    const k = owned(f.id);
    const placed = findSpot(m, f.id, cfg);
    m.furniture.push({
      id: `a${day}.${m.id}.${m.boughtToday}`, // 고정 id (D30): 그날 그 팀원의 몇 번째 자동 구매
      kind: f.id,
      fabric: f.fabric ? (cfg.fabricColors[k % cfg.fabricColors.length] ?? null) : null,
      price,
      day,
      by: 'auto',
      placed,
    });
    m.balance -= price;
    m.boughtToday++;
    s.economy.today.purchases += price;
    s.feed.push({ at, kind: 'economy', text: `${m.name} 가구 자동 구매 · ${price}`, ref: m.id });
  }
}
