// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement as h, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test } from 'vitest';
import { defaultConfig, type VillageState, type Weather, type WeatherKind } from '@tycoon/core';
import { WeatherButton, weatherReason } from './WeatherButton';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const w = (kind: WeatherKind, o: Partial<Weather> = {}): Weather => ({
  kind,
  runs: 10,
  failures: 0,
  blocked: 0,
  passed: 0,
  ...o,
});

function render(el: ReactElement) {
  const div = document.body.appendChild(document.createElement('div'));
  const root = createRoot(div);
  act(() => root.render(el));
  return { div, unmount: () => act(() => root.unmount()) };
}

test('이유 글자 (06 문서 10장): 실패·막힘, 무지개는 테스트 통과, 잔잔은 쉬는 중', () => {
  expect(weatherReason(w('storm', { failures: 3, blocked: 1 }))).toBe('실패 3번 · 막힘 1명');
  expect(weatherReason(w('cloudy', { blocked: 1 }))).toBe('막힘 1명');
  expect(weatherReason(w('rainbow', { passed: 3 }))).toBe('테스트 통과 3번');
  expect(weatherReason(w('sunny'))).toBe('실패 없이 일하는 중');
  expect(weatherReason(w('calm', { failures: 2 }))).toBe('쉬는 중');
});

test('상태 없음 = 잔잔. 누르면 이유 칸, Esc(포커스는 버튼으로)·바깥 누르기·Tab으로 나가면 닫힘', () => {
  const r = render(h('div', null, h(WeatherButton, { state: null, cfg: defaultConfig }), h('button', { id: 'out' })));
  const btn = r.div.querySelector<HTMLButtonElement>('.tb__weather button');
  const box = () => r.div.querySelector('.tb__weather-box');
  expect([btn?.getAttribute('aria-label'), btn?.getAttribute('aria-expanded')]).toEqual(['잔잔', 'false']);
  act(() => btn?.click());
  expect(box()?.textContent).toContain('쉬는 중');
  expect(r.div.querySelector(`#${CSS.escape(btn?.getAttribute('aria-controls') ?? '')}`)).toBe(box());
  act(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect([box(), document.activeElement]).toEqual([null, btn]);
  act(() => btn?.click());
  act(() => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  expect(box()).toBeNull();
  act(() => btn?.click());
  act(() => r.div.querySelector<HTMLButtonElement>('#out')?.focus());
  expect(box()).toBeNull();
  r.unmount();
});

test('막힌 팀원 2명 + 일하는 중 → 폭풍 이름·이유', () => {
  const s = JSON.parse(
    readFileSync(join(import.meta.dirname, '../../../../fixtures/sample-session.golden.json'), 'utf8'),
  ) as VillageState;
  s.clock.mainTurn = true; // 메인 턴 = 일하는 중 (core activeUntil)
  s.clock.lastEventAt = s.clock.now;
  for (const id of ['backend-dev', 'frontend-dev']) Object.assign(s.members[id] ?? {}, { blocked: 'failures' });
  const r = render(h(WeatherButton, { state: s, cfg: defaultConfig }));
  const btn = r.div.querySelector<HTMLButtonElement>('.tb__weather button');
  expect(btn?.getAttribute('aria-label')).toBe('폭풍');
  act(() => btn?.click());
  expect(r.div.querySelector('.tb__weather-why')?.textContent).toContain('막힘 2명');
  r.unmount();
});
