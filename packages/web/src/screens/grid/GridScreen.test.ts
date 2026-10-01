// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { defaultConfig as cfg, type Building, type VillageState } from '@tycoon/core';
import { GridScreen, type GridTarget } from './GridScreen';
import { fullVillage } from '../../test/village';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  document.body.innerHTML = '';
});

const wp = (b: Partial<Building> & Pick<Building, 'id' | 'memberId' | 'floor'>): Building => ({
  n: 1,
  name: '',
  lot: { x: 13, y: 13, size: 3 },
  points: 0,
  paid: 0,
  waiting: null,
  startedAt: 0,
  floorAt: null,
  ...b,
});
/** 골든(qa-reviewer 1층 · backend-dev 공사 중) + frontend-dev 2층 "Lv.4 필요". qa-reviewer는 떠남, backend-dev는 가구 2개(1개 배치) */
function state() {
  const s = fullVillage(
    JSON.parse(
      readFileSync(join(import.meta.dirname, '../../../../../fixtures/sample-session.golden.json'), 'utf8'),
    ) as VillageState,
  );
  s.buildings['w1:frontend-dev'] = wp({
    id: 'w1:frontend-dev',
    memberId: 'frontend-dev',
    floor: 2,
    points: (cfg.workplace.levels[2]?.points ?? 0) + 50, // 3층 문턱(설정값) 넘김 → 게이지 다 참, 레벨 대기
    waiting: 'level',
    name: '결제 카페',
  });
  const m = s.members;
  Object.assign(m['qa-reviewer'] ?? {}, { departed: true });
  (m['backend-dev'] ?? { furniture: [] }).furniture = [
    { id: 'f1', kind: 'bed', fabric: null, price: 100, day: 0, by: 'user', placed: { x: 0, y: 0, rot: 0 } },
    { id: 'f2', kind: 'lamp', fabric: null, price: 100, day: 0, by: 'user', placed: null },
  ];
  return s;
}
function render(s: VillageState, onOpen: (v: GridTarget) => void = () => {}) {
  const div = document.body.appendChild(document.createElement('div'));
  const root = createRoot(div);
  const hrefOf = (v: GridTarget) => `/?project=p&${v.screen}=${v.id}`;
  act(() => root.render(h(GridScreen, { state: s, cfg, hrefOf, onOpen })));
  return div;
}
const texts = (root: Element, sel: string) => [...root.querySelectorAll(sel)].map((e) => e.textContent ?? '');

test('팀원 집: 집 있는 팀원마다 카드(슬롯 순), 제목·가구·잔고, 떠난 팀원은 흐리게', () => {
  const div = render(state());
  const cards = [...div.querySelectorAll('a[data-house]')] as HTMLAnchorElement[];
  expect(cards.map((c) => c.dataset.house)).toEqual(['@leader', 'backend-dev', 'frontend-dev', 'qa-reviewer']);
  expect(texts(div, 'a[data-house] .gs-card__name')).toEqual([
    '팀장의 집',
    'backend-dev의 집',
    'frontend-dev의 집',
    'qa-reviewer의 집',
  ]);
  expect(texts(div, 'h2')).toEqual(['팀원 집', '팀원 일터']);
  expect(div.querySelector('.gs__head .gs-meta')?.textContent).toBe('4채 · 급여(진주)로 가구를 사서 꾸미는 개인 공간');
  expect(cards[1]?.textContent).toContain('가구 2개 · 1개 배치');
  expect(cards[1]?.textContent).toContain('막힘 · 권한 요청'); // 팀원 카드와 같은 상태 글자
  expect(cards[3]?.textContent).toContain('떠난 팀원');
  expect(cards[3]?.style.opacity).toBe('0.55');
  expect(cards[0]?.style.opacity).toBe('');
  expect(cards[0]?.querySelector('[data-asset-id="body.shell-1f"]')).not.toBeNull(); // 집 그림
});

test('팀원 일터: 곳 수·공사 중·대기, 1층 이상은 카드(부지 잡은 순)·층·게이지·대기, 공사 중은 점선 칩', () => {
  const div = render(state());
  expect(div.querySelectorAll('.gs__head .gs-meta')[1]?.textContent).toBe('3곳 · 공사 중 1 · 대기 1');
  const cards = [...div.querySelectorAll('a.gs-card[data-building]')] as HTMLAnchorElement[];
  expect(cards.map((c) => c.dataset.building)).toEqual(['w1:frontend-dev', 'w1:qa-reviewer']);
  const [fe, qa] = cards;
  expect(fe?.querySelector('.gs-card__name')?.textContent).toBe('결제 카페');
  expect(fe?.querySelector('.ui-chip--job')?.textContent).toBe('카페');
  expect(fe?.querySelector('.gs-end')?.textContent).toBe('2층');
  expect(fe?.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('100');
  expect(fe?.querySelector('[data-waiting]')?.textContent).toBe('Lv.4 필요');
  expect(fe?.querySelector('.gs-faces')?.getAttribute('aria-label')).toBe('주인 frontend-dev'); // 이름을 바꿔도 주인은 읽힌다
  expect(fe?.querySelector('.gs-card__illo [data-owner-sign="frontend-dev"]')).not.toBeNull(); // 마을처럼 얼굴 간판
  expect(fe?.querySelector('.gs-card__illo [data-asset-id="sign.cafe"]')).toBeNull();
  expect(qa?.querySelector('.gs-card__name')?.textContent).toBe('qa-reviewer의 초소');
  expect(qa?.style.opacity).toBe('0.55'); // 떠난 팀원
  expect(texts(div, 'a.gs-chip')).toEqual(['공사 중 · backend-dev의 공방']);
});

test('링크: 주소 = hrefOf, 보통 클릭만 onOpen + 기본 동작 막기. Ctrl·Cmd 클릭은 브라우저에', () => {
  const onOpen = vi.fn();
  const div = render(state(), onOpen);
  const house = div.querySelector('a[data-house="backend-dev"]') as HTMLAnchorElement;
  const chip = div.querySelector('a.gs-chip[data-building="w1:backend-dev"]') as HTMLAnchorElement;
  expect(house.getAttribute('href')).toBe('/?project=p&house=backend-dev');
  expect(chip.getAttribute('href')).toBe('/?project=p&building=w1:backend-dev');

  // 막았는지는 문서까지 올라온 뒤에 보고, 시험 환경이 실제로 이동하지 않게 여기서 막는다
  let prevented: boolean[] = [];
  const seen = (e: Event) => {
    prevented.push(e.defaultPrevented);
    e.preventDefault();
  };
  document.addEventListener('click', seen);
  const click = (el: Element, init: MouseEventInit = {}) =>
    act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init })));

  click(house);
  click(chip);
  expect(onOpen.mock.calls).toEqual([
    [{ screen: 'house', id: 'backend-dev' }],
    [{ screen: 'building', id: 'w1:backend-dev' }],
  ]);
  expect(prevented).toEqual([true, true]);

  onOpen.mockClear();
  prevented = [];
  click(house, { ctrlKey: true });
  click(house, { metaKey: true });
  click(house, { button: 1 });
  expect(onOpen).not.toHaveBeenCalled();
  expect(prevented).toEqual([false, false, false]);
  document.removeEventListener('click', seen);
});

test('빈 마을: 집·일터 없음 안내', () => {
  const s = state();
  s.houses = {};
  s.buildings = {};
  const div = render(s);
  expect(texts(div, '.gs-empty')).toEqual(['아직 집이 없어요', '아직 일터가 없어요. 팀원이 처음 일하면 부지가 생겨요']);
  expect(div.querySelector('a')).toBeNull();
});
