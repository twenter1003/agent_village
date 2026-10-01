// 성격 (01 문서 7장): 작업 지표 → 목표 → EMA, 하루 이동 한도, 히스테리시스, 이유 문장. 순수.
import type { GameConfig } from '../config/config';
import type { DomainEvent } from '../events/normalize';
import { nextId } from '../projector/project';
import type {
  AgentRun,
  Axis,
  Member,
  Personality,
  PersonalitySample,
  RunHabits,
  Task,
  VillageState,
} from '../projector/types';
import { completedBy, shares } from './tasks';

export const AXES: Axis[] = ['EI', 'SN', 'TF', 'JP'];
/** 축마다 [앞 글자(점수 ↓), 뒤 글자(점수 ↑)] */
const LETTERS: Record<Axis, [string, string]> = { EI: ['E', 'I'], SN: ['S', 'N'], TF: ['T', 'F'], JP: ['J', 'P'] };
/** 글자 기준점: 씨앗 점수이자 drifting 퍼센트의 출발점 (7장) */
const ANCHOR = [25, 75] as const;

/** 이유 문장 (7장 표) */
const WHY = {
  parallel: '다른 팀원과 같이 일하는 때가 많아서',
  meeting: '회의에 꼬박꼬박 나와서',
  solo: '혼자 긴 작업이 많아서',
  absent: '회의에 잘 안 나와서',
  read: '파일을 꼼꼼히 읽고 찾아봐서',
  edit: '조금씩 나눠 고쳐서',
  test: '테스트를 자주 돌려서',
  write: '새 파일을 자주 만들어서',
  web: '웹 검색을 자주 해서',
  bigEdit: '한 번에 크게 고쳐서',
  thinking: '보고에 원인·오류 이야기가 늘어서',
  feeling: '보고에 칭찬·고마움 말이 늘어서',
  inOrder: '만든 순서대로 끝내서',
  noRetry: '다시 시도하는 일이 적어서',
  steady: '한 도구로 차근차근 이어 가서',
  outOfOrder: '작업 순서를 자주 바꿔서',
  retry: '실패한 도구를 자꾸 다시 시도해서',
  switch: '도구를 자주 바꿔 가며 일해서',
};
type WhyKey = keyof typeof WHY;
type Weights = Record<WhyKey, number>;
/** 축마다 [앞 글자 쪽, 뒤 글자 쪽] 세부 지표. 순서가 동점 순서 */
const SIDES: Record<Axis, [WhyKey[], WhyKey[]]> = {
  EI: [
    ['parallel', 'meeting'],
    ['solo', 'absent'],
  ],
  SN: [
    ['read', 'edit', 'test'],
    ['write', 'web', 'bigEdit'],
  ],
  TF: [['thinking'], ['feeling']],
  JP: [
    ['inOrder', 'noRetry', 'steady'],
    ['outOfOrder', 'retry', 'switch'],
  ],
};

/** 초기값: 직업 프리셋 mbtiSeed를 축마다 25(앞 글자) 또는 75(뒤 글자)로 (7장) */
export function seedPersonality(mbtiSeed: string): Personality {
  const score = (a: Axis, i: number) => (mbtiSeed[i] === LETTERS[a][1] ? ANCHOR[1] : ANCHOR[0]);
  return {
    EI: score('EI', 0),
    SN: score('SN', 1),
    TF: score('TF', 2),
    JP: score('JP', 3),
    letters: mbtiSeed,
    drifting: null,
    reason: '',
    driftToday: { EI: 0, SN: 0, TF: 0, JP: 0 },
    samples: [],
    lastMeetingAt: null,
  };
}

const mean = (xs: (number | null)[]) => {
  const d = xs.filter((x): x is number => x !== null);
  return d.length ? d.reduce((a, x) => a + x, 0) / d.length : null;
};
/** 뒤 글자 쪽 비중 0~100, 셀 것이 없으면 null */
const pct = (front: number, back: number) => (front + back > 0 ? (100 * back) / (front + back) : null);
const sum = (runs: AgentRun[], f: (r: AgentRun) => number) => runs.reduce((a, r) => a + f(r), 0);

/** [a, b] 안에서 구간들이 덮는 길이 (합집합) */
function covered(a: number, b: number, spans: [number, number][]) {
  let len = 0;
  let cur = a;
  for (const [x, y] of spans
    .map(([x, y]): [number, number] => [Math.max(a, x), Math.min(b, y)])
    .filter(([x, y]) => y > x)
    .sort((p, q) => p[0] - q[0])) {
    const from = Math.max(cur, x);
    if (y > from) [len, cur] = [len + y - from, y];
  }
  return len;
}

type Span = { from: number; ms: number; run?: AgentRun };

/** 7장 M8 표본: 작업 t에서 팀원 m의 축별 값 + 이유용 세부 지표 크기(w, 상태에 남기지 않음).
 *  spans = 5.3 기여 구간과 겹친 m의 실행 (팀장은 실행 없이 구간만) */
function sample(s: VillageState, m: Member, t: Task, to: number, spans: Span[], cfg: GameConfig) {
  const runs = spans.flatMap((x) => (x.run ? [x.run] : []));
  // E/I: 혼자 = 1 − 다른 팀원 실행과 겹친 비율, 불참 = 마을의 가장 최근 회의에 없었음
  const others = Object.values(s.runs)
    .filter((r) => r.memberId && r.memberId !== m.id)
    .map((r): [number, number] => [r.startedAt, r.endedAt ?? to]);
  const worked = spans.filter((x) => x.run);
  const mine = worked.reduce((a, x) => a + x.ms, 0);
  const together = worked.reduce((a, x) => a + covered(x.from, x.from + x.ms, others), 0);
  const solo = mine > 0 ? 1 - together / mine : null;
  const last = Math.max(...Object.values(s.members).map((x) => x.personality.lastMeetingAt ?? -Infinity));
  const absent = last === -Infinity ? null : m.personality.lastMeetingAt === last ? 0 : 1;
  // S/N: 도구 종류별 호출 수
  const k = (kind: keyof RunHabits['kinds']) => sum(runs, (r) => r.habits?.kinds[kind] ?? 0);
  const S = { read: k('read') + k('search'), edit: k('edit'), test: k('test') };
  const N = { write: k('write'), web: k('web'), bigEdit: k('bigEdit') };
  // T/F: 최종 메시지(요약본)의 낱말 수 — 대소문자 무시, 부분 문자열
  const words = (list: string[]) =>
    sum(runs, (r) => {
      const msg = (r.lastMessage ?? '').toLowerCase();
      return list.reduce((a, w) => a + (w ? msg.split(w.toLowerCase()).length - 1 : 0), 0);
    });
  const T = words(cfg.personality.lexicon.thinking);
  const F = words(cfg.personality.lexicon.feeling);
  // J/P: 순서 바뀜(창 안 앞 표본에 더 나중에 만든 작업), 재시도·전환 비율
  const order = m.personality.samples.some((x) => (s.tasks[x.taskId]?.createdAt ?? -Infinity) > t.createdAt) ? 1 : 0;
  const calls = sum(runs, (r) => r.toolCalls);
  const pairs = sum(runs, (r) => Math.max(0, r.toolCalls - 1));
  const retry = calls ? sum(runs, (r) => r.habits?.retries ?? 0) / calls : null;
  const sw = pairs ? sum(runs, (r) => r.habits?.switches ?? 0) / pairs : null;
  const x100 = (v: number | null) => (v === null ? null : 100 * v);
  const x: PersonalitySample = {
    taskId: t.id,
    at: to,
    EI: x100(mean([solo, absent])),
    SN: pct(S.read + S.edit + S.test, N.write + N.web + N.bigEdit),
    TF: pct(T, F),
    JP: x100(mean([order, retry, sw])),
  };
  const w: Weights = {
    parallel: solo === null ? 0 : 1 - solo,
    meeting: absent === 0 ? 1 : 0,
    solo: solo ?? 0,
    absent: absent ?? 0,
    ...S,
    ...N,
    thinking: T,
    feeling: F,
    inOrder: 1 - order,
    outOfOrder: order,
    noRetry: retry === null ? 0 : 1 - retry,
    retry: retry ?? 0,
    steady: sw === null ? 0 : 1 - sw,
    switch: sw ?? 0,
  };
  return { x, w };
}

/** 그 축 그 쪽(0 앞 · 1 뒤)의 이유 문장: 이번 표본에서 가장 큰 세부 지표, 동점이면 표 순서 */
function why(axis: Axis, side: 0 | 1, w: Weights) {
  const keys = SIDES[axis][side];
  return WHY[keys.reduce((best, k) => (w[k] > w[best] ? k : best), keys[0] ?? 'solo')];
}

/** 축마다 창 안 표본의 null이 아닌 값 평균 */
const targets = (xs: PersonalitySample[]) =>
  Object.fromEntries(AXES.map((a) => [a, mean(xs.map((x) => x[a]))])) as Record<Axis, number | null>;

/** 바뀌는 중: 목표가 뒤집히는 선(lo·hi)을 넘은 축 중 가장 많이 넘은 축. 퍼센트 = 기준점 → 뒤집히는 선 (7장).
 *  50~55 목표는 점수가 선 앞에서 멈춰 글자가 안 바뀌므로 뺀다 (M8 리뷰) */
function driftOf(p: Personality, target: Record<Axis, number | null>, lo: number, hi: number) {
  let out: Personality['drifting'] = null;
  let pull = 0;
  AXES.forEach((a, i) => {
    const goal = target[a];
    if (goal === null) return;
    const [front, back] = LETTERS[a];
    const isBack = p.letters[i] === back;
    const d = isBack ? lo - goal : goal - hi;
    if (d <= pull) return;
    pull = d;
    const done = isBack ? (ANCHOR[1] - p[a]) / (ANCHOR[1] - lo) : (p[a] - ANCHOR[0]) / (hi - ANCHOR[0]);
    out = { axis: a, toward: isBack ? front : back, percent: Math.min(99, Math.max(0, Math.round(100 * done))) };
  });
  return out;
}

/** 표본 → 목표 → EMA(하루 한도) → 글자(히스테리시스) → 이유·바뀌는 중 */
function learn(s: VillageState, m: Member, x: PersonalitySample, w: Weights, cfg: GameConfig) {
  const p = m.personality;
  const { window, emaAlpha, maxDriftPerDay, flipHysteresis } = cfg.personality;
  const [lo = 45, hi = 55] = flipHysteresis;
  if (window <= 0) return; // 표본을 안 남김 = 안 움직임 (slice(-0)은 전부라 끝없이 쌓였음, M8 리뷰)
  const before = targets(p.samples);
  p.samples = [...p.samples, x].slice(-window);
  const target = targets(p.samples);
  // 최종 메시지를 끈 동안은 T/F 목표 없음 — 창 안 옛 표본도 당기지 않게 (7장)
  if (!cfg.collector.keepLastMessage) target.TF = null;
  // 이유: 이번 표본이 직전 목표(없으면 점수)에서 가장 멀리 간 축, 그 방향
  let moved = 0;
  for (const a of AXES) {
    const v = x[a];
    const d = v === null ? 0 : v - (before[a] ?? p[a]);
    if (Math.abs(d) > Math.abs(moved)) [moved, p.reason] = [d, why(a, d > 0 ? 1 : 0, w)];
  }
  AXES.forEach((a, i) => {
    const goal = target[a];
    if (goal === null) return;
    const room = Math.max(0, maxDriftPerDay - p.driftToday[a]);
    const step = Math.max(-room, Math.min(room, emaAlpha * (goal - p[a])));
    p[a] += step;
    p.driftToday[a] += Math.abs(step);
    const [front, back] = LETTERS[a];
    const was = p.letters[i] ?? front;
    const now = p[a] > hi ? back : p[a] < lo ? front : was;
    if (now === was) return;
    p.letters = p.letters.slice(0, i) + now + p.letters.slice(i + 1);
    const text = `${m.name} 성격이 ${was} → ${now}${now === 'N' ? '으로' : '로'} 바뀜 · ${why(a, now === back ? 1 : 0, w)}`;
    s.feed.push({ at: x.at, kind: 'personality', text, ref: m.id });
    s.toasts.push({ id: nextId(s, 'toast'), at: x.at, kind: 'personality', text, sticky: false });
  });
  p.drifting = driftOf(p, target, lo, hi);
}

export function applyPersonality(s: VillageState, e: DomainEvent, cfg: GameConfig): void {
  // 회의 참가 (E/I 불참). applyMeeting 다음이라 이번 회의·킥오프 합류가 이미 들어 있다
  const mt = s.meeting;
  if (mt)
    for (const id of mt.participants) {
      const m = s.members[id];
      if (m) m.personality.lastMeetingAt = mt.startedAt;
    }
  // 하루 이동 한도: 틱 한 번에 한 번 (시계가 며칠을 건너뛰어도, 7장)
  if (e.t === 'GameDayTick')
    for (const m of Object.values(s.members)) m.personality.driftToday = { EI: 0, SN: 0, TF: 0, JP: 0 };
  // 이번 이벤트로 완료된 작업만: TaskUpdate completed, Agent 호출 대체 작업의 실행 끝·세션이 닫은 실행 (01 문서 5.1-5)
  for (const done of completedBy(s, e)) {
    const t = s.tasks[done];
    if (!t) continue;
    // 기여 팀원별 겹친 실행 (5.3과 같은 구간). 실행이 없으면 팀장 몫(run 없음), 외부인은 뺀다
    const byMember = new Map<string, Span[]>();
    for (const x of shares(s, t, e.at)) {
      const id = x.run ? x.run.memberId : x.key;
      if (id && Object.hasOwn(s.members, id)) byMember.set(id, [...(byMember.get(id) ?? []), x]);
    }
    for (const [id, spans] of byMember) {
      const m = s.members[id];
      if (!m || m.personality.samples.some((x) => x.taskId === t.id)) continue;
      const { x, w } = sample(s, m, t, e.at, spans, cfg);
      learn(s, m, x, w, cfg);
    }
  }
}
