// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement as h, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';
import { IconButton, MbtiChip, Toast } from './index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function render(el: ReactElement) {
  const div = document.body.appendChild(document.createElement('div'));
  const root = createRoot(div);
  act(() => root.render(el));
  return {
    div,
    rerender: (next: ReactElement) => act(() => root.render(next)),
    unmount: () => act(() => root.unmount()),
  };
}

test('토스트는 duration이 지나면 onDone — 부모가 새 onDone을 줘도 타이머는 그대로', () => {
  vi.useFakeTimers();
  const first = vi.fn();
  const second = vi.fn();
  const r = render(h(Toast, { icon: null, title: '완공', duration: 4000, onDone: first }));
  act(() => vi.advanceTimersByTime(2000));
  r.rerender(h(Toast, { icon: null, title: '완공', duration: 4000, onDone: second }));
  act(() => vi.advanceTimersByTime(1999));
  expect(second).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1));
  expect(second).toHaveBeenCalledOnce();
  expect(first).not.toHaveBeenCalled();
  expect(r.div.querySelector('.ui-toast__bar')?.getAttribute('style')).toContain('4000ms');
  r.unmount();

  const manual = vi.fn();
  const m = render(h(Toast, { icon: null, title: '회의', onDone: manual }));
  act(() => vi.advanceTimersByTime(60_000));
  expect(manual).not.toHaveBeenCalled();
  expect(m.div.querySelector('.ui-toast__bar')).toBeNull();
  m.unmount();
  vi.useRealTimers();
});

test('아이콘 버튼은 aria-label 필수', () => {
  // @ts-expect-error aria-label이 없으면 타입 오류 (M10 접근성)
  const bad = h(IconButton, { icon: null });
  expect(bad).toBeTruthy();
  const r = render(h(IconButton, { icon: null, 'aria-label': '알림 3개', badge: 3 }));
  expect(r.div.querySelector('button')?.getAttribute('aria-label')).toBe('알림 3개');
  expect(r.div.querySelector('.ui-badge')?.textContent).toBe('3');
  r.unmount();
});

test('MBTI 칩: 바뀌는 중인 글자만 라벤더, 이름에 "T가 F 쪽으로 38%" (N은 "N이")', () => {
  const r = render(h(MbtiChip, { letters: 'ISTJ', drifting: { axis: 'TF', toward: 'F', percent: 37.6 } }));
  const chip = () => r.div.querySelector('.ui-chip--mbti');
  const drift = () => [...r.div.querySelectorAll('.ui-mbti-drift')].map((e) => e.textContent);
  expect(chip()?.getAttribute('role')).toBe('img');
  expect(chip()?.getAttribute('aria-label')).toBe('성격 ISTJ, T가 F 쪽으로 38%');
  expect(chip()?.getAttribute('title')).toBe('T가 F 쪽으로 38%');
  expect(drift()).toEqual(['T']);
  r.rerender(h(MbtiChip, { letters: 'ENFP', drifting: { axis: 'SN', toward: 'S', percent: 12 } }));
  expect(chip()?.getAttribute('aria-label')).toBe('성격 ENFP, N이 S 쪽으로 12%');
  expect(drift()).toEqual(['N']);
  r.rerender(h(MbtiChip, { letters: 'ENTJ', drifting: null, sm: true }));
  expect(chip()?.getAttribute('aria-label')).toBe('성격 ENTJ');
  expect(chip()?.hasAttribute('title')).toBe(false);
  expect(drift()).toEqual([]);
  r.unmount();
  // 라벤더 = --slot5-tint 바탕 + --slot5-deep 글자 (03 문서 5장 MBTI 칩)
  const css = readFileSync(join(import.meta.dirname, 'ui.css'), 'utf8');
  expect(css).toMatch(/\.ui-mbti-drift \{[^}]*background: var\(--slot5-tint\);[^}]*color: var\(--slot5-deep\);/);
});

test('버튼 바탕색은 애니메이션하지 않는다 — 비활성 → 활성 주 버튼이 흐리게 번져 보이지 않게 (상점 사기 버튼)', () => {
  const css = readFileSync(join(import.meta.dirname, 'ui.css'), 'utf8');
  const transition = /\.ui-btn \{[^}]*transition:([^;]*);/.exec(css)?.[1];
  expect(transition).toContain('transform');
  expect(transition).not.toContain('background');
});
