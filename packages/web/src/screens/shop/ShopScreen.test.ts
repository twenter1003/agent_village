// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { defaultConfig as cfg, type VillageState } from '@tycoon/core';
import { defaultFabric, ShopScreen } from './ShopScreen';
import { fullVillage } from '../../test/village';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

function state(balance = 300) {
  const s = fullVillage(
    JSON.parse(
      readFileSync(join(import.meta.dirname, '../../../../../fixtures/sample-session.golden.json'), 'utf8'),
    ) as VillageState,
  );
  for (const m of Object.values(s.members)) m.balance = balance;
  return s;
}
function render(s: VillageState, memberId = 'frontend-dev') {
  const div = document.body.appendChild(document.createElement('div'));
  const root = createRoot(div);
  act(() => root.render(h(ShopScreen, { state: s, cfg, projectId: 'p', memberId, onBack: () => {} })));
  return div;
}
const card = (root: Element, kind: string) => root.querySelector(`[data-kind="${kind}"]`) as HTMLElement;
const buyButton = (root: Element) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent?.endsWith('진주에 사기')) as HTMLButtonElement;

test('가격 = 기준가 그대로 (고정, D20): 물가 안내·기준가 ▲▼·관리비 줄 없음', () => {
  const div = render(state());
  expect(card(div, 'armchair').querySelector('.sh-num')?.textContent).toBe('300');
  expect(card(div, 'bed').querySelector('.sh-num')?.textContent).toBe('520');
  expect(div.querySelector('.sh-base')).toBeNull();
  expect(div.querySelector('[data-price]')?.textContent).toBe('300'); // 오른쪽 = 처음 고른 armchair
  expect(div.textContent).not.toMatch(/물가|관리비/);
});

test('팀장이 사면 마을 기금에서 (D21): 사는 사람 칩·잔고 줄이 기금, 모자라면 막힘, 409면 기금이 모자라다고', async () => {
  const s = state();
  const leader = Object.values(s.members).find((m) => m.isLeader);
  if (!leader) throw new Error();
  leader.balance = 0; // 팀장 잔고는 쓰지 않는다
  s.economy.fund = 600;
  let div = render(s, leader.id);
  expect(div.querySelector(`.sh-who[data-member="${leader.id}"]`)?.textContent).toContain(
    `${leader.name} · 마을 기금 600`,
  );
  act(() => (card(div, 'bed').querySelector('.sh-buyrow button') as HTMLButtonElement).click());
  expect(buyButton(div).disabled).toBe(false);
  expect(div.querySelector('.sh-sum')?.textContent).toContain('마을 기금600 → 80');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 409 })),
  );
  await act(async () => buyButton(div).click());
  expect(div.querySelector('[role="alert"]')?.textContent).toBe('마을 기금이 모자라 사지 못했어요');
  document.body.innerHTML = '';
  s.economy.fund = 100;
  div = render(s, leader.id);
  act(() => (card(div, 'bed').querySelector('.sh-buyrow button') as HTMLButtonElement).click());
  expect(buyButton(div).disabled).toBe(true);
  expect(div.querySelector('.sh-short')?.textContent).toBe('진주가 420 모자라요');
});

test('종류 탭: 쉬기·일하기·꾸미기 = furniture.tag', () => {
  const div = render(state());
  const tabs = [...div.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  expect(tabs.map((b) => b.textContent)).toEqual(['전체 8', '쉬기 3', '일하기 2', '꾸미기 3']);
  const kinds = () => [...div.querySelectorAll<HTMLElement>('[data-kind]')].map((e) => e.dataset.kind);
  expect(kinds()).toHaveLength(8);
  act(() => tabs[1]?.click());
  expect(kinds()).toEqual(['armchair', 'lamp', 'bed']);
  expect(tabs[1]?.getAttribute('aria-selected')).toBe('true');
  act(() => tabs[3]?.click());
  expect(kinds()).toEqual(['plant', 'rug', 'flowers']);
});

test('탭·사는 팀원·천 색: 고른 것만 Tab 자리, ←/→/Home/End로 옆 것을 고르고 포커스 (끝에서 돌아감)', () => {
  const div = render(state());
  const key = (el: Element | null | undefined, k: string) =>
    act(() => void el?.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })));
  const tabs = () => [...div.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  expect(tabs().map((b) => b.tabIndex)).toEqual([0, -1, -1, -1]);
  key(tabs()[0], 'ArrowLeft');
  expect(document.activeElement?.textContent).toBe('꾸미기 3');
  expect(tabs().map((b) => b.getAttribute('aria-selected'))).toEqual(['false', 'false', 'false', 'true']);
  key(document.activeElement, 'Home');
  expect(tabs()[0]?.tabIndex).toBe(0);

  const who = () => div.querySelector<HTMLButtonElement>('.sh-who[aria-checked="true"]');
  expect(who()?.tabIndex).toBe(0);
  key(who(), 'ArrowRight');
  expect(document.activeElement).toBe(who());
  expect(who()?.dataset.member).not.toBe('frontend-dev');

  const sw = () => card(div, 'armchair').querySelector<HTMLButtonElement>('.sh-sw[aria-checked="true"]');
  const first = sw()?.getAttribute('aria-label');
  key(sw(), 'End');
  expect(document.activeElement).toBe(sw());
  expect(sw()?.getAttribute('aria-label')).not.toBe(first);
  expect(card(div, 'armchair').querySelectorAll('.sh-sw[tabindex="0"]')).toHaveLength(1);
});

test('잔고가 모자라면 사기 버튼 비활성 + 모자란 만큼, 되면 POST · 409면 안내', async () => {
  const div = render(state(300));
  act(() => (card(div, 'bed').querySelector('.sh-buyrow button') as HTMLButtonElement).click());
  expect(buyButton(div).textContent).toBe('520 진주에 사기');
  expect(buyButton(div).disabled).toBe(true);
  expect(div.querySelector('.sh-short')?.textContent).toBe('진주가 220 모자라요');

  act(() => (card(div, 'plant').querySelector('.sh-buyrow button') as HTMLButtonElement).click());
  expect(buyButton(div).disabled).toBe(false);
  expect(div.querySelector('.sh-short')).toBeNull();

  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{}', { status: 409 }));
  vi.stubGlobal('fetch', fetch);
  await act(async () => buyButton(div).click());
  expect(fetch.mock.calls[0]?.[0]).toBe('/api/projects/p/purchase');
  expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
    memberId: 'frontend-dev',
    kind: 'plant',
    fabric: null,
  });
  expect(div.querySelector('[role="alert"]')?.textContent).toBe('잔고가 모자라 사지 못했어요');
});

test('사는 팀원 바꾸기: 잔고·미리보기 이름이 그 팀원 것', () => {
  const s = state();
  const qa = s.members['qa-reviewer'];
  if (qa) qa.balance = 1000;
  const div = render(s);
  const radios = [...div.querySelectorAll<HTMLButtonElement>('.sh-who')];
  expect(radios.find((b) => b.getAttribute('aria-checked') === 'true')?.dataset.member).toBe('frontend-dev');
  act(() => radios.find((b) => b.dataset.member === 'qa-reviewer')?.click());
  expect(div.querySelector('.sh-side h2')?.textContent).toBe('qa-reviewer의 방에 놓아 보기');
  expect(div.querySelector('.sh-sum')?.textContent).toContain('1,000 → 700');
});

test('천 색 기본값: 아직 없는 색 중 첫째, 천 가구가 아니면 null', () => {
  const m = state().members['frontend-dev'];
  if (!m) throw new Error();
  expect(defaultFabric(m, 'desk', cfg)).toBeNull();
  expect(defaultFabric(m, 'bed', cfg)).toBe('mustard');
  m.furniture.push({ id: 'f1', kind: 'bed', fabric: 'mustard', price: 520, day: 0, by: 'auto', placed: null });
  expect(defaultFabric(m, 'bed', cfg)).toBe('coral');
});
