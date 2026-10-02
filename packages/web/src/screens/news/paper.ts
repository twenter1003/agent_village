// 마을 신문 계산 (M18, 06 문서 9장, D27). 하루 = 이 컴퓨터 날짜(자정, 브라우저 시간대) — 묶기는 여기서만, 상태·프로젝터는 그대로.
// 순수: 상태 + 경제 기록 + 날짜 'YYYY-MM-DD' → 신문. 따로 저장하지 않는다 (원본 이벤트에서 언제든 다시 만들어진다)
import {
  runPoints,
  tips,
  weatherFrom,
  workPoints,
  type AgentRun,
  type DayRecord,
  type FeedItem,
  type GameConfig,
  type Task,
  type Tip,
  type VillageState,
  type Weather,
} from '@tycoon/core';

/** 아주 작은 일 = 도구 이만큼 이하 → 맨 아래 "단신" (06 문서 9장) */
export const BRIEF_CALLS = 2;

const pad = (n: number) => String(n).padStart(2, '0');
/** 시각 → 이 컴퓨터 날짜 'YYYY-MM-DD' */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** 주소의 날짜가 있는 날인가 ('2026-02-30'·'nope' → 아님) */
export const isDayKey = (x: string) => dayKey(new Date(`${x}T00:00`).getTime()) === x;

const endedOn = (s: VillageState, date: string) =>
  Object.values(s.runs).filter(
    (r): r is AgentRun & { endedAt: number } => r.endedAt !== null && dayKey(r.endedAt) === date,
  );
const doneAt = (x: Task) => (x.status === 'completed' ? x.completedAt : undefined);

/** 달력 점: 날짜 → 그날 끝난 실행의 일 점수 합 (진하기). 끝난 실행이나 끝낸 작업이 있는 날만 (실패만 한 날은 0) */
export function workDays(s: VillageState, cfg: GameConfig): Map<string, number> {
  const days = new Map<string, number>();
  for (const r of Object.values(s.runs))
    if (r.endedAt !== null) days.set(dayKey(r.endedAt), (days.get(dayKey(r.endedAt)) ?? 0) + runPoints(r, cfg));
  for (const x of Object.values(s.tasks)) {
    const at = doneAt(x);
    if (at !== undefined) days.set(dayKey(at), days.get(dayKey(at)) ?? 0);
  }
  return days;
}

export interface Story {
  task: Task;
  points: number;
  /** 기여(ms)가 가장 큰 팀원 id 또는 외부인 종류. 기여 기록이 없으면 null */
  who: string | null;
  /** 걸린 시간 startedAt → completedAt. 시작을 모르면 null */
  ms: number | null;
}

export interface Paper {
  front: Story | null;
  subs: Story[];
  briefs: Story[];
  side: {
    done: number;
    /** 번 진주 = 그날 끝난 실행의 급여(세전) 합 */
    earned: number;
    /** 쓴 토큰값(진주) = 그날 끝난 실행 토큰 ÷ perPearl(실행마다 반올림, 청구와 같게) + 그날 기록의 팀장 토큰값 */
    spent: number;
    /** 기금 흑자(+)/적자(−) = 그날 기록의 세금 − 팀장 토큰값 − 팀장 가구 − 공사. 기록이 없으면 null */
    fund: number | null;
    /** 레벨업(ref `@level:`)·일터 층 완공 활동 기록 */
    growth: FeedItem[];
    /** 그날 실행으로 일 1점당 토큰이 가장 적은 팀원 (3.6, 그날 표본이라 최소 실행 수는 보지 않는다) */
    best: { id: string; perPoint: number } | null;
    weather: Weather;
    /** 그날 토큰을 가장 많이 쓴 팀원의 처방 팁 첫 줄 (D13) */
    tip: { id: string; tip: Tip } | null;
  };
}

/** 일터 층 완공 (core workplace accrue·raise): ref = 일터 id `w<n>:<팀원>`, 글자 "… 완공" (자재비 대기·부지는 빼려고 글자 끝을 본다) */
const isFloor = (f: FeedItem) => f.kind === 'task' && /^w\d+:/.test(f.ref ?? '') && f.text.endsWith('완공');

function story(x: Task, cfg: GameConfig): Story {
  const top = Object.entries(x.contributions).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  return {
    task: x,
    points: workPoints(x, cfg),
    who: top?.[0] ?? null,
    ms: x.startedAt !== undefined && x.completedAt !== undefined ? x.completedAt - x.startedAt : null,
  };
}

/** 그날 신문. history = 경제 기록 전부 (SSE 상태는 최근 것만이라 화면이 GET /economy?range=all로 더 받는다) */
export function paper(s: VillageState, cfg: GameConfig, history: DayRecord[], date: string): Paper {
  const stories = Object.values(s.tasks)
    .filter((x) => {
      const at = doneAt(x);
      return at !== undefined && dayKey(at) === date;
    })
    .map((x) => story(x, cfg))
    .sort(
      (a, b) =>
        b.points - a.points ||
        (a.task.completedAt ?? 0) - (b.task.completedAt ?? 0) ||
        (a.task.id < b.task.id ? -1 : 1),
    );
  const [front = null, ...rest] = stories;

  const runs = endedOn(s, date);
  const perPearl = cfg.economy.tokens.perPearl;
  // 오늘(마지막 이벤트 날) 아직 정산 안 된 몫도 그날 기록으로
  const recs: Pick<DayRecord, 'tax' | 'leaderTokens' | 'leaderPurchases' | 'works'>[] = history.filter(
    (r) => dayKey(r.at) === date,
  );
  if (dayKey(s.clock.now) === date) recs.push(s.economy.today);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  // 팀원별 그날 토큰·일 점수 (외부인·팀장 실행 없음)
  const by = new Map<string, { tokens: number; points: number }>();
  for (const r of runs) {
    const m = r.memberId ? s.members[r.memberId] : undefined;
    if (!m || m.isLeader) continue;
    const row = by.get(m.id) ?? { tokens: 0, points: 0 };
    by.set(m.id, { tokens: row.tokens + (r.tokens ?? 0), points: row.points + runPoints(r, cfg) });
  }
  const slot = (id: string) => s.members[id]?.slot ?? 0;
  const best =
    [...by]
      .filter(([, v]) => v.tokens > 0 && v.points > 0)
      .map(([id, v]) => ({ id, perPoint: v.tokens / v.points }))
      .sort((a, b) => a.perPoint - b.perPoint || slot(a.id) - slot(b.id))[0] ?? null;
  const spender = [...by]
    .filter(([, v]) => v.tokens > 0)
    .sort((a, b) => b[1].tokens - a[1].tokens || slot(a[0]) - slot(b[0]))[0];
  const m = spender && s.members[spender[0]];
  const tip = m ? tips(s, m)[0] : undefined;

  return {
    front,
    subs: rest.filter((x) => x.task.toolCalls > BRIEF_CALLS),
    briefs: rest.filter((x) => x.task.toolCalls <= BRIEF_CALLS),
    side: {
      done: stories.length,
      earned: sum(runs.map((r) => r.wage ?? 0)),
      spent: sum(runs.map((r) => Math.round((r.tokens ?? 0) / perPearl))) + sum(recs.map((r) => r.leaderTokens)),
      fund: recs.length
        ? sum(recs.map((r) => r.tax - r.leaderTokens - (r.leaderPurchases ?? 0) - (r.works ?? 0))) // 옛 기록엔 없을 수 있다
        : null,
      growth: s.feed.filter((f) => dayKey(f.at) === date && (f.ref?.startsWith('@level:') || isFloor(f))),
      best,
      weather: weatherFrom(runs, 0, runs.length > 0, cfg),
      tip: m && tip ? { id: m.id, tip } : null,
    },
  };
}
