// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement as h, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { defaultConfig as cfg, type DayRecord, type VillageState } from '@tycoon/core';
import { barPath, niceTicks } from './charts';
import { EconomyScreen, inRange, spending, weekly } from './EconomyScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const golden = () =>
  JSON.parse(
    readFileSync(join(import.meta.dirname, '../../../../../fixtures/sample-session.golden.json'), 'utf8'),
  ) as VillageState;

/** 하루 기록: 급여 = 10 × day, 세금 = day, 토큰 20, 40일에 가구 50. 팀장 토큰값 30 — 35일부터 기금이 바닥나 10만 내고 20은 못 냄.
 *  30일에 사용자가 팀장 가구 120을 기금으로 사 줌 */
const rec = (day: number): DayRecord => ({
  day,
  at: day * 3_600_000,
  wages: 10 * day,
  tax: day,
  purchases: day === 40 ? 50 : 0,
  tokens: 20,
  leaderTokens: day < 35 ? 30 : 10,
  leaderUnpaid: day < 35 ? 0 : 20,
  leaderPurchases: day === 30 ? 120 : 0,
  materials: 0,
  works: day === 5 || day === 25 ? 300 : 0, // 레벨업·공공시설 (06 문서 6.4)
  fund: day < 35 ? 100 + day : 0,
  balances: { '@leader': 0, 'backend-dev': 860 + day, 'frontend-dev': 300, 'qa-reviewer': 0 },
});
const DAYS = Array.from({ length: 40 }, (_, i) => rec(i + 1)); // 1..40일

function village(history: DayRecord[], day = history.at(-1)?.day ?? 0) {
  const s = golden();
  s.clock.day = day;
  s.economy = {
    ...s.economy,
    fund: 120,
    deficit: false,
    today: {
      wages: 0,
      tax: 0,
      purchases: 0,
      tokens: 0,
      leaderTokens: 0,
      leaderUnpaid: 0,
      leaderPurchases: 0,
      materials: 0,
      works: 0,
    }, // 정산 전 몫은 따로 시험
    history,
  };
  for (const [id, m] of Object.entries(s.members))
    Object.assign(m, { balance: id === 'backend-dev' ? 900 : id === '@leader' ? 0 : 300, hardship: false });
  const qa = s.members['qa-reviewer'];
  if (qa) Object.assign(qa, { balance: 0, hardship: true });
  return s;
}

function render(el: ReactElement) {
  const div = document.body.appendChild(document.createElement('div'));
  const root = createRoot(div);
  act(() => root.render(el));
  return { div, rerender: (e: ReactElement) => act(() => root.render(e)), unmount: () => act(() => root.unmount()) };
}
const flush = () => act(async () => {});
const texts = (root: Element, sel: string) => [...root.querySelectorAll(sel)].map((e) => e.textContent ?? '');
const button = (root: Element, label: string) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement;
const click = (el: Element) => act(() => (el as HTMLElement).click());
const key = (el: Element, k: string) =>
  act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })));
/** 표 이름으로 표의 본문 칸들 (줄마다) */
const tableRows = (root: Element, name: string) =>
  [...(root.querySelector(`table[aria-label="${name}"]`)?.querySelectorAll('tbody tr') ?? [])].map((tr) =>
    [...tr.children].map((c) => c.textContent ?? ''),
  );

const offline = () =>
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('down'))),
  );

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

test('눈금·막대 모양: 깔끔한 눈금, 데이터 끝만 둥근 막대 (캔버스 경로와 같음)', () => {
  expect(niceTicks(98, 104.2, 4)).toEqual([98, 100, 102, 104, 106]);
  expect(niceTicks(1.5, 2.5, 2)).toEqual([1.5, 2, 2.5]);
  expect(niceTicks(0, 1120, 2)).toEqual([0, 1000, 2000]); // 흐름 차트는 1,176 안의 0·1,000만 그린다
  expect(niceTicks(5, 5)).toEqual([4, 4.5, 5, 5.5, 6]);
  expect(barPath(58.1, 20, 100, 39.9)).toBe('M58.1 100V43.9Q58.1 39.9 62.1 39.9H74.1Q78.1 39.9 78.1 43.9V100Z');
  expect(barPath(58.1, 20, 102, 127.9)).toBe('M58.1 102V123.9Q58.1 127.9 62.1 127.9H74.1Q78.1 127.9 78.1 123.9V102Z');
});

test('기간 = 게임 날 번호 (건너뛴 날은 비어 있음), 주 k = ⌊(오늘 − day) / 7⌋', () => {
  const gap = [rec(1), rec(2), rec(9), rec(10)];
  expect(inRange(gap, 10, '7d').map((r) => r.day)).toEqual([9, 10]); // 기록 수가 아니라 날로
  expect(inRange(DAYS, 40, '30d')).toHaveLength(30);
  expect(inRange(DAYS, 40, 'all')).toHaveLength(40);
  const w = weekly(inRange(DAYS, 40, '30d'), 40);
  expect(w.map((x) => x.label)).toEqual(['4주 전', '3주 전', '2주 전', '1주 전', '이번 주']);
  // 이번 주 = 34~40일: 급여 10 × (34+…+40), 지출 = 세금 (34+…+40) + 토큰 20 × 7 + 가구 50. 관리비·보너스 없음 (D20)
  expect(w.at(-1)).toMatchObject({ income: 2590, spending: 259 + 140 + 50 });
  expect(weekly([], 0)).toEqual([]);
});

/** 기금 흐름 카드의 줄들 (이름 + 값) */
const fundRows = (root: Element) => texts(root.querySelector('.ec-fund') ?? root, '.ec-frow');

test('기금 흐름 (D21, 06 문서 3.3·4장): 기간 합 세금 + · 팀장 토큰값 − · 레벨업·공공시설 − · 못 낸 팀장 토큰값, 지금 기금, 적자면 시청 적자', async () => {
  offline();
  const s = village(DAYS);
  s.economy.fund = 0;
  s.economy.deficit = true;
  const r = render(h(EconomyScreen, { projectId: 'p', state: s, cfg, onBack: () => {} }));
  await flush();
  const card = r.div.querySelector('.ec-fund');
  expect(card?.querySelector('.ec-h2')?.textContent).toBe('기금 흐름');
  expect(card?.textContent).toContain('팀장(시장)의 지갑');
  // 30일 = 11~40일: 세금 11+…+40 = 765, 팀장 30 × 24일 + 10 × 6일 = 780, 레벨업·공공시설은 25일 것만, 팀장 가구 30일 120,
  // 못 낸 몫 20 × 6일
  expect(fundRows(r.div)).toEqual([
    '세금+765',
    '팀장 토큰값−780',
    '레벨업·공공시설−300',
    '팀장 가구−120',
    '못 낸 팀장 토큰값120',
    '지금 기금0',
  ]);
  const deficit = card?.querySelector('.ec-deficit');
  expect(deficit?.getAttribute('role')).toBe('note');
  expect(deficit?.querySelector('[data-icon="blocked"]')).not.toBeNull(); // 색만이 아니라 아이콘 + 글자
  expect(deficit?.textContent).toContain('시청 적자');
  expect(deficit?.textContent).toContain('팀원에게 더 맡기고 팀장 대화를 줄이면 풀려요');
  // 물가·금리·중앙은행은 없다 (D20)
  expect(r.div.textContent).not.toMatch(/기준금리|물가|중앙은행/);

  click(button(r.div, '7일'));
  await flush();
  expect(fundRows(r.div)).toEqual([
    '세금+259',
    '팀장 토큰값−90',
    '레벨업·공공시설0',
    '팀장 가구0',
    '못 낸 팀장 토큰값120',
    '지금 기금0',
  ]);
  r.unmount();

  const ok = village(DAYS);
  const r2 = render(h(EconomyScreen, { projectId: 'p', state: ok, cfg, onBack: () => {} }));
  await flush();
  expect(fundRows(r2.div).at(-1)).toBe('지금 기금120');
  expect(r2.div.querySelector('.ec-deficit')).toBeNull();
  r2.unmount();
});

test('기금 흐름에 오늘(아직 정산 전) 몫도: 기금이 156 → 0이면 팀장 토큰값 156 · 못 낸 844가 보인다 (D21, 06 문서 3.3)', async () => {
  offline();
  const s = village(DAYS);
  s.economy.fund = 0;
  s.economy.deficit = true;
  s.economy.today = {
    wages: 50,
    tax: 10,
    purchases: 0,
    tokens: 0,
    leaderTokens: 156,
    leaderUnpaid: 844,
    leaderPurchases: 80,
    materials: 0,
    works: 0,
  };
  const r = render(h(EconomyScreen, { projectId: 'p', state: s, cfg, onBack: () => {} }));
  await flush();
  // 30일 기록 합 + 오늘: 세금 765 + 10, 팀장 780 + 156, 팀장 가구 120 + 80, 못 낸 120 + 844 (오늘은 어느 기간에나 들어간다)
  expect(fundRows(r.div)).toEqual([
    '세금+775',
    '팀장 토큰값−936',
    '레벨업·공공시설−300',
    '팀장 가구−200',
    '못 낸 팀장 토큰값964',
    '지금 기금0',
  ]);
  click(button(r.div, '7일'));
  await flush();
  expect(fundRows(r.div).slice(0, 2)).toEqual(['세금+269', '팀장 토큰값−246']);
  // 첫 정산 전(기록 없음)에도 오늘 몫은 보인다
  r.unmount();
  const first = village([]);
  first.economy.today = {
    wages: 780,
    tax: 156,
    purchases: 0,
    tokens: 0,
    leaderTokens: 156,
    leaderUnpaid: 844,
    leaderPurchases: 0,
    materials: 0,
    works: 0,
  };
  first.economy.fund = 0;
  const r2 = render(h(EconomyScreen, { projectId: 'p', state: first, cfg, onBack: () => {} }));
  await flush();
  expect(fundRows(r2.div)).toEqual([
    '세금+156',
    '팀장 토큰값−156',
    '레벨업·공공시설0',
    '팀장 가구0',
    '못 낸 팀장 토큰값844',
    '지금 기금0',
  ]);
  r2.unmount();
});

test('상태 대신 /economy: 기간마다 다시 받고, 실패하면 상태의 기록으로', async () => {
  const s = village(DAYS);
  const served = DAYS.map((r) => ({ ...r, tax: 0 })); // 서버 값이 이긴다는 표시
  const fetchMock = vi.fn((_url: string) =>
    Promise.resolve(new Response(JSON.stringify({ fund: 0, deficit: false, history: served, members: [] }))),
  );
  vi.stubGlobal('fetch', fetchMock);
  const r = render(h(EconomyScreen, { projectId: 'p 1', state: s, cfg, onBack: () => {} }));
  await flush();
  expect(fetchMock).toHaveBeenLastCalledWith('/api/projects/p%201/economy?range=30d');
  expect(button(r.div, '30일').getAttribute('aria-pressed')).toBe('true');
  expect(fundRows(r.div)[0]).toBe('세금0');
  click(button(r.div, '표로 보기'));
  expect(tableRows(r.div, '보물상자 흐름 (주별)')[0]).toEqual(['이번 주', '+2,590', '−190', '+2,400']);

  click(button(r.div, '7일'));
  await flush();
  expect(fetchMock).toHaveBeenLastCalledWith('/api/projects/p%201/economy?range=7d');
  expect(tableRows(r.div, '보물상자 흐름 (주별)')).toHaveLength(1);

  // 새 하루 기록이 오면 다시 받는다 → 이번엔 실패 → 상태 기록 (7일 = 35~41일)
  fetchMock.mockImplementation(() => Promise.resolve(new Response('{"error":"경제·상점은 M7"}', { status: 501 })));
  r.rerender(h(EconomyScreen, { projectId: 'p 1', state: village([...DAYS, rec(41)]), cfg, onBack: () => {} }));
  await flush();
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(fundRows(r.div)[0]).toBe('세금+266');
  r.unmount();
});

test('머리 줄: 다음 정산까지 남은 활동 시간 (날은 에이전트가 일한 시간으로만, 01 문서 6.2·8.7)', async () => {
  offline();
  const s = village(DAYS);
  s.clock.dayStartMs = 40 * cfg.time.gameDayMs;
  s.clock.activeMs = s.clock.dayStartMs + 15 * 60_000 + 1; // 41일째를 15분 남짓 일함
  const r = render(h(EconomyScreen, { projectId: 'p', state: s, cfg, onBack: () => {} }));
  await flush();
  expect(texts(r.div, '.ec-head .ec-meta')).toContain('다음 정산까지 활동 45분');
  r.unmount();
});

test('금고 타일: 기준이 작거나 0이어도 퍼센트 없이 기간 동안 늘고 준 만큼(절대값)', async () => {
  offline();
  const at = (day: number, sum: number): DayRecord => ({ ...rec(day), balances: { '@leader': 0, 'backend-dev': sum } });
  const vaultTile = async (history: DayRecord[], range?: string) => {
    const r = render(h(EconomyScreen, { projectId: 'p', state: village(history), cfg, onBack: () => {} }));
    await flush();
    if (range) {
      click(button(r.div, range));
      await flush();
    }
    const text = texts(r.div, '.ec-tile')[0];
    r.unmount();
    return text;
  };
  const days = (first: number) => DAYS.map((d) => (d.day === 11 ? at(11, first) : d));
  expect(await vaultTile(days(21))).toBe('보물상자 · 팀 금고진주1,200▲ 1,179 · 지난 30일'); // 21에서 1,200
  expect(await vaultTile(days(0))).toBe('보물상자 · 팀 금고진주1,200▲ 1,200 · 지난 30일'); // 0에서도 보임
  expect(await vaultTile(days(1_320))).toBe('보물상자 · 팀 금고진주1,200▼ 120 · 지난 30일');
  expect(await vaultTile(days(1_200))).toBe('보물상자 · 팀 금고진주1,200' + '0 · 지난 30일');
  expect(await vaultTile(days(21))).not.toContain('%');
});

test('기간 필터가 타일·기금 흐름·차트·표 모두에 같이 적용', async () => {
  offline();
  const r = render(h(EconomyScreen, { projectId: 'p', state: village(DAYS), cfg, onBack: () => {} }));
  await flush();
  const tiles = () => texts(r.div, '.ec-tile');
  expect(tiles()).toHaveLength(3); // 금고 · 이번 주 급여 · 이번 주 지출 (물가·금리 타일 없음)
  // 30일 = 11~40일
  expect(tiles()[0]).toBe('보물상자 · 팀 금고진주1,200▲ 29 · 지난 30일'); // 잔고 합 900 + 300 + 0 + 0, 11일 1,171에서
  expect(tiles()[1]).toContain('2,590');
  expect(tiles()[1]).toContain('▲ 490 · 지난주 대비'); // 이번 주 2,590 − 지난주 10 × (27+…+33) = 2,100
  expect(tiles()[2]).toBe('이번 주 지출449▲ 99 · 세금 · 가구 · 토큰 · 자재비'); // 449 − 지난주 (세금 210 + 토큰 140)
  // 층 자재비도 팀 금고에서 나간다 (06 문서 5.3). 옛 기록(필드 없음)은 0
  expect(spending({ ...rec(1), materials: 800 })).toBe(spending(rec(1)) + 800);
  expect(spending({ ...rec(1), materials: undefined as unknown as number })).toBe(spending(rec(1)));

  click(button(r.div, '7일'));
  await flush();
  expect(tiles()[0]).toContain('▲ 6 · 지난 7일'); // 34일 1,194에서
  expect(tiles()[1]).not.toContain('지난주 대비'); // 지난주가 기간 밖
  expect(r.div.querySelectorAll('[data-week]')).toHaveLength(1);

  click(button(r.div, '전체'));
  await flush();
  expect(r.div.querySelectorAll('[data-week]')).toHaveLength(6); // 1~40일 = 0~5주 전
  expect(fundRows(r.div).slice(0, 4)).toEqual([
    '세금+820',
    '팀장 토큰값−1,080',
    '레벨업·공공시설−600',
    '팀장 가구−120',
  ]);
  click(button(r.div, '표로 보기'));
  expect(tableRows(r.div, '보물상자 흐름 (주별)')).toHaveLength(6);
  r.unmount();
});

test('툴팁: 키보드(←/→/Home/End)와 마우스가 그 주 수입·지출', async () => {
  offline();
  const r = render(h(EconomyScreen, { projectId: 'p', state: village(DAYS), cfg, onBack: () => {} }));
  await flush();
  const plots = [...r.div.querySelectorAll('.ec-plot')] as HTMLElement[];
  expect(plots).toHaveLength(1); // 주별 흐름만 (물가·금리 차트 없음)
  const [flow] = plots;
  if (!flow) throw new Error('흐름 차트');
  const tip = () => flow.querySelector('.ec-tip');
  const live = flow.querySelector('[role="status"]');
  expect(tip()).toBeNull();
  expect(live?.textContent).toBe(''); // 읽기 알림 자리는 비어 있어도 있다
  act(() => flow.focus());
  expect(live?.contains(tip())).toBe(true);
  expect(tip()?.textContent).toBe('이번 주수입+2,590지출−449'); // 포커스 = 가장 최근 주
  key(flow, 'ArrowLeft');
  expect(tip()?.textContent).toBe('1주 전수입+2,100지출−350');
  key(flow, 'Home');
  expect(tip()?.textContent).toBe('4주 전수입+230지출−63'); // 11·12일
  act(() => flow.blur());
  expect(tip()).toBeNull();

  // 마우스: 화면 x → 그 주 칸 (plot 48~490 / 500, 5주 → 칸 88.4). x 150 → 두 번째 칸
  flow.getBoundingClientRect = () => ({ left: 0, top: 0, width: 500, height: 222 }) as DOMRect;
  act(() => void flow.dispatchEvent(new PointerEvent('pointermove', { clientX: 150, bubbles: true })));
  expect(tip()?.textContent).toBe('3주 전수입+1,120지출−252');
  r.unmount();
});

test('표로 보기 = 차트와 같은 값 (주마다 막대 ↔ 표 줄, 잔고)', async () => {
  offline();
  const r = render(h(EconomyScreen, { projectId: 'p', state: village(DAYS), cfg, onBack: () => {} }));
  await flush();
  const flow = r.div.querySelector('.ec-plot') as HTMLElement;
  act(() => flow.focus());
  key(flow, 'Home');
  const weeksFromChart: string[][] = [];
  for (let i = 0; i < 5; i++) {
    weeksFromChart.push(texts(flow, '.ec-tip__val, .ec-tip__num'));
    key(flow, 'ArrowRight');
  }
  const balances = texts(r.div, '.ec-brow').map((x) => x.replace('형편이 어려움', ''));
  const fund = fundRows(r.div);

  click(button(r.div, '표로 보기'));
  expect(button(r.div, '표로 보기').getAttribute('aria-pressed')).toBe('true');
  expect(r.div.querySelector('.ec-plot')).toBeNull();
  const weekRows = tableRows(r.div, '보물상자 흐름 (주별)');
  expect(weekRows.map((c) => c.slice(0, 3)).reverse()).toEqual(weeksFromChart);
  expect(weekRows[0]).toEqual(['이번 주', '+2,590', '−449', '+2,141']);
  const balanceRows = tableRows(r.div, '팀원 잔고');
  expect(balanceRows.map((c) => c.slice(0, 2).join(''))).toEqual(balances); // 막대 줄 = 이름 + 값, 같은 순서 (많은 순)
  expect(balanceRows.at(-1)).toEqual(['qa-reviewer', '0', '형편이 어려움']);
  expect(fundRows(r.div)).toEqual(fund); // 기금 흐름은 표로 봐도 같은 줄
  r.unmount();
});

test('첫 게임 하루 전: 빈 안내, 차트 없음, 타일·기금은 지금 값, 팀원 잔고에 팀장 없음 (팀장 지갑 = 기금)', async () => {
  offline();
  const onBack = vi.fn();
  const s = village([]);
  const r = render(h(EconomyScreen, { projectId: 'p', state: s, cfg, onBack }));
  await flush();
  expect(r.div.querySelector('.ec-empty[role="status"]')?.textContent).toContain('첫 게임 하루가 지나면 차트가 생겨요');
  expect(r.div.querySelector('.ec-plot')).toBeNull();
  const tiles = texts(r.div, '.ec-tile');
  expect(tiles[1]).toBe('이번 주 급여0세금 떼기 전 급여');
  expect(fundRows(r.div)).toEqual([
    '세금0',
    '팀장 토큰값0',
    '레벨업·공공시설0',
    '팀장 가구0',
    '못 낸 팀장 토큰값0',
    '지금 기금120',
  ]);
  expect(r.div.querySelectorAll('.ec-fund .ec-tone--good, .ec-fund .ec-tone--bad')).toHaveLength(0); // 0은 색 없이
  expect(r.div.querySelectorAll('.ec-brow')).toHaveLength(3); // 잔고는 첫날 전에도, 팀장 빼고
  expect(r.div.querySelector('.ec-brow[data-member="@leader"]')).toBeNull();
  expect(r.div.querySelector('.ec-hard [data-icon="blocked"]')).not.toBeNull(); // 형편 = 아이콘 + 글자
  click(button(r.div, '표로 보기'));
  expect(r.div.querySelector('.ec-empty')).not.toBeNull();
  expect(tableRows(r.div, '팀원 잔고')).toHaveLength(3);
  click(button(r.div, '마을'));
  expect(onBack).toHaveBeenCalledOnce();
  r.unmount();
});

test('효율 순위 (D23, 06 문서 3.6): 일 1점당 토큰 순, 순위 밖은 까닭, 팀장 없음, 마을 전체 줄, 표도 같은 값', async () => {
  offline();
  const s = village(DAYS);
  for (const m of Object.values(s.members)) m.tokens = 0;
  const recent = (n: number, tokens: number) =>
    Array.from({ length: n }, (_, i) => ({ runId: `r${i}`, tokens, credit: 1 }));
  Object.assign(s.members['qa-reviewer'] ?? {}, {
    receipt: { parts: { 'tool:Bash': 60, base: 40 }, runs: 3, calls: 9, models: { 'claude-opus-5-5': 100 } },
  });
  Object.assign(s.members['qa-reviewer'] ?? {}, { tokens: 150_000, eff: { recent: recent(3, 50_000) } }); // 잔고 0이어도 1위
  Object.assign(s.members['backend-dev'] ?? {}, { tokens: 10_000, eff: { recent: recent(1, 10_000) } });
  Object.assign(s.members['@leader'] ?? {}, { tokens: 900_000 });
  // 끝난 실행 하나: 도구 10번, 테스트 없음 → 일 10점
  s.runs = {
    r1: {
      runId: 'r1',
      agentType: 'qa-reviewer',
      memberId: 'qa-reviewer',
      visitorKind: null,
      startedAt: 0,
      endedAt: 1,
      lastAt: 1,
      ok: true,
      toolCalls: 10,
      failStreak: 0,
      testsPassed: 0,
      testsFailed: 0,
      openPre: {},
    },
  };
  const r = render(h(EconomyScreen, { projectId: 'p', state: s, cfg, onBack: () => {} }));
  await flush();
  const rows = [...r.div.querySelectorAll('.ec-erow')];
  expect(rows.map((e) => e.getAttribute('data-member'))).toEqual(['qa-reviewer', 'backend-dev']); // 팀장·입주 전 팀원 없음
  expect(rows[0]?.querySelector('.ec-rank')?.textContent).toBe('1');
  expect(rows[0]?.textContent).toContain('1점당 5만');
  expect(rows[1]?.classList.contains('ec-erow--out')).toBe(true);
  expect(rows[1]?.textContent).toContain('실행 1/3번');
  expect(rows[0]?.querySelector('.ec-esub')?.textContent).toBe('주원인 Bash 결과 60%'); // 급여 보정 없음 (D20)
  // 1,060,000 ÷ 일 10점, 팀장 900,000 / 1,060,000 = 85%
  expect(r.div.textContent).toContain('마을 전체 · 지금까지 일 10점 · 1점당 10.6만 · 그중 팀장 몫 85%');
  click(button(r.div, '표로 보기'));
  const table = tableRows(r.div, '효율 순위');
  expect(table.map((c) => [c[0], c[2], c[3], c[4]])).toEqual([
    ['qa-reviewer', '1점당 5만', '3', '1'],
    ['backend-dev', '1점당 1만', '1', '실행 1/3번'],
  ]);
  r.unmount();
});
