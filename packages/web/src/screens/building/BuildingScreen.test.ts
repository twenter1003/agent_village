// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement as h, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { defaultConfig as cfg, type VillageState } from '@tycoon/core';
import { BuildingScreen, FloorSteps } from './BuildingScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const golden = () =>
  JSON.parse(
    readFileSync(join(import.meta.dirname, '../../../../../fixtures/sample-session.golden.json'), 'utf8'),
  ) as VillageState;

function render(el: ReactElement) {
  const div = document.body.appendChild(document.createElement('div'));
  const root = createRoot(div);
  act(() => root.render(el));
  return { div, unmount: () => act(() => root.unmount()) };
}
const button = (root: Element, label: string) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(golden().clock.now);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

/** 층 문턱은 설정값 (06 문서 5.3, ×10 = D31): 2층·3층 일 점수 */
const [TWO, THREE] = [cfg.workplace.levels[1]?.points ?? 0, cfg.workplace.levels[2]?.points ?? 0];
const fmt = (n: number) => n.toLocaleString('ko-KR');

const open = (s: VillageState, id: string) =>
  render(h(BuildingScreen, { state: s, cfg, projectId: 'p', buildingId: id, onBack: () => {} }));

test('층 스텝: 1층·2층·3층·큰 건물, 지금 층이 현재 칸, 공사 중(0층)이면 현재 칸 없음', () => {
  [0, 1, 2, 3, 4].forEach((floor) => {
    const r = render(h(FloorSteps, { floor }));
    const cur = r.div.querySelectorAll('[aria-current="step"]');
    expect(cur).toHaveLength(floor === 0 ? 0 : 1);
    if (floor) expect(cur[0]?.textContent).toContain(['1층', '2층', '3층', '큰 건물'][floor - 1]);
    expect(r.div.querySelectorAll('.bd-step--done')).toHaveLength(Math.max(0, floor - 1));
    r.unmount();
  });
});

test('골든 qa-reviewer 1층 일터: 기본 이름·주인·게이지·다음 층 조건·최근 일·쌓은 일', () => {
  const s = golden();
  const r = open(s, 'w1:qa-reviewer');
  expect(r.div.querySelector('h1')?.textContent).toBe('qa-reviewer의 초소');
  expect(r.div.querySelector('.ui-chip--status')?.textContent).toBe('1층');
  expect(r.div.querySelector('.bd-owner')?.textContent).toBe('초소 · 주인qa-reviewer');
  expect(r.div.querySelector('[aria-current="step"]')?.textContent).toContain('1층');
  expect(r.div.querySelector('.bd-count')?.textContent).toBe(`일 점수 3 / ${fmt(TWO)}`); // 도구 3번 × 테스트 통과 1.2 = 3.6 → 내림
  expect(
    [...r.div.querySelectorAll('.bd-cond')].map((e) => [e.getAttribute('data-cond'), e.getAttribute('data-ok')]),
  ).toEqual([
    ['points', 'false'],
    ['cost', 'false'],
    ['level', 'true'],
  ]);
  expect(r.div.querySelector('[data-waiting]')).toBeNull();
  expect(r.div.querySelectorAll('.bd-task')).toHaveLength(1);
  expect(r.div.querySelector('.bd-task__subject')?.textContent).toBe('로그인 폼 입력 검증');
  expect(r.div.querySelector('[data-contrib]')?.textContent).toBe('실행 1번 · 일 점수 3 · 자재비 0');
  // 조건 ✓/✗는 화면 읽기에도 (충족/부족)
  expect([...r.div.querySelectorAll('.bd-cond [role="img"] > title')].map((e) => e.textContent)).toEqual([
    '부족',
    '부족',
    '충족',
  ]);
  // 그림 간판 대신 주인 얼굴 간판 (06 문서 7장, 마을과 같게)
  expect(r.div.querySelector('[data-floor="1"] [data-owner-sign="qa-reviewer"]')).not.toBeNull();
  expect(r.div.querySelector('[data-floor="1"] [data-asset-id="sign.guard"]')).toBeNull();
  expect(r.div.querySelectorAll('[data-actor]')).toHaveLength(0); // 주인은 쉬는 중
  r.unmount();
});

test('공사 중(0층) 일터: 첫 일 안내, 주인이 현장에 (막힌 backend-dev), 기초 + 자재', () => {
  const r = open(golden(), 'w1:backend-dev');
  expect(r.div.querySelector('h1')?.textContent).toBe('backend-dev의 공방');
  expect(r.div.querySelector('.ui-chip--status')?.textContent).toBe('공사 중');
  expect(r.div.querySelector('[aria-current="step"]')).toBeNull();
  expect(r.div.textContent).toContain('첫 일이 끝나면 1층이 올라가요');
  expect([...r.div.querySelectorAll('[data-actor]')].map((e) => e.getAttribute('data-actor'))).toEqual(['backend-dev']);
  expect(r.div.querySelector('[data-floor="0"] [data-asset-id="site.foundation"]')).not.toBeNull();
  expect(r.div.querySelector('[data-asset-id="prop.materials"]')).not.toBeNull();
  expect(r.div.querySelector('[data-owner-sign]')).toBeNull(); // 0층은 주인 간판 없음 (마을과 같게)
  r.unmount();
});

test('0층은 마을과 같은 그림: 도구를 쓰기 전엔 예정 부지(자재 없음), 쓰면 기초', () => {
  const s = golden();
  Object.assign(s.runs.a3 ?? {}, { toolCalls: 0 });
  const r = open(s, 'w1:backend-dev');
  expect(r.div.querySelector('[data-floor="0"] [data-asset-id="site.planned"]')).not.toBeNull();
  expect(r.div.querySelector('[data-asset-id="prop.materials"]')).toBeNull();
  r.unmount();
});

test('점수는 내림: 문턱 − 0.2점은 "문턱 − 1 / 문턱"·조건 ✗·막대 99% (문턱 전엔 다 찬 것처럼 보이지 않는다)', () => {
  const s = golden();
  Object.assign(s.buildings['w1:qa-reviewer'] ?? {}, { points: TWO - 0.2 });
  const r = open(s, 'w1:qa-reviewer');
  const val = `${fmt(TWO - 1)} / ${fmt(TWO)}`;
  expect(r.div.querySelector('.bd-count')?.textContent).toBe(`일 점수 ${val}`);
  expect(r.div.querySelector('.bd-cond[data-cond="points"]')?.getAttribute('data-ok')).toBe('false');
  expect(r.div.querySelector('.bd-cond[data-cond="points"] .bd-cond__val')?.textContent).toBe(val);
  expect(r.div.querySelector('.bd-prog [role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('99');
  r.unmount();
});

test('대기 칩: 레벨 모자람 "Lv.4 필요"(조건 레벨 ✗), 자재비 모자람 "자재비 대기"', () => {
  const s = golden();
  Object.assign(s.buildings['w1:qa-reviewer'] ?? {}, { floor: 2, points: THREE + 50, waiting: 'level' });
  const r = open(s, 'w1:qa-reviewer');
  expect(r.div.querySelector('[data-waiting="level"]')?.textContent).toBe('Lv.4 필요');
  expect(r.div.querySelector('.bd-cond[data-cond="level"]')?.getAttribute('data-ok')).toBe('false');
  expect(r.div.querySelector('.bd-count')?.textContent).toBe(`일 점수 ${fmt(THREE + 50)} / ${fmt(THREE)}`);
  r.unmount();
  Object.assign(s.buildings['w1:qa-reviewer'] ?? {}, { floor: 1, points: TWO + 5, waiting: 'materials' });
  const m = open(s, 'w1:qa-reviewer');
  expect(m.div.querySelector('[data-waiting="materials"]')?.textContent).toBe('자재비 대기');
  m.unmount();
});

test('층이 오른 반짝임은 floorAt부터 정확히 completeFxMs — 1초 시계를 기다리지 않는다', () => {
  const s = golden();
  const w = s.buildings['w1:qa-reviewer'];
  if (!w) throw new Error('w1:qa-reviewer');
  vi.useRealTimers();
  vi.useFakeTimers();
  vi.setSystemTime((w.floorAt ?? 0) + 500);
  const r = open(s, 'w1:qa-reviewer');
  const fx = () => !!r.div.querySelector('[data-floor="1"] [data-asset-id="fx.complete"]');
  expect(fx()).toBe(true);
  act(() => vi.advanceTimersByTime(cfg.buildings.completeFxMs - 500 - 10));
  expect(fx()).toBe(true);
  act(() => vi.advanceTimersByTime(70));
  expect(fx()).toBe(false);
  r.unmount();
});

test('없는 건물·프로토타입 키(?building=constructor)는 안내 + 마을로', () => {
  const onBack = vi.fn();
  for (const id of ['nope', 'b2', 'constructor', 'toString', '__proto__']) {
    const r = render(h(BuildingScreen, { state: golden(), cfg, projectId: 'p', buildingId: id, onBack }));
    expect(r.div.textContent, id).toContain('건물을 찾을 수 없어요');
    act(() => button(r.div, '마을로').click());
    r.unmount();
  }
  expect(onBack).toHaveBeenCalledTimes(5);
});

test('이름 바꾸기: 버튼 → 입력 → 검사 → PUT, 서버 오류 표시, 저장하면 닫고 포커스 돌려줌', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const r = render(
    h(BuildingScreen, { state: golden(), cfg, projectId: 'p/1', buildingId: 'w1:qa-reviewer', onBack: () => {} }),
  );
  act(() => button(r.div, '이름 바꾸기').click());
  const input = r.div.querySelector('input') as HTMLInputElement;
  expect(input.value).toBe('qa-reviewer의 초소');
  expect(document.activeElement).toBe(input);
  const type = (v: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, v);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  const save = () => act(async () => button(r.div, '저장').click());
  const alert = () => r.div.querySelector('[role="alert"]')?.textContent;

  type('  ');
  await save();
  expect(alert()).toBe('이름은 1~24자로 써 주세요');
  expect(input.getAttribute('aria-invalid')).toBe('true');
  type('가'.repeat(25));
  await save();
  expect(alert()).toBe('이름은 1~24자로 써 주세요');
  expect(fetch).not.toHaveBeenCalled();

  fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: '이름이 너무 길어요' }), { status: 400 }));
  type('로그인 개선');
  await save();
  expect(alert()).toBe('이름을 바꾸지 못했어요 (이름이 너무 길어요)');

  fetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
  await save();
  expect(fetch).toHaveBeenLastCalledWith('/api/projects/p%2F1/buildings/w1%3Aqa-reviewer/name', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '로그인 개선' }),
  });
  expect(r.div.querySelector('input')).toBeNull();
  expect(document.activeElement).toBe(button(r.div, '이름 바꾸기'));

  // Esc = 취소 (요청 없음)
  act(() => button(r.div, '이름 바꾸기').click());
  act(() => {
    r.div.querySelector('input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  expect(r.div.querySelector('input')).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(2);
  r.unmount();
});
