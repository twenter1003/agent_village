// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import {
  defaultConfig as cfg,
  seedPersonality,
  type AgentRun,
  type OwnedFurniture,
  type VillageState,
} from '@tycoon/core';
import { roomBox, toRoom } from '../../room/RoomScene';
import { moveSteps } from './api';
import { HouseScreen, wallet } from './HouseScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

const S = 1.6;
const f = (
  id: string,
  kind: string,
  placed: OwnedFurniture['placed'],
  fabric: string | null = null,
): OwnedFurniture => ({
  id,
  kind,
  fabric,
  price: 100,
  day: 0,
  by: 'user',
  placed,
});
/** 골든 상태 + backend-dev 방: 침대 (0,0)(1,0), 책상 (3,2), 화분 (4,2), 창고에 램프 */
function state() {
  const s = JSON.parse(
    readFileSync(join(import.meta.dirname, '../../../../../fixtures/sample-session.golden.json'), 'utf8'),
  ) as VillageState;
  const m = s.members['backend-dev'];
  if (!m) throw new Error('골든에 backend-dev 없음');
  m.furniture = [
    f('f1', 'bed', { x: 0, y: 0, rot: 0 }, 'blue'),
    f('f2', 'desk', { x: 3, y: 2, rot: 0 }),
    f('f3', 'plant', { x: 4, y: 2, rot: 0 }),
    f('f4', 'lamp', null, 'coral'),
  ];
  return s;
}
function render(s: VillageState, memberId = 'backend-dev') {
  const div = document.body.appendChild(document.createElement('div'));
  const root = createRoot(div);
  act(() => root.render(h(HouseScreen, { state: s, cfg, projectId: 'p', memberId, onBack: () => {} })));
  return div;
}
const button = (root: Element, label: string) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement;
const item = (root: Element, fid: string) => root.querySelector(`button[data-fid="${fid}"]`) as HTMLButtonElement;
const key = (el: Element, k: string) =>
  act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })));
/** 칸 가운데의 화면 좌표 (happy-dom 상자는 0,0) */
function px(x: number, y: number) {
  const { ox, oy } = roomBox();
  const c = toRoom(x + 0.5, y + 0.5);
  return { clientX: (ox + c.sx) * S, clientY: (oy + c.sy) * S };
}
const pointer = (el: Element, type: string, at: { clientX: number; clientY: number }) =>
  act(() => void el.dispatchEvent(new PointerEvent(type, { ...at, bubbles: true, button: 0, pointerId: 1 })));

test('가구 옮기기: 겹치는 칸으로는 안 가고 까닭 한 줄, 빈 칸으로는 간다', () => {
  const div = render(state());
  expect(item(div, 'f2')).toBeNull(); // 보기 모드는 버튼 없음
  act(() => button(div, '가구 옮기기').click());

  const desk = item(div, 'f2');
  expect(desk.getAttribute('aria-label')).toBe('유목 책상 · 노트북 · (3, 2)');
  key(desk, 'ArrowRight'); // (4,2) = 화분
  expect(item(div, 'f2').getAttribute('aria-label')).toBe('유목 책상 · 노트북 · (3, 2)');
  expect(div.querySelector('.hs-msg')?.textContent).toBe('다른 가구와 겹치거나 놓을 수 없는 칸이에요');

  act(() => item(div, 'f2').focus());
  key(item(div, 'f2'), 'ArrowDown'); // (3,3) 빈 칸
  expect(item(div, 'f2').getAttribute('aria-label')).toBe('유목 책상 · 노트북 · (3, 3)');
  expect(document.activeElement).toBe(item(div, 'f2')); // 깊이가 바뀌어도 포커스 그대로 (DOM 순서 고정)
  expect(div.querySelector('.hs-msg')?.textContent).toBe('');
});

test('끌기: 겹치는 칸 위에서는 위험 표시, 놓으면 제자리 · 빈 칸이면 옮김', () => {
  const div = render(state());
  act(() => button(div, '가구 옮기기').click());
  const scene = div.querySelector('.rs') as HTMLElement;

  pointer(item(div, 'f2'), 'pointerdown', px(3, 2));
  pointer(scene, 'pointermove', px(4, 2)); // 화분 자리
  expect(div.querySelector('.rs-mark--bad')).not.toBeNull();
  expect(item(div, 'f2').classList.contains('rs-item--bad')).toBe(true);
  pointer(scene, 'pointerup', px(4, 2));
  expect(item(div, 'f2').getAttribute('aria-label')).toContain('(3, 2)');
  expect(div.querySelector('.hs-msg')?.textContent).not.toBe('');

  pointer(item(div, 'f2'), 'pointerdown', px(3, 2));
  pointer(scene, 'pointermove', px(2, 4));
  expect(div.querySelector('.rs-mark--ok')).not.toBeNull();
  pointer(scene, 'pointerup', px(2, 4));
  expect(item(div, 'f2').getAttribute('aria-label')).toContain('(2, 4)');
});

test('돌리기: 2×1만, 방 밖으로 나가면 막힘. 창고로 → 목록에 창고', () => {
  const div = render(state());
  act(() => button(div, '가구 옮기기').click());
  act(() => item(div, 'f2').click());
  expect(button(div, '돌리기').disabled).toBe(true); // 1×1
  key(item(div, 'f2'), 'r'); // R 키도 1×1이면 아무 일 없음 (막힘 안내 없음)
  expect(div.querySelector('.hs-msg')?.textContent).toBe('');
  expect(item(div, 'f2').style.transform).toBe('');
  act(() => item(div, 'f1').click());
  act(() => button(div, '돌리기').click()); // (0,0)(0,1) 빈 칸
  expect(item(div, 'f1').style.transform).toBe('scaleX(-1)');
  act(() => button(div, '창고로').click());
  expect(item(div, 'f1')).toBeNull();
  expect(div.querySelector('[data-fid="f1"].hs-fi--stored')).not.toBeNull();
});

test('저장: 바뀐 가구만 PUT, 자리 바꾸기는 하나를 창고로 뺐다가 (중간에도 안 겹침)', async () => {
  const s = state();
  const m = s.members['backend-dev'];
  if (!m) throw new Error();
  const swap = new Map([
    ['f2', { x: 4, y: 2, rot: 0 as const }],
    ['f3', { x: 3, y: 2, rot: 0 as const }],
    ['f1', { x: 0, y: 0, rot: 0 as const }], // 그대로 → 안 보냄
  ]);
  expect(moveSteps(m, swap, cfg)).toEqual([
    { id: 'f2', placed: null },
    { id: 'f3', placed: { x: 3, y: 2, rot: 0 } },
    { id: 'f2', placed: { x: 4, y: 2, rot: 0 } },
  ]);

  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetch);
  const div = render(s);
  act(() => button(div, '가구 옮기기').click());
  key(item(div, 'f2'), 'ArrowDown');
  await act(async () => button(div, '저장').click());
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]?.[0]).toBe('/api/projects/p/members/backend-dev/furniture/f2');
  expect(fetch.mock.calls[0]?.[1]?.method).toBe('PUT');
  expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({ placed: { x: 3, y: 3, rot: 0 } });
  expect(item(div, 'f2')).toBeNull(); // 저장 뒤 보기 모드
});

/** 끝난 실행 하나 (급여는 실행 단위, D20·06 문서 3.4) */
const run = (runId: string, memberId: string, endedAt: number | null, wage?: number, taskId?: string): AgentRun => ({
  runId,
  agentType: memberId,
  memberId,
  visitorKind: null,
  startedAt: 0,
  endedAt,
  lastAt: endedAt ?? 0,
  ok: endedAt === null ? null : true,
  toolCalls: 10,
  failStreak: 0,
  testsPassed: 0,
  testsFailed: 0,
  openPre: {},
  ...(wage === undefined ? {} : { wage }),
  ...(taskId ? { taskId } : {}),
});

test('지갑: 오늘 산 가구, 형편이 어려움 표시, 관리비 줄 없음 (D20)', () => {
  const s = state();
  const m = s.members['backend-dev'];
  if (!m) throw new Error();
  m.hardship = true;
  const w = wallet(s, m);
  expect(w.bought).toBe(400);
  const div = render(s);
  expect(div.querySelector('.hs-hardship')?.textContent).toContain('형편이 어려움');
  expect(div.querySelector('.hs-hardship')?.textContent).toContain('토큰 비용을 다 내지 못해');
  expect(div.textContent).not.toContain('관리비');
  expect(div.querySelector('.hs-list')?.children).toHaveLength(4);
});

test('지갑 줄: 0에는 부호를 붙이지 않는다 ("−0" 아님)', () => {
  const s = state();
  const m = s.members['backend-dev'];
  if (!m) throw new Error();
  for (const f of m.furniture) f.day = -1; // 오늘 산 가구 없음
  s.runs = {};
  m.tokenCostToday = 0;
  const nums = [...render(s).querySelectorAll('.hs-row .hs-num')].map((e) => e.textContent);
  expect(nums).toEqual(['0', '0', '0', '0']); // 오늘 급여 · 오늘 가구 구입 · 자재비 · 토큰 비용
});

test('최근 급여 = 이 팀원 실행의 급여 (D20, 실행 단위): 새 것, 짝지어진 작업이면 작업 이름 · 아니면 에이전트 종류, 오늘 = 마지막 정산 뒤', () => {
  const s = state();
  const m = s.members['backend-dev'];
  if (!m) throw new Error();
  s.economy.history = [
    {
      day: 1,
      at: 1000,
      wages: 0,
      tax: 0,
      purchases: 0,
      tokens: 0,
      leaderTokens: 0,
      leaderUnpaid: 0,
      leaderPurchases: 0,
      materials: 0,
      works: 0,
      fund: 0,
      balances: {},
    },
  ];
  s.runs = {
    old: run('old', 'backend-dev', 500, 100), // 정산 전
    a: run('a', 'backend-dev', 2000, 260),
    b: run('b', 'backend-dev', 3000, 52, 't1'), // Agent 호출 대체 작업과 짝
    other: run('other', 'frontend-dev', 4000, 999),
    live: run('live', 'backend-dev', null), // 아직 안 끝남
  };
  expect(wallet(s, m)).toMatchObject({ today: 312, last: { task: '로그인 폼 입력 검증', n: 52 } });
  const div = render(s);
  expect([...div.querySelectorAll('.hs-row')].map((r) => r.textContent)).toContain('오늘 급여+312');
  expect(div.textContent).toContain('최근: 로그인 폼 입력 검증 +52');
  delete s.runs.b;
  expect(wallet(s, m).last).toEqual({ at: 2000, task: 'backend-dev', n: 260 }); // 짝이 없으면 에이전트 종류
});

test('팀장 집 지갑 = 시청 금고 = 마을 기금 (D21): 기금 · 오늘 세금 · 팀장 토큰값, 적자면 시청 적자', () => {
  const s = state();
  s.economy.fund = 4321;
  s.economy.deficit = true;
  s.economy.today = {
    wages: 45,
    tax: 9,
    purchases: 0,
    tokens: 0,
    leaderTokens: 17,
    leaderUnpaid: 3,
    leaderPurchases: 0,
    materials: 0,
    works: 0,
  };
  const div = render(s, '@leader');
  const card = [...div.querySelectorAll('.hs-card')].find((c) => c.querySelector('.hs-balance'));
  expect(card?.querySelector('.hs-balance')?.textContent).toBe('진주4,321');
  expect(card?.textContent).toContain('시청 금고 = 마을 기금');
  const rows = [...(card?.querySelectorAll('.hs-row') ?? [])].map((r) => r.textContent);
  expect(rows).toContain('세금 · 오늘+9');
  expect(rows).toContain('팀장 토큰값 · 오늘−17');
  expect(rows.join()).not.toContain('오늘 급여'); // 팀장은 급여가 없다
  expect(rows.join()).not.toContain('자재비'); // 팀장은 일터가 없다
  expect(card?.querySelector('.hs-hardship')?.textContent).toContain('시청 적자');
});

test('지갑 자재비 (06 문서 5.3): 오늘 층을 올리며 낸 자재비 (core materialsToday), 팀장 줄은 없음', () => {
  const s = state();
  const m = s.members['backend-dev'];
  if (!m) throw new Error();
  m.materialsToday = 2000; // 같은 날 두 번 오름 (800 + 1,200)
  expect(wallet(s, m).materials).toBe(2000);
  const rows = [...render(s).querySelectorAll('.hs-row')].map((r) => r.textContent);
  expect(rows).toContain('자재비 · 오늘−2,000');
});

test('지갑 토큰 비용 (D11): 오늘 낸 몫과 지금까지 쓴 비용 환산 토큰', () => {
  const s = state();
  Object.assign(s.members['backend-dev'] ?? {}, { tokenCostToday: 25, tokens: 251_000 });
  const div = render(s);
  const rows = [...div.querySelectorAll('.hs-row')].map((r) => r.textContent);
  expect(rows).toContain('토큰 비용 · 오늘−25');
  expect(div.textContent).toContain('지금까지 토큰 25.1만 (비용 환산) · 1천당 진주 1');
});

test('효율 한 줄 (D23, 06 문서 3.6): 일 1점당 토큰 + 순위, 표본이 모자라면 몇 번인지, 팀장은 순위 밖', () => {
  const s = state();
  const recent = (n: number, tokens: number) =>
    Array.from({ length: n }, (_, i) => ({ runId: `r${i}`, tokens, credit: 1 }));
  const m = s.members['backend-dev'];
  if (!m) throw new Error();
  m.eff = { recent: recent(3, 50_000) };
  expect(render(s).textContent).toContain('1점당 5만 · 효율 1위 / 1명');
  m.eff = { recent: recent(2, 50_000) };
  expect(render(s).textContent).toContain('1점당 5만 · 실행 2/3번');
  expect(render(s, '@leader').textContent).toContain('팀장은 효율 순위 밖');
});

test('성격 막대 (01 문서 7장): 점수 자리, 45~55 띠, 바뀌는 중인 축은 라벤더 + "T가 F 쪽으로 38%", 이유 문장', () => {
  const s = state();
  const m = s.members['backend-dev'];
  if (!m) throw new Error();
  const axes = (div: Element) => [...div.querySelectorAll<HTMLElement>('.hs-ax')];
  const marks = (div: Element) => axes(div).map((a) => a.querySelector<HTMLElement>('.hs-ax__mark')?.style.left);

  // 작업 전: 직업 mbtiSeed 씨앗 (roster), 바뀌는 축·이유 없음
  m.personality = seedPersonality('ISTJ');
  const seed = render(s);
  expect(marks(seed)).toEqual(['75%', '25%', '25%', '25%']);
  expect(seed.querySelector('.hs-pers .hs-meta')?.textContent).toBe('직업 기본 성격 · 작업이 끝나면 조금씩 바뀌어요');
  expect(seed.querySelector('.hs-ax--drift, .hs-reason, .hs-drift')).toBeNull();
  expect(seed.textContent).not.toContain('임시 값');
  document.body.innerHTML = '';

  m.personality = {
    ...m.personality,
    EI: 72,
    SN: 28,
    TF: 49.6,
    JP: 26,
    letters: 'ISTJ', // TF 49.6은 띠 안 → 글자 그대로 T
    drifting: { axis: 'TF', toward: 'F', percent: 38 },
    reason: '리뷰 코멘트에 칭찬이 늘어서',
    samples: [{ taskId: 't1', at: 0, EI: null, SN: null, TF: 80, JP: null }],
  };
  const div = render(s);
  const ax = axes(div);
  expect(ax.map((a) => a.dataset.axis)).toEqual(['EI', 'SN', 'TF', 'JP']);
  expect(marks(div)).toEqual(['72%', '28%', '49.6%', '26%']);
  // 양 끝 글자, 띠 = cfg.personality.flipHysteresis
  expect(ax.map((a) => [...a.children].map((c) => c.textContent).filter((x) => x.length === 1))).toEqual([
    ['E', 'I'],
    ['S', 'N'],
    ['T', 'F'],
    ['J', 'P'],
  ]);
  const band = ax[0]?.querySelector<HTMLElement>('.hs-ax__band')?.style;
  expect([band?.left, band?.width]).toEqual(['45%', '10%']);
  // 바뀌는 중인 축만 라벤더 + 한 줄, 읽는 이름에도
  expect(ax.filter((a) => a.classList.contains('hs-ax--drift')).map((a) => a.dataset.axis)).toEqual(['TF']);
  expect(div.querySelector('.hs-ax__drift')?.textContent).toBe('T가 F 쪽으로 38%');
  expect(ax.map((a) => a.getAttribute('aria-label'))).toEqual([
    'E 쪽 28 · I 쪽 72',
    'S 쪽 72 · N 쪽 28',
    'T 쪽 50 · F 쪽 50 · T가 F 쪽으로 38%',
    'J 쪽 74 · P 쪽 26',
  ]);
  expect(div.querySelector('.hs-mbti .hs-drift')?.textContent).toBe('T');
  expect(div.querySelector('.hs-profile .ui-chip--mbti')?.getAttribute('aria-label')).toBe(
    '성격 ISTJ, T가 F 쪽으로 38%',
  );
  expect(div.querySelector('.hs-reason')?.textContent).toBe('리뷰 코멘트에 칭찬이 늘어서');
  expect(div.querySelector('.hs-pers .hs-meta')?.textContent).toBe('최근 작업 20개로 계산 · 하루 최대 2%');
});

test('프로필: 동물 이름, 자동 변형이면 염색 이름이 앞에 (D16)', () => {
  const s = state();
  const m = s.members['backend-dev'];
  if (!m) throw new Error();
  m.variant = 0;
  expect(render(s).querySelector('.hs-profile .hs-animal')?.textContent).toBe('점박이물범');
  document.body.innerHTML = '';
  m.variant = 1;
  const name = render(s).querySelector('.hs-profile .hs-animal')?.textContent ?? '';
  expect(name).toMatch(/ 점박이물범$/);
  expect(name).not.toBe('점박이물범');
});

test('옮기기 모드를 오가도 포커스가 body로 안 떨어진다: 들어가면 첫 가구, 취소·저장하면 가구 옮기기', async () => {
  vi.stubGlobal('fetch', async () => new Response(null, { status: 204 }));
  const div = render(state());
  act(() => button(div, '가구 옮기기').click());
  expect(document.activeElement).toBe(div.querySelector('.rs button'));
  act(() => button(div, '취소').click());
  expect(document.activeElement).toBe(button(div, '가구 옮기기'));
  act(() => button(div, '가구 옮기기').click());
  key(item(div, 'f2'), 'ArrowDown');
  await act(async () => button(div, '저장').click());
  expect(document.activeElement).toBe(button(div, '가구 옮기기'));
});

test('입주 전 팀원의 집 (01 문서 3.3): 빈 방 + "처음 일하면 집을 지어요" 안내, 방에 캐릭터 없음', () => {
  const s = state();
  const m = s.members['frontend-dev'];
  if (!m) throw new Error();
  m.movedInAt = null;
  const div = document.body.appendChild(document.createElement('div'));
  const root = createRoot(div);
  act(() => root.render(h(HouseScreen, { state: s, cfg, projectId: 'p', memberId: 'frontend-dev', onBack: () => {} })));
  expect(div.querySelector('.hs-notyet')?.textContent).toContain('처음 일하면 집을 지어요');
  expect(div.querySelector('.hs-room [data-asset-id$=".rest"]')).toBeNull();
  act(() => root.unmount());
});

test('토큰 영수증 (D13, 01 문서 6.7): 큰 원인 5개 + 그 밖, 모델 비중, 줄이는 법, 팀장은 대화 크기 게이지', () => {
  const s = state();
  const bd = s.members['backend-dev'];
  const leader = s.members['@leader'];
  if (!bd || !leader) throw new Error();
  expect(render(s).querySelector('.hs-receipt')?.textContent).toContain('아직 영수증이 없어요');
  bd.receipt = {
    parts: { 'tool:Bash': 50_000, base: 20_000, talk: 15_000, output: 10_000, rebuild: 3_000, 'tool:Read': 2_000 },
    runs: 2,
    calls: 10,
    models: { 'claude-opus-5-5': 75_000, 'claude-haiku-4-5-20251001': 25_000 },
  };
  const card = render(s).querySelector('.hs-receipt');
  expect([...(card?.querySelectorAll('.hs-rc li') ?? [])].map((li) => li.textContent)).toEqual([
    'Bash 결과5만 · 50%',
    '기본 맥락2만 · 20%',
    '대화 누적1.5만 · 15%',
    '출력1만 · 10%',
    '캐시 재작성3천 · 3%',
    '그 밖 1가지2천 · 2%',
  ]);
  expect(card?.textContent).toContain('지금까지 · 실행 2번 · 호출 10번');
  expect(card?.textContent).toContain('모델 · opus-5-5 75%, haiku-4-5 25%');
  expect([...(card?.querySelectorAll('.hs-tips li') ?? [])].map((li) => li.textContent)).toEqual([
    'Bash 결과가 50% · 명령 출력을 줄이기 (head·grep·조용한 옵션)',
    '짧은 일이 대부분이에요 (실행당 호출 5번) · 에이전트 md에 model: sonnet 또는 haiku를 써 보세요',
  ]);
  // 팀장: 대화 크기 게이지 + 기준을 넘으면 경고 줄
  leader.receipt = { parts: { talk: 90, base: 10 }, runs: 3, calls: 30, models: { 'claude-opus-5-5': 100 } };
  s.mainCtx = { sessionId: 's', tokens: 250_000, perCall: 12_500, at: 0, warned: true };
  const lc = render(s, '@leader').querySelector('.hs-receipt');
  expect(lc?.textContent).toContain('지금 대화 크기 25만 · 호출마다 약 1.3만씩 다시 읽어요');
  expect(lc?.querySelector('.hs-warn')?.textContent).toContain('기준(20만)을 넘었어요');
  expect(lc?.querySelector('.hs-tips')?.textContent).toContain('대화가 길어요 — /compact 하거나 새 세션으로');
});
