// @vitest-environment happy-dom
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test } from 'vitest';
import { DEPARTED_OPACITY, staticEnts } from './Village';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test('떠난 팀원 집: 몸·지붕·간판 모두 흐리게 (01 문서 3.1-5)', () => {
  const house = { x: 4, y: 10, body: 'shell-1f', roof: 'dome', sign: 'home', slot: 1 as const };
  const [gone, here] = staticEnts([{ ...house, departed: true }, house], [], 16);
  const div = document.body.appendChild(document.createElement('div'));
  const root = createRoot(div);
  act(() => root.render(h('svg', null, gone?.el, here?.el)));
  const [a, b] = [...div.querySelectorAll(':scope > svg > g')];
  expect(a?.getAttribute('opacity')).toBe(String(DEPARTED_OPACITY));
  expect(b?.hasAttribute('opacity')).toBe(false);
  // 층마다 따로 흐리게 하지 않는다 (ghost는 지붕 미리보기용)
  expect([...(a?.querySelectorAll('[opacity]') ?? [])].map((e) => e.getAttribute('opacity'))).toEqual(['1']);
  act(() => root.unmount());
});
