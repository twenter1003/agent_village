// 경제 규칙 (01 문서 6장) + M7 완료 기준: seed 고정 30일 시뮬레이션 (02 문서 10장)
import { describe, expect, test } from 'vitest';
import { defaultConfig as cfg, makeConfig, type GameConfig } from '../config/config';
import type { DomainEvent } from '../events/normalize';
import { initialState, project, replay } from '../projector/project';
import { LEADER_ID, type VillageState } from '../projector/types';
import type { Tokens, Usage } from '../events/normalize';
import { efficiency, furniturePrice, personalityLetters, receiptOf, salary, tips, tokenWeight } from './economy';
import { moveInAll } from './growth';

const T0 = Date.parse('2026-09-30T00:00:00.000Z');
const DAY = cfg.time.gameDayMs;
const at = (sec: number) => T0 + sec * 1000;
const JOBS: Record<string, string> = { 'backend-dev': 'backend', 'frontend-dev': 'frontend', 'qa-reviewer': 'qa' };
const NAMES = Object.keys(JOBS);
const roster: DomainEvent = {
  t: 'RosterLoaded',
  at: T0,
  agents: NAMES.map((name) => ({ name, description: '' })),
  tycoon: { members: Object.fromEntries(NAMES.map((n) => [n, { job: JOBS[n] }])) },
};
const tick = (day: number): DomainEvent => ({ t: 'GameDayTick', at: T0 + day * DAY, day });
/** roster 뒤에는 모두 입주한 마을로 (집. 입주는 처음 일할 때지만 여기서는 경제 규칙만 본다, 01 문서 3.3) */
const play = (events: DomainEvent[], c: GameConfig = cfg, s: VillageState = initialState('p', c)) =>
  events.reduce((x, e) => {
    const y = project(x, e, c);
    return e.t === 'RosterLoaded' ? moveInAll(y, e.at, c) : y;
  }, s);

/** 옛 입주 지원금 대신: 팀원 잔고·기금 300 (D20에서 지원금이 없어져 청구를 보려면 돈이 있어야 한다) */
const funded = (c: GameConfig = cfg) => {
  const s = play([roster], c);
  for (const m of Object.values(s.members)) if (!m.isLeader) m.balance = 300;
  s.economy.fund = 300;
  return s;
};

/** 작업 하나: 만들기 → 진행 → (실행들) → 완료. runs = [팀원·외부인 이름, 시작 초, 끝 초, 도구 수, 테스트 성공] */
function task(id: string, sec: number, runs: [string, number, number, number, boolean][] = []): DomainEvent[] {
  const ev: DomainEvent[] = [
    { t: 'TaskCreated', at: at(sec), taskId: id, subject: `작업 ${id}` },
    { t: 'TaskStatusChanged', at: at(sec + 1), taskId: id, status: 'in_progress' },
  ];
  runs.forEach(([who, from, to, tools, passed], i) => {
    const runId = `${id}-r${i}`;
    ev.push({ t: 'AgentRunStarted', at: at(from), runId, agentType: who });
    for (let k = 0; k < tools; k++) {
      const isTest = passed && k === tools - 1;
      ev.push({ t: 'ToolUsed', at: at(from + 1), runId, tool: 'Bash', phase: 'post', ok: true, kind: 'shell', isTest });
    }
    ev.push({ t: 'AgentRunEnded', at: at(to), runId, ok: true });
  });
  const end = Math.max(sec + 2, ...runs.map((r) => r[2]));
  ev.push({ t: 'TaskStatusChanged', at: at(end), taskId: id, status: 'completed' });
  return ev;
}

describe('6.1 급여 = 일의 양 (D20, 06 문서 3.4)', () => {
  test('급여 = wagePerCall × 도구 수 × 품질, 반올림', () => {
    expect(salary(15, 'noTests', cfg)).toBe(390);
    expect(salary(15, 'testsPassed', cfg)).toBe(468);
    expect(salary(15, 'failed', cfg)).toBe(0);
    expect(salary(0, 'noTests', cfg)).toBe(0);
  });
  test('쪼개도 합이 같다: 도구 20번 1건 = 도구 2번 10건', () => {
    const one = salary(20, 'noTests', cfg);
    const ten = Array.from({ length: 10 }, () => salary(2, 'noTests', cfg)).reduce((a, x) => a + x, 0);
    expect(ten).toBe(one);
  });
  test('가구 값은 고정 basePrice', () => {
    expect(furniturePrice('bed', cfg)).toBe(520);
    expect(furniturePrice('없는가구', cfg)).toBeNull();
  });
});

describe('급여는 서브에이전트 실행마다 (D20, 06 문서 3.4)', () => {
  /** 작업 없는 실행 하나: 도구 tools번 + 테스트 명령(결과들), ok = 실행 결과 */
  const run = (
    id: string,
    who: string,
    sec: number,
    tools: number,
    ok = true,
    tests: boolean[] = [],
  ): DomainEvent[] => [
    { t: 'AgentRunStarted', at: at(sec), runId: id, agentType: who },
    ...Array.from({ length: tools }, (): DomainEvent => ({
      t: 'ToolUsed',
      at: at(sec + 1),
      runId: id,
      tool: 'Read',
      phase: 'post',
      ok: true,
      kind: 'read',
      isTest: false,
    })),
    ...tests.map((pass): DomainEvent => ({
      t: 'ToolUsed',
      at: at(sec + 1),
      runId: id,
      tool: 'Bash',
      phase: 'post',
      ok: pass,
      kind: 'shell',
      isTest: true,
    })),
    { t: 'AgentRunEnded', at: at(sec + 2), runId: id, ok },
  ];

  test('실행이 끝나면 그 팀원에게, 세금 20%는 기금, 외부인 실행은 급여 없음, 입주 지원금 없음', () => {
    const s = play([
      roster,
      ...task('t1', 10, [
        ['backend-dev', 11, 21, 15, false],
        ['Explore', 11, 21, 3, false],
      ]),
    ]);
    // 도구 15번 → 390, 세금 78. 외부인 도구 3번은 아무도 안 받는다
    expect(s.members['backend-dev']?.balance).toBe(312);
    expect(s.economy).toMatchObject({ fund: 78, today: { wages: 390, tax: 78 } });
    expect([s.runs['t1-r0']?.wage, s.runs['t1-r1']?.wage]).toEqual([390, undefined]);
    expect(s.members['frontend-dev']?.balance).toBe(0);
  });
  test('품질은 실행마다: 테스트 통과만 있으면 1.2, 테스트가 하나라도 실패하면 1, 실행이 실패로 끝나면 0', () => {
    const s = play([
      roster,
      ...run('p', 'backend-dev', 10, 9, true, [true]),
      ...run('f', 'backend-dev', 20, 8, true, [false, true]),
      ...run('x', 'backend-dev', 30, 10, false),
    ]);
    // 도구 10번씩 (테스트 명령도 도구 호출): 26 × 10 × 1.2, × 1, × 0
    expect(['p', 'f', 'x'].map((id) => s.runs[id]?.wage)).toEqual([312, 260, 0]);
  });
  test('같은 실행 끝이 두 번 와도 급여는 한 번', () => {
    const s = play([
      roster,
      ...run('a', 'backend-dev', 10, 5),
      { t: 'AgentRunEnded', at: at(20), runId: 'a', ok: true },
    ]);
    expect(s.members['backend-dev']?.balance).toBe(104); // 130 − 세금 26
    expect(s.economy.today.wages).toBe(130);
  });
  test('작업과 짝지어지지 않은 실행(워크플로·백그라운드)도 받는다. Agent 호출과 짝지어진 작업엔 salaryPaid로 적어 둔다', () => {
    const s = play([roster, ...run('w', 'backend-dev', 10, 20)]);
    expect(s.members['backend-dev']?.balance).toBe(416); // 520 − 104
    const t = play(
      [
        { t: 'AgentCalled', at: at(30), callId: 'c1', subagentType: 'qa-reviewer', subject: '검토' },
        ...run('q', 'qa-reviewer', 31, 5),
      ],
      cfg,
      s,
    );
    expect(t.runs.q?.taskId).toBe('agent:c1');
    expect(t.tasks['agent:c1']).toMatchObject({ status: 'completed', salaryPaid: 130 });
  });
  test('세션이 닫혀 끝난 실행(SubagentStop 유실)도 한 번 받는다', () => {
    const open = run('lost', 'backend-dev', 10, 5).slice(0, -1); // 끝 이벤트 없음
    const s = play([roster, ...open, { t: 'SessionEnded', at: at(40), sessionId: 's' }]);
    expect(s.runs.lost?.wage).toBe(130);
    const again = play([{ t: 'SessionStarted', at: at(50), project: 'p', sessionId: 's2' }], cfg, s);
    expect(again.members['backend-dev']?.balance).toBe(104);
  });
  test('완공 보너스는 없다 (작업 건수로 주는 돈)', () => {
    const ev = ['a', 'b', 'c'].flatMap((id, i) =>
      task(id, 10 + i * 30, [['qa-reviewer', 11 + i * 30, 20 + i * 30, 1, false]]),
    );
    const s = play([roster, ...ev, tick(1)]);
    expect(s.members['qa-reviewer']?.balance).toBe(63); // 26 × 3 = 78 − 세금 (5 + 5 + 5)
  });
});

describe('팀장 = 시장 (D21, 06 문서 4장)', () => {
  const usage = (cacheRead: number): Usage => ({
    calls: 1,
    first: 0,
    last: cacheRead,
    models: { 'claude-opus-5-5': { input: 0, output: 0, cacheWrite: 0, cacheRead } },
    parts: { base: { input: 0, output: 0, cacheWrite: 0, cacheRead } },
  });
  const turn = (sec: number, cacheRead: number): DomainEvent => ({
    t: 'MainTurnEnded',
    at: at(sec),
    sessionId: 's1',
    tokens: { input: 0, output: 0, cacheWrite: 0, cacheRead },
    usage: usage(cacheRead),
  });
  test('팀장 토큰값은 기금에서, 팀장 잔고는 늘 0이고 형편이 어려움이 없다', () => {
    const work = task('t1', 10, [['backend-dev', 11, 21, 50, false]]); // 1,300 → 세금 260
    // Opus 5.5 캐시 읽기 0.05 × 1,000,000 = 비용 50,000 → 진주 50
    const s = play([roster, ...work, turn(40, 1_000_000)]);
    expect(s.economy.fund).toBe(210);
    expect(s.members[LEADER_ID]?.balance).toBe(0);
    expect(s.members[LEADER_ID]?.hardship).toBe(false);
    expect(s.economy.deficit).toBe(false);
    expect(s.economy.today).toMatchObject({ leaderTokens: 50, leaderUnpaid: 0 });
  });
  const deficitLines = (s: VillageState) => s.feed.filter((f) => f.text.includes('시청 적자')).length;
  test('기금이 모자라면 가진 만큼 내고 0에서 멈춤 + 시청 적자 (들어갈 때 활동 기록 한 줄), 못 낸 몫은 기록', () => {
    const s1 = play([roster, turn(40, 1_000_000)]);
    expect(s1.economy.fund).toBe(0);
    expect(s1.economy.deficit).toBe(true);
    expect(s1.economy.today).toMatchObject({ leaderTokens: 0, leaderUnpaid: 50 });
    expect(deficitLines(s1)).toBe(1);
    // 0진주 청구(비용 450 → 반올림 0)는 아무것도 바꾸지 않는다
    expect(play([turn(45, 1_009_000)], cfg, s1).economy.deficit).toBe(true);
    const s2 = play([turn(50, 2_000_000)], cfg, s1);
    expect(deficitLines(s2)).toBe(1); // 이미 적자면 또 안 씀
    expect(s2.economy.today.leaderUnpaid).toBe(100);
  });
  test('시청 적자는 붙어 있다 (06 문서 3.3): 같은 날 다 낸 청구가 와도 그대로, 정산 뒤에도 그대로, 못 낸 몫이 없는 날이 지나야 꺼진다', () => {
    const s1 = play([roster, turn(40, 1_000_000)]); // 못 낸 50
    // 세금 520이 생긴 뒤 새로 쓴 100만(진주 50)을 다 냄 → 그래도 오늘 못 낸 몫이 있어 적자
    const s2 = play([...task('t9', 60, [['backend-dev', 61, 70, 100, false]]), turn(80, 2_000_000)], cfg, s1);
    expect(s2.economy.today).toMatchObject({ leaderTokens: 50, leaderUnpaid: 50 });
    expect(s2.economy.fund).toBe(470);
    expect(s2.economy.deficit).toBe(true);
    // 그날을 정산해도 (기록에 못 낸 몫이 있다) 다음 날까지 그대로 — 아무것도 청구하지 않아도
    const s3 = play([tick(1)], cfg, s2);
    expect(s3.economy.history.at(-1)?.leaderUnpaid).toBe(50);
    expect(s3.economy.today.leaderUnpaid).toBe(0);
    expect(s3.economy.deficit).toBe(true);
    // 못 낸 몫이 없는 날이 정산되면 꺼진다
    const s4 = play([tick(2)], cfg, s3);
    expect(s4.economy.history.at(-1)).toMatchObject({ day: 2, leaderUnpaid: 0 });
    expect(s4.economy.deficit).toBe(false);
    expect(deficitLines(s4)).toBe(1); // 꺼질 때는 기록을 안 남긴다
    // 여러 날을 한꺼번에 건너뛰어도 못 낸 몫이 없는 날이 끼면 꺼진다
    expect(play([tick(3)], cfg, s3).economy.deficit).toBe(false);
  });
  test('시청 적자에 들어갈 때마다 활동 기록 한 줄 (켜져 있는 동안 또 못 내도 안 씀, 꺼진 뒤 다시 들어가면 씀)', () => {
    const s1 = play([roster, turn(40, 1_000_000)]);
    expect(deficitLines(s1)).toBe(1);
    const off = play([tick(1), tick(2)], cfg, s1); // 못 낸 몫 있는 날 → 없는 날
    expect(off.economy.deficit).toBe(false);
    off.economy.fund = 0;
    const later = { ...turn(90, 2_000_000), at: T0 + 2 * DAY + 1000 };
    const again = play([later], cfg, off);
    expect(again.economy.today.leaderUnpaid).toBe(50);
    expect(again.economy.deficit).toBe(true);
    expect(deficitLines(again)).toBe(2);
  });
  test('팀장은 가구를 자동으로 사지 않는다. 사용자가 사 주면 기금에서', () => {
    const rich = play([roster, ...task('t1', 10, [['backend-dev', 11, 21, 400, false]])]); // 세금 2,080
    const l = rich.members[LEADER_ID];
    if (l) l.balance = 100_000; // 팀장 잔고가 있어도 (늘 0이지만) 자동 구매 대상이 아니다
    const after = play([tick(1)], cfg, rich);
    expect(after.members[LEADER_ID]?.furniture.length).toBe(0);
    expect(after.members['backend-dev']?.furniture.length).toBe(1); // 팀원은 산다
    const bought = play(
      [{ t: 'FurniturePurchased', at: at(9000), memberId: LEADER_ID, kind: 'plant', fabric: null }],
      cfg,
      after,
    );
    expect(bought.members[LEADER_ID]?.furniture.length).toBe(1);
    expect(bought.economy.fund).toBe(after.economy.fund - 80);
    // 기금 지출로 따로 적는다: 팀원 가구 지출(purchases)은 그대로, 정산 때 기록으로 옮기고 비운다
    expect(bought.economy.today).toMatchObject({ purchases: after.economy.today.purchases, leaderPurchases: 80 });
    const settled = play([tick(2)], cfg, bought);
    expect(settled.economy.history.at(-1)).toMatchObject({ day: 2, leaderPurchases: 80 });
    expect(settled.economy.today.leaderPurchases).toBe(0);
  });
});

describe('6.2 하루 정산 (D20: 관리비·물가·금리 없음)', () => {
  test('시간만 지나서 빠지는 돈이 없다', () => {
    const s0 = play([roster, ...task('t1', 10, [['backend-dev', 11, 21, 10, false]])]);
    const before = s0.members['backend-dev']?.balance ?? 0;
    const s = play(
      [tick(1), tick(2), tick(3)],
      makeConfig({ overrides: { economy: { autoBuy: { enabled: false } } } }),
      s0,
    );
    expect(s.members['backend-dev']?.balance).toBe(before);
    expect(s.members['backend-dev']?.hardship).toBe(false);
  });
  test('시계가 건너뛰면 날마다 기록, 급여는 첫 날 몫. 같은 날 틱은 무시. 기록에 팀장 토큰값·기금', () => {
    const s = play([roster, ...task('t1', 10, [['backend-dev', 11, 21, 10, false]]), tick(3), tick(3)]);
    expect(s.economy.history.map((r) => r.day)).toEqual([1, 2, 3]);
    expect(s.economy.history[0]?.wages).toBe(260);
    expect(s.economy.history[1]?.wages).toBe(0);
    expect(s.economy.history[0]).toMatchObject({
      leaderTokens: 0,
      leaderUnpaid: 0,
      leaderPurchases: 0,
      fund: s.economy.fund,
    });
    expect(s.economy.history[0]).not.toHaveProperty('priceIndex');
  });
  test('옛 설정의 물가·금리 키(overrides.economy.priceIndex·centralBank)는 무시한다', () => {
    const legacy = makeConfig({ overrides: { economy: { priceIndex: { start: 120 }, centralBank: { start: 3 } } } });
    const ev = [roster, ...task('t1', 10, [['backend-dev', 11, 21, 10, false]]), tick(1)];
    const s = play(ev, legacy);
    expect(s.economy).not.toHaveProperty('priceIndex');
    expect(s.economy.history[0]?.wages).toBe(260);
    expect(JSON.stringify(s)).toBe(JSON.stringify(play(ev)));
  });
});

describe('진주가 새지 않는다 (D20 규칙 1·3)', () => {
  test('잔고 + 기금 + 레벨업·공공시설 + 가구 + 낸 토큰(팀원·팀장) = 팀원이 받은 급여 (입주 지원금 없음, 팀장이 못 낸 몫은 돈이 아님) · 자재비', () => {
    const tk = (input: number) => ({ input, output: 0, cacheWrite: 0, cacheRead: 0 });
    const ev: DomainEvent[] = [
      roster,
      ...task('a', 10, [['backend-dev', 11, 30, 30, true]]),
      ...task('b', 40, [
        ['frontend-dev', 41, 60, 12, false],
        ['qa-reviewer', 41, 60, 6, true],
      ]),
      { t: 'AgentRunStarted', at: at(70), runId: 'tk', agentType: 'frontend-dev' },
      { t: 'AgentRunEnded', at: at(71), runId: 'tk', ok: true, tokens: tk(150_000) }, // 팀원 토큰 150
      { t: 'MainTurnEnded', at: at(80), sessionId: 's', tokens: tk(2_000_000) }, // 팀장 2,000 > 기금
      { t: 'FurniturePurchased', at: at(85), memberId: LEADER_ID, kind: 'plant', fabric: null }, // 기금이 비어 paid 0 (06 문서 3.5)
      { t: 'FurniturePurchased', at: at(86), memberId: 'backend-dev', kind: 'plant', fabric: null }, // 팀원 잔고에서 (자동 구매는 다음 층 자재비를 남겨 안 돈다, 6.4)
      tick(1),
      tick(2),
    ];
    const s = play(ev);
    const wages = Object.values(s.runs).reduce((a, r) => a + (r.wage ?? 0), 0);
    const balances = Object.values(s.members).reduce((a, m) => a + m.balance, 0);
    const owned = Object.values(s.members).flatMap((m) => m.furniture);
    const furniture = owned.reduce((a, f) => a + (f.paid ?? f.price), 0); // 모자라게 낸 가구는 낸 만큼
    expect(owned.some((f) => f.paid !== undefined)).toBe(true);
    const days = [...s.economy.history, s.economy.today];
    const sum = (k: keyof typeof s.economy.today) => days.reduce((a, r) => a + r[k], 0);
    expect([sum('tokens'), sum('leaderTokens') > 0, sum('leaderUnpaid') > 0, furniture > 0]).toEqual([
      150,
      true,
      true,
      true,
    ]);
    const materials = Object.values(s.buildings).reduce((a, b) => a + b.paid, 0);
    expect(balances + s.economy.fund + furniture + sum('tokens') + sum('leaderTokens') + materials + sum('works')).toBe(
      wages,
    );
    // 하루 기록: 팀원 잔고 = 급여 − 세금 − 팀원 가구 − 토큰 − 자재비 (팀장 가구·토큰은 기금 쪽)
    expect(sum('materials')).toBe(materials);
    expect(sum('wages') - sum('tax') - sum('purchases') - sum('tokens') - sum('materials')).toBe(balances);
  });
  test('같은 이벤트를 두 번 재생하면 같은 상태', () => {
    const ev = [roster, ...task('a', 10, [['backend-dev', 11, 30, 30, true]]), tick(1)];
    expect(JSON.stringify(replay('p', ev, cfg))).toBe(JSON.stringify(replay('p', ev, cfg)));
  });
});

describe('6.4 자동 구매', () => {
  test('성격 글자 = personality.letters (씨앗은 직업 mbtiSeed), 자동 구매가 바뀐 글자를 따른다 (M8)', () => {
    const s0 = play([roster]);
    expect(Object.values(s0.members).map((m) => personalityLetters(m))).toEqual(['ENTJ', 'ISTJ', 'ENFP', 'ISTP']);
    for (const m of Object.values(s0.members)) m.balance = m.id === 'backend-dev' ? 100000 : 0;
    const bd = s0.members['backend-dev'];
    if (bd) bd.personality.letters = 'ESTJ'; // I → E: 첫 가구(짝수 차례)가 쉬기 대신 꾸미기
    const s = play([tick(1)], cfg, s0);
    const kind = s.members['backend-dev']?.furniture[0]?.kind;
    expect(cfg.furniture.find((f) => f.id === kind)?.tag).toBe('decor');
  });

  test('I·J 번갈아(쉬기 → 일하기), 태그 안에서 덜 가진 것, 두 번째 같은 가구는 다른 색', () => {
    const s0 = play([roster]);
    for (const m of Object.values(s0.members)) m.balance = m.id === 'backend-dev' ? 100000 : 0;
    const s = play([1, 2, 3, 4, 5, 6, 7].map(tick), cfg, s0);
    const f = s.members['backend-dev']?.furniture ?? [];
    expect(f.map((x) => x.kind)).toEqual(['armchair', 'desk', 'lamp', 'bookcase', 'bed', 'desk', 'armchair']);
    expect(f.filter((x) => x.kind === 'armchair').map((x) => x.fabric)).toEqual(['mustard', 'coral']);
    expect(f.find((x) => x.kind === 'desk')?.fabric).toBeNull();
    expect(f.every((x, i) => x.by === 'auto' && x.day === i + 1)).toBe(true);
    expect(new Set(f.map((x) => x.id)).size).toBe(7);
  });

  test('잔고의 keepReserveRatio는 남긴다, 살 게 없으면 모은다', () => {
    const s0 = play([roster]);
    for (const m of Object.values(s0.members)) if (!m.isLeader) m.balance = 159; // 예산 79.5: 화분(80)도 못 삼
    const s = play([tick(1)], cfg, s0);
    expect(Object.values(s.members).every((m) => m.furniture.length === 0)).toBe(true);
    expect(s.members['frontend-dev']?.balance).toBe(159);
    for (const m of Object.values(s.members)) if (!m.isLeader) m.balance = 160; // 예산 80: E는 화분
    const s2 = play([tick(2)], cfg, s);
    expect(s2.members['frontend-dev']?.furniture.map((x) => x.kind)).toEqual(['plant']); // ENFP는 E
    expect(s2.members['frontend-dev']?.balance).toBe(80);
    expect(s2.members['backend-dev']?.furniture).toEqual([]); // ISTJ는 쉬기 가구 — 80으론 없음
    expect(s2.members[LEADER_ID]?.furniture).toEqual([]); // 팀장(ENTJ)은 자동으로 사지 않는다 (D21)
    expect(s2.economy.history[1]?.purchases).toBe(80);
  });
});

describe('토큰 비용 (D11, 01 문서 6.2)', () => {
  const tk = (input: number, output = 0, cacheWrite = 0, cacheRead = 0) => ({ input, output, cacheWrite, cacheRead });
  const start = (sec: number, runId: string, agentType: string): DomainEvent => ({
    t: 'AgentRunStarted',
    at: at(sec),
    runId,
    agentType,
  });
  const end = (sec: number, runId: string, tokens?: ReturnType<typeof tk>): DomainEvent => ({
    t: 'AgentRunEnded',
    at: at(sec),
    runId,
    ok: true,
    ...(tokens ? { tokens } : {}),
  });

  test('서브에이전트: 끝날 때 비용 환산 ÷ 1,000 반올림을 그 팀원이 한 번, 외부인 몫은 아무도', () => {
    // 비용 환산 = 1000 + 20000×5 + 40000×1.25 + 1,000,000×0.1 = 251,000 → 진주 251
    const s = play([start(1, 'a1', 'backend-dev'), end(9, 'a1', tk(1000, 20000, 40000, 1_000_000))], cfg, funded());
    const bd = s.members['backend-dev'];
    expect(bd).toMatchObject({ balance: 300 - 251, tokens: 251_000, tokenCostToday: 251 });
    expect(s.runs.a1?.tokens).toBe(251_000);
    expect(s.economy.today.tokens).toBe(251);
    // 같은 끝이 또 와도(중복 전달) 다시 내지 않는다
    expect(play([end(10, 'a1', tk(1000, 20000, 40000, 1_000_000))], cfg, s).members['backend-dev']?.balance).toBe(49);
    // 외부인(Explore)은 집·잔고가 없어 아무도 안 낸다
    const v = play([start(11, 'x1', 'Explore'), end(12, 'x1', tk(0, 0, 0, 5_000_000))], cfg, s);
    expect(Object.values(v.members).reduce((n, m) => n + m.balance, 0)).toBe(
      Object.values(s.members).reduce((n, m) => n + m.balance, 0),
    );
    expect(v.economy.fund).toBe(s.economy.fund);
  });

  test('팀장: 메인 턴 끝마다 그 세션 누적에서 새로 쓴 몫만 (같은 누적이 또 오면 0)', () => {
    const turnEnd = (sec: number, tokens: ReturnType<typeof tk>, sessionId = 's'): DomainEvent => ({
      t: 'MainTurnEnded',
      at: at(sec),
      sessionId,
      tokens,
    });
    const s = play([turnEnd(10, tk(0, 10_000)), turnEnd(20, tk(0, 30_000)), turnEnd(30, tk(0, 30_000))], cfg, funded());
    // 50 + 100 = 150 (50,000 → 50, 다음은 차이 100,000 → 100, 마지막 차이 0). 기금에서 낸다 (D21)
    expect(s.economy.today.leaderTokens).toBe(150);
    expect(s.economy.fund).toBe(300 - 150);
    expect(s.members[LEADER_ID]).toMatchObject({ balance: 0, tokens: 150_000 });
    expect(s.mainTokens.s).toEqual(tk(0, 30_000));
    // 다른 세션은 따로 센다
    expect(play([turnEnd(40, tk(0, 20_000), 's2')], cfg, s).economy.today.leaderTokens).toBe(250);
  });

  test('모자라면 가진 만큼 내고 0에서 멈춤 + 형편이 어려움, 다 내면 풀림, 정산 기록·알림에 토큰, 오늘 몫은 비움, 끌 수 있다', () => {
    const s = play([start(1, 'a1', 'backend-dev'), end(2, 'a1', tk(0, 1_000_000)), tick(1)], cfg, funded());
    const bd = s.members['backend-dev'];
    expect(bd).toMatchObject({ balance: 0, hardship: true, tokenCostToday: 0 }); // 5,000 청구, 300 냄 → 0 (정산 뒤 오늘 몫은 0)
    expect(s.economy.history[0]?.tokens).toBe(300);
    expect(s.feed.map((f) => f.text)).toContain('backend-dev 형편이 어려움 · 토큰 비용을 다 못 냈어요');
    // 관리비가 없어져 풀어 주는 곳은 토큰 비용뿐. 진주 반올림 경계: 비용 499 → 0 (청구 없음, 형편은 그대로), 500 → 1 (다 내서 풀림)
    const b = s.members['backend-dev'];
    if (b) b.balance = 100;
    const zero = play([start(3, 'a2', 'backend-dev'), end(4, 'a2', tk(499))], cfg, s);
    expect(zero.members['backend-dev']).toMatchObject({ balance: 100, hardship: true, tokens: 5_000_499 });
    const one = play([start(5, 'a3', 'backend-dev'), end(6, 'a3', tk(500))], cfg, zero);
    expect(one.members['backend-dev']).toMatchObject({ balance: 99, hardship: false });
    const off = makeConfig({ overrides: { economy: { tokens: { enabled: false } } } });
    const t = play([start(1, 'a1', 'backend-dev'), end(2, 'a1', tk(0, 1_000_000))], off, funded(off));
    expect(t.members['backend-dev']?.balance).toBe(300);
  });
});

describe('효율 순위 = 일 점수 1점당 토큰 (D23, 06 문서 3.6)', () => {
  /** 작업 하나를 who가 한 번에: 토큰 weight(입력만 = 비용 환산 그대로), ok=false면 실패 작업 */
  const work = (id: string, sec: number, who: string, weight: number, ok = true): DomainEvent[] => [
    { t: 'TaskCreated', at: at(sec), taskId: id, subject: id },
    { t: 'TaskStatusChanged', at: at(sec + 1), taskId: id, status: 'in_progress' },
    { t: 'AgentRunStarted', at: at(sec + 1), runId: `${id}-r`, agentType: who },
    {
      t: 'ToolUsed',
      at: at(sec + 2),
      runId: `${id}-r`,
      tool: 'Bash',
      phase: 'post',
      ok: true,
      kind: 'shell',
      isTest: false,
    },
    {
      t: 'AgentRunEnded',
      at: at(sec + 5),
      runId: `${id}-r`,
      ok,
      tokens: { input: weight, output: 0, cacheWrite: 0, cacheRead: 0 },
    },
    { t: 'TaskStatusChanged', at: at(sec + 6), taskId: id, status: 'completed' },
  ];
  const many = (who: string, n: number, weight: number, from: number) =>
    Array.from({ length: n }, (_, i) => work(`${who}-${i}`, from + i * 10, who, weight)).flat();
  const row = (s: VillageState, id: string) => efficiency(s, cfg).rows.find((r) => r.m.id === id);

  test('일을 많이 하면 급여는 커져도 효율 순위는 일 점수당 토큰으로: 3건 × 5만이 10건 × 10만보다 위', () => {
    const s = play([
      roster,
      ...many('backend-dev', 3, 50_000, 0),
      ...many('frontend-dev', 10, 100_000, 100),
      ...work('q-0', 300, 'qa-reviewer', 1_000),
    ]);
    const wages = (id: string) =>
      Object.values(s.runs).reduce((a, r) => a + (r.memberId === id ? (r.wage ?? 0) : 0), 0);
    expect(wages('frontend-dev')).toBeGreaterThan(wages('backend-dev')); // 급여 = 양
    const e = efficiency(s, cfg);
    expect(e.rows.map((r) => [r.m.id, r.rank, r.perPoint])).toEqual([
      ['backend-dev', 1, 50_000],
      ['frontend-dev', 2, 100_000],
      ['qa-reviewer', null, 1_000], // 실행 1개 < minTasks 3 → 순위 밖 (값은 보인다)
    ]);
    expect(row(s, 'qa-reviewer')?.why).toBe('few');
    expect(e.ranked).toBe(2);
  });

  test('도구를 안 쓴 실행과 실패로 끝난 실행(일 점수 0)의 토큰이 효율을 낮춘다', () => {
    const s = play([roster, ...many('backend-dev', 3, 50_000, 0)]);
    expect(row(s, 'backend-dev')?.perPoint).toBe(50_000);
    // 도구 없이 끝난 실행 10만 → (150k + 100k) / 3
    const idle = play(
      [
        { t: 'AgentRunStarted', at: at(100), runId: 'x', agentType: 'backend-dev' },
        {
          t: 'AgentRunEnded',
          at: at(101),
          runId: 'x',
          ok: true,
          tokens: { input: 100_000, output: 0, cacheWrite: 0, cacheRead: 0 },
        },
      ],
      cfg,
      s,
    );
    expect(row(idle, 'backend-dev')?.perPoint).toBeCloseTo(250_000 / 3);
    // 실패로 끝난 실행 5만: 일 점수 0 → (300k) / 3, 실행 5개
    const failed = play(work('f', 200, 'backend-dev', 50_000, false), cfg, idle);
    expect(failed.tasks.f?.quality).toBe('failed');
    expect(row(failed, 'backend-dev')).toMatchObject({ runs: 5, perPoint: 100_000 });
  });

  test('최근 window개 실행만, 같은 실행 끝이 또 와도 한 번, 토큰을 못 읽으면 순위 밖', () => {
    const s = play([roster, ...many('backend-dev', 22, 10_000, 0), ...many('frontend-dev', 3, 0, 500)]);
    expect(s.members['backend-dev']?.eff.recent).toHaveLength(cfg.efficiency.window);
    const again = play([{ t: 'AgentRunEnded', at: at(216), runId: 'backend-dev-21-r', ok: true }], cfg, s);
    expect(again.members['backend-dev']?.eff.recent).toEqual(s.members['backend-dev']?.eff.recent);
    expect(again.members['backend-dev']?.balance).toBe(s.members['backend-dev']?.balance);
    expect(row(s, 'frontend-dev')).toMatchObject({ rank: null, why: 'noTokens' });
  });

  test('팀장은 순위 밖, 마을 전체 = 팀장·팀원·외부인 토큰 ÷ 끝난 실행(팀원·외부인)의 일 점수 합, 팀장 몫', () => {
    const s = play([
      roster,
      ...many('backend-dev', 3, 100_000, 0),
      { t: 'AgentRunStarted', at: at(50), runId: 'v', agentType: 'Explore' },
      { t: 'ToolUsed', at: at(50), runId: 'v', tool: 'Read', phase: 'post', ok: true, kind: 'read', isTest: false },
      {
        t: 'AgentRunEnded',
        at: at(51),
        runId: 'v',
        ok: true,
        tokens: { input: 100_000, output: 0, cacheWrite: 0, cacheRead: 0 },
      },
      {
        t: 'MainTurnEnded',
        at: at(60),
        sessionId: 's',
        tokens: { input: 600_000, output: 0, cacheWrite: 0, cacheRead: 0 },
      },
    ]);
    const e = efficiency(s, cfg);
    expect(e.rows.some((r) => r.m.isLeader)).toBe(false);
    // 일 점수 = 팀원 실행 3개 × 1 + 외부인 실행 1 (외부인은 급여는 없어도 마을 전체 줄에는 든다)
    expect(e.team).toEqual({ tokens: 1_000_000, points: 4, perPoint: 1_000_000 / 4, leaderShare: 0.6 });
  });
  test('쪼개도 순위가 같다: 도구 20번짜리 일 = 도구 2번짜리 일 10개 (D23)', () => {
    const job = (id: string, who: string, sec: number, tools: number, input: number): DomainEvent[] => [
      { t: 'TaskCreated', at: at(sec), taskId: id, subject: id },
      { t: 'TaskStatusChanged', at: at(sec + 1), taskId: id, status: 'in_progress' },
      { t: 'AgentRunStarted', at: at(sec + 2), runId: `r-${id}`, agentType: who },
      ...Array.from({ length: tools }, (): DomainEvent => ({
        t: 'ToolUsed',
        at: at(sec + 3),
        runId: `r-${id}`,
        tool: 'Read',
        phase: 'post',
        ok: true,
        kind: 'read',
        isTest: false,
      })),
      {
        t: 'AgentRunEnded',
        at: at(sec + 4),
        runId: `r-${id}`,
        ok: true,
        tokens: { input, output: 0, cacheWrite: 0, cacheRead: 0 },
      },
      { t: 'TaskStatusChanged', at: at(sec + 5), taskId: id, status: 'completed' },
    ];
    // 같은 비율: 20만 ÷ 20번 = 2만 ÷ 2번 = 1만. frontend-dev는 30건이라 최근 20건만 본다
    const big = [0, 1, 2].flatMap((i) => job(`b${i}`, 'backend-dev', 10 + i * 10, 20, 200_000));
    const small = Array.from({ length: 30 }, (_, i) => job(`s${i}`, 'frontend-dev', 100 + i * 10, 2, 20_000)).flat();
    const r = efficiency(play([roster, ...big, ...small]), cfg);
    const perPoint = (id: string) => r.rows.find((x) => x.m.id === id)?.perPoint;
    expect(perPoint('backend-dev')).toBeCloseTo(10_000);
    expect(perPoint('frontend-dev')).toBeCloseTo(10_000);
  });
});

describe('토큰 진단 (D13, 01 문서 6.7)', () => {
  const T = (x: Partial<Tokens>): Tokens => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0, ...x });
  const use = (models: Record<string, Tokens>, parts: Record<string, Tokens> = {}, last = 0, calls = 1): Usage => ({
    calls,
    first: 0,
    last,
    models,
    parts,
  });
  const OPUS = 'claude-opus-5-5';

  test('모델 단가: Opus 5.5 캐시 읽기 0.05, Haiku 0.25배, 1시간 쓰기 2, 빠른 모드 2배, 모르는 모델은 D11 그대로', () => {
    const t = T({ input: 100, output: 10, cacheWrite: 40, cacheWrite1h: 20, cacheRead: 1000 });
    // 100 + 50 + 50 + 40 + 읽기
    expect(tokenWeight(t, cfg, OPUS)).toBe(240 + 50);
    expect(tokenWeight(t, cfg, 'claude-haiku-4-5-20251001')).toBe((240 + 100) * 0.25);
    expect(tokenWeight(t, cfg, `${OPUS} fast`)).toBe((240 + 50) * 2);
    expect(tokenWeight(t, cfg, 'claude-fable-5-1')).toBe((240 + 25) * 2.5);
    expect(tokenWeight(t, cfg, 'claude-opus-4-1-20250805')).toBe((240 + 100) * 3.75);
    expect(tokenWeight(t, cfg, 'claude-sonnet-5-5')).toBe((240 + 100) * 0.5);
    expect(tokenWeight(t, cfg, 'mystery')).toBe(240 + 100);
    expect(tokenWeight(t, cfg)).toBe(240 + 100);
  });

  test('영수증: 원인별 비용(주 모델 무게) + 출력, 대화 누적 = 실제 − 나머지 (수집기 테스트와 같은 기록)', () => {
    const z = T({});
    const u = use(
      { [OPUS]: T({ output: 180, cacheWrite: 1550, cacheWrite1h: 1570, cacheRead: 2400 }) },
      {
        base: { ...z, cacheWrite: 1000, cacheRead: 2000 },
        'tool:Bash': { ...z, cacheWrite: 300, cacheRead: 300 },
        'tool:Read': { ...z, cacheWrite: 100 },
        rebuild: { ...z, cacheWrite1h: 1550 },
      },
    );
    const r = receiptOf(u, cfg);
    expect(r.total).toBe(900 + 1937.5 + 3140 + 120);
    expect(r.parts).toEqual({
      base: 1350,
      'tool:Bash': 390,
      'tool:Read': 125,
      rebuild: 3100,
      output: 900,
      talk: 232.5,
    });
  });

  test('서브에이전트: 모델 단가로 청구하고 영수증에 더한다 · 팀장: 세션 누적 차이만, 치운 세션은 tokens 차이로', () => {
    const haiku = { 'claude-haiku-4-5-20251001': T({ input: 400_000 }) };
    const s = play(
      [
        { t: 'AgentRunStarted', at: at(1), runId: 'r', agentType: 'backend-dev' },
        {
          t: 'AgentRunEnded',
          at: at(2),
          runId: 'r',
          ok: true,
          tokens: T({ input: 400_000 }),
          usage: use(haiku, {}, 0, 3),
        },
      ],
      cfg,
      funded(),
    );
    const bd = s.members['backend-dev'];
    expect(bd?.tokens).toBe(100_000); // 40만 × 0.25
    expect(bd?.balance).toBe(300 - 100); // 비용 10만 ÷ 1,000
    expect(bd?.receipt).toEqual({
      parts: { talk: 100_000 },
      runs: 1,
      calls: 3,
      models: { 'claude-haiku-4-5-20251001': 100_000 },
    });

    const turn = (sec: number, sid: string, input: number, calls: number): DomainEvent => ({
      t: 'MainTurnEnded',
      at: at(sec),
      sessionId: sid,
      tokens: T({ input }),
      usage: use({ [OPUS]: T({ input }) }, { base: T({ input: input / 2 }) }, 0, calls),
    });
    const l = play([turn(10, 's', 100_000, 2), turn(20, 's', 300_000, 5)], cfg, s).members[LEADER_ID];
    expect(l?.tokens).toBe(300_000);
    expect(l?.receipt).toMatchObject({ runs: 2, calls: 5, parts: { base: 150_000, talk: 150_000 } });
    // 21개 세션 → 가장 오래된 s0 누적은 치움. s0이 이어지면 tokens 차이(기본 무게)로만 — 누적 전부를 다시 청구하지 않는다
    const many = play(
      Array.from({ length: 21 }, (_, i) => turn(30 + i, `s${i}`, 10_000, 1)),
      cfg,
      s,
    );
    expect(Object.keys(many.mainUsage)).toHaveLength(20);
    expect(many.mainUsage.s0).toBeUndefined();
    const again = play([turn(60, 's0', 30_000, 3)], cfg, many);
    const al = again.members[LEADER_ID];
    expect((al?.tokens ?? 0) - (many.members[LEADER_ID]?.tokens ?? 0)).toBe(20_000);
    expect((al?.receipt.parts.base ?? 0) - (many.members[LEADER_ID]?.receipt.parts.base ?? 0)).toBe(10_000); // 누적 비율(절반)대로
    expect(again.mainUsage.s0).toBeDefined(); // 다음 턴부터는 정확한 차이
  });

  test('팀장 대화 크기: 20만을 넘으면 세션마다 한 번 알림, 압축으로 줄면 다시', () => {
    const turn = (sec: number, last: number, sid = 's'): DomainEvent => ({
      t: 'MainTurnEnded',
      at: at(sec),
      sessionId: sid,
      tokens: T({ cacheRead: last }),
      usage: use({ [OPUS]: T({ cacheRead: last }) }, {}, last),
    });
    const s = play([roster, turn(1, 150_000), turn(2, 250_000), turn(3, 260_000), turn(4, 90_000), turn(5, 210_000)]);
    const warns = s.toasts.filter((x) => x.kind === 'tokens');
    expect(warns.map((x) => x.text)).toEqual([
      '팀장 대화가 25만 토큰 · 호출마다 약 1.3만씩 다시 읽어요 · /compact나 새 세션으로 줄여요',
      '팀장 대화가 21만 토큰 · 호출마다 약 1.1만씩 다시 읽어요 · /compact나 새 세션으로 줄여요',
    ]);
    expect(s.mainCtx).toMatchObject({ sessionId: 's', tokens: 210_000, perCall: 10_500, warned: true });
  });

  const work = (id: string, sec: number, who: string, weight: number): DomainEvent[] => [
    { t: 'TaskCreated', at: at(sec), taskId: id, subject: id },
    { t: 'TaskStatusChanged', at: at(sec + 1), taskId: id, status: 'in_progress' },
    { t: 'AgentRunStarted', at: at(sec + 1), runId: `${id}-r`, agentType: who },
    {
      t: 'ToolUsed',
      at: at(sec + 2),
      runId: `${id}-r`,
      tool: 'Bash',
      phase: 'post',
      ok: true,
      kind: 'shell',
      isTest: false,
    },
    { t: 'AgentRunEnded', at: at(sec + 5), runId: `${id}-r`, ok: true, tokens: T({ input: weight }) },
    { t: 'TaskStatusChanged', at: at(sec + 6), taskId: id, status: 'completed' },
  ];
  const many = (who: string, n: number, weight: number, from: number) =>
    Array.from({ length: n }, (_, i) => work(`${who}-${i}`, from + i * 10, who, weight)).flat();

  test('비싼 실행: 최근 건당 중앙값의 3배를 넘고 10만 이상이면 알림 (주원인 같이)', () => {
    const s = play([roster, ...many('backend-dev', 3, 50_000, 0)]);
    const run = (id: string, tokens: number, usage?: Usage): DomainEvent[] => [
      { t: 'AgentRunStarted', at: at(500), runId: id, agentType: 'backend-dev' },
      {
        t: 'AgentRunEnded',
        at: at(501),
        runId: id,
        ok: true,
        tokens: T({ input: tokens }),
        ...(usage ? { usage } : {}),
      },
    ];
    expect(play(run('ok', 150_000), cfg, s).toasts.filter((x) => x.kind === 'tokens')).toEqual([]);
    const big = play(
      run('big', 200_000, use({ mystery: T({ input: 200_000 }) }, { 'tool:Bash': T({ input: 120_000 }) })),
      cfg,
      s,
    );
    expect(big.toasts.at(-1)).toMatchObject({
      kind: 'tokens',
      text: 'backend-dev 실행 한 번이 평소의 4.0배 · 20만 · 주원인 Bash 결과 60%',
      ref: 'backend-dev',
    });
  });

  test('처방 팁: 비중 큰 원인 2줄 + 모델·재시도 신호, 팀장은 팀장용 글', () => {
    const s = play([roster]);
    const bd = s.members['backend-dev'];
    const l = s.members[LEADER_ID];
    if (!bd || !l) throw new Error();
    bd.receipt = { parts: { 'tool:Bash': 50, base: 20, talk: 30 }, runs: 2, calls: 10, models: { [OPUS]: 100 } };
    expect(tips(s, bd)).toEqual([
      { key: 'tool', p: 0.5, tool: 'Bash' },
      { key: 'model', p: 1, n: 5 },
    ]);
    l.receipt = { parts: { talk: 80, base: 20 }, runs: 3, calls: 30, models: { [OPUS]: 100 } };
    expect(tips(s, l)).toEqual([{ key: 'talkLeader', p: 0.8, n: 10 }]);
  });
});

describe('이어 받은 서브에이전트 = 구간마다 실행 하나 (01 문서 3.2, 02 문서 5.2)', () => {
  const tk = (input: number, output = 0, cacheWrite = 0, cacheRead = 0): Tokens => ({
    input,
    output,
    cacheWrite,
    cacheRead,
  });
  const start = (sec: number, runId: string, agentType: string): DomainEvent => ({
    t: 'AgentRunStarted',
    at: at(sec),
    runId,
    agentType,
  });
  const end = (sec: number, runId: string, tokens?: Tokens): DomainEvent => ({
    t: 'AgentRunEnded',
    at: at(sec),
    runId,
    ok: true,
    ...(tokens ? { tokens } : {}),
  });
  /** 도구 n번 (Pre+Post). agentType = 훅이 도구 이벤트에도 싣는 agent_type */
  const tools = (sec: number, runId: string, n: number, agentType?: string): DomainEvent[] =>
    Array.from({ length: n }, (_, k) =>
      (['pre', 'post'] as const).map((phase): DomainEvent => ({
        t: 'ToolUsed',
        at: at(sec + k),
        runId,
        tool: 'Read',
        phase,
        ok: true,
        kind: 'read',
        isTest: false,
        ...(agentType ? { agentType } : {}),
      })),
    ).flat();
  const wages = (s: VillageState) => Object.values(s.runs).reduce((a, r) => a + (r.wage ?? 0), 0);

  test('끝난 뒤 같은 agent_id로 다시 시작하면 새 실행 <id>#2: 두 급여가 다 남고 각각 한 번', () => {
    const s = play([
      roster,
      start(10, 'a', 'backend-dev'),
      ...tools(11, 'a', 5),
      end(20, 'a'),
      start(30, 'a', 'backend-dev'),
      ...tools(31, 'a', 3),
      end(40, 'a'),
      end(41, 'a'), // 중복 전달된 끝
    ]);
    expect(s.runs.a).toMatchObject({ toolCalls: 5, wage: 130, endedAt: at(20) });
    expect(s.runs['a#2']).toMatchObject({ toolCalls: 3, wage: 78, startedAt: at(30), memberId: 'backend-dev' });
    expect(s.economy.today.wages).toBe(208);
    expect(wages(s)).toBe(s.economy.today.wages);
    expect(s.members['backend-dev']?.eff.recent.map((r) => r.runId)).toEqual(['a', 'a#2']);
  });

  test('시작을 못 본 도구 호출은 그 자리에서 실행을 연다 (팀원은 agent_type) → 끝에서 한 번 받는다', () => {
    const s = play([roster, ...tools(10, 'b', 4, 'backend-dev'), end(20, 'b')]);
    expect(s.runs.b).toMatchObject({ memberId: 'backend-dev', startedAt: at(10), toolCalls: 4, wage: 104 });
    expect(s.economy.today.wages).toBe(104);
    // 시작도 도구도 못 본 끝(Claude Code 안쪽 포크: 다음 입력 제안 prompt_suggestion)은 실행이 아니다
    const t = play([{ t: 'AgentRunEnded', at: at(30), runId: 'ghost', ok: true }], cfg, s);
    expect(t.runs.ghost).toBeUndefined();
    expect(t.visitors).toEqual({});
  });

  test('끝난 구간 뒤에 시작 없이 도구 호출(Pre)이 오면 새 구간 — 늦게 온 Post는 끝난 구간에 붙는다', () => {
    const late: DomainEvent = {
      t: 'ToolUsed',
      at: at(21),
      runId: 'c',
      tool: 'Read',
      phase: 'post',
      ok: true,
      kind: 'read',
      isTest: false,
    };
    const s = play([
      roster,
      start(10, 'c', 'qa-reviewer'),
      ...tools(11, 'c', 2),
      { ...late, at: at(15), phase: 'pre' },
      end(20, 'c'),
      late,
    ]);
    expect(s.runs['c#2']).toBeUndefined();
    const t = play([...tools(30, 'c', 2), end(40, 'c')], cfg, s);
    expect(t.runs['c#2']).toMatchObject({ memberId: 'qa-reviewer', startedAt: at(30), toolCalls: 2, wage: 52 });
    expect(t.runs.c?.wage).toBe(78);
    expect(wages(t)).toBe(t.economy.today.wages);
  });

  test('토큰: 기록 파일 합은 구간을 넘어 누적 → 뒤 구간은 늘어난 몫만, 같은 누적이 또 오면 0', () => {
    const s = play(
      [
        start(10, 'd', 'backend-dev'),
        end(20, 'd', tk(1000, 0, 0, 0)),
        start(30, 'd', 'backend-dev'),
        end(40, 'd', tk(3000, 0, 0, 0)),
        end(41, 'd', tk(3000, 0, 0, 0)),
      ],
      cfg,
      funded(),
    );
    expect([s.runs.d?.tokens, s.runs['d#2']?.tokens]).toEqual([1000, 2000]);
    expect(s.members['backend-dev']?.tokens).toBe(3000);
  });

  test('이어 받은 구간은 새 Agent 호출의 작업을 가져가지 않는다 (이어 받기는 SendMessage, 01 문서 5.1-5)', () => {
    const s = play([
      roster,
      start(10, 'e', 'backend-dev'),
      end(20, 'e'),
      { t: 'AgentCalled', at: at(29), callId: 'c9', subagentType: 'backend-dev', subject: '새 일' },
      start(30, 'e', 'backend-dev'),
      start(31, 'f', 'backend-dev'),
    ]);
    expect(s.runs['e#2']?.taskId).toBeUndefined();
    expect(s.runs.f?.taskId).toBe('agent:c9');
    // 도구 Pre가 먼저 와서(비동기 훅) 구간 #2가 열린 뒤 진짜 시작이 와도 이어 받은 구간이다
    const pre = play([
      roster,
      start(10, 'e', 'backend-dev'),
      end(20, 'e'),
      { t: 'AgentCalled', at: at(29), callId: 'c9', subagentType: 'backend-dev', subject: '새 일' },
      tools(30, 'e', 1)[0] as DomainEvent,
      start(31, 'e', 'backend-dev'),
      start(32, 'f', 'backend-dev'),
    ]);
    expect(pre.runs['e#2']).toMatchObject({ endedAt: null, toolCalls: 1 });
    expect(pre.runs['e#2']?.taskId).toBeUndefined();
    expect(pre.runs.f?.taskId).toBe('agent:c9');
  });

  test('토큰: 기록 파일이 새로 쓰여 누적이 줄면(호출 수가 줄면) 새 합을 그대로 청구, 늦게 온 작은 합은 누적을 내리지 않는다', () => {
    const u = (calls: number, input: number): Usage => ({
      calls,
      first: 0,
      last: 0,
      models: { m: tk(input) },
      parts: {},
    });
    const endU = (sec: number, runId: string, calls: number, input: number): DomainEvent => ({
      t: 'AgentRunEnded',
      at: at(sec),
      runId,
      ok: true,
      tokens: tk(input),
      usage: u(calls, input),
    });
    const reset = play(
      [start(10, 'r', 'backend-dev'), endU(20, 'r', 5, 3000), start(30, 'r', 'backend-dev'), endU(40, 'r', 2, 1000)],
      cfg,
      funded(),
    );
    expect([reset.runs.r?.tokens, reset.runs['r#2']?.tokens]).toEqual([3000, 1000]);
    const late = play(
      [
        start(10, 'q', 'backend-dev'),
        end(20, 'q', tk(3000)),
        end(21, 'q', tk(1000)), // 늦게 온 중복 끝 (작은 합)
        start(30, 'q', 'backend-dev'),
        end(40, 'q', tk(4000)),
      ],
      cfg,
      funded(),
    );
    expect([late.runs.q?.tokens, late.runs['q#2']?.tokens]).toEqual([3000, 1000]);
  });

  test('같은 이벤트를 두 번 재생하면 같은 상태, 입력은 그대로', () => {
    const ev = [
      roster,
      start(10, 'g', 'backend-dev'),
      ...tools(11, 'g', 2),
      end(20, 'g', tk(10)),
      ...tools(30, 'g', 2),
      end(40, 'g', tk(30)),
      ...tools(50, 'h', 1, 'frontend-dev'),
    ];
    const copy = structuredClone(ev);
    expect(JSON.stringify(replay('p', ev, cfg))).toBe(JSON.stringify(replay('p', ev, cfg)));
    expect(ev).toEqual(copy);
  });
});
