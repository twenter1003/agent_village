// @vitest-environment happy-dom
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';
import { iso, world } from '../render/iso';
import { Camera, clampZoom, fitZoom } from './Camera';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test('마을 버튼 위에서 끌면 지도가 움직이고 click은 버튼에 가지 않는다. 그냥 누르면 간다', () => {
  const onClick = vi.fn();
  const div = document.body.appendChild(document.createElement('div'));
  const root = createRoot(div);
  act(() => root.render(h(Camera, { worldW: 100, worldH: 100, children: h('button', { onClick, 'data-hit': '' }) })));
  const btn = div.querySelector('[data-hit]') as HTMLButtonElement;
  const layer = btn.parentElement as HTMLElement;
  const ptr = (type: string, x: number, buttons = type === 'pointerup' ? 0 : 1) =>
    act(() => {
      btn.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: 0, pointerId: 1, buttons }));
    });
  const click = () => act(() => void btn.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })));

  const before = layer.style.transform;
  ptr('pointerdown', 0);
  ptr('pointermove', 30);
  ptr('pointerup', 30);
  click();
  expect(layer.style.transform).not.toBe(before);
  expect(onClick).not.toHaveBeenCalled();

  ptr('pointerdown', 30);
  ptr('pointerup', 30);
  click();
  expect(onClick).toHaveBeenCalledTimes(1);

  // 버튼에서 끌다가 마을 밖에서 뗌 (pointerup이 안 옴) → 돌아와 버튼 없이 움직이면 지도는 그대로
  ptr('pointerdown', 30);
  ptr('pointermove', 60);
  const dropped = layer.style.transform;
  ptr('pointermove', 90, 0);
  ptr('pointermove', 120, 0);
  expect(layer.style.transform).toBe(dropped);
  act(() => root.unmount());
});

test('칸 크기가 바뀌면: 손대기 전이면 다시 맞추고, 끌었으면 보던 곳이 가운데에 남는다 (QA 2026-09-30)', () => {
  let resized = () => {};
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: () => void) {
        resized = cb;
      }
      observe() {}
      disconnect() {}
    },
  );
  const div = document.body.appendChild(document.createElement('div'));
  const root = createRoot(div);
  let w = 800;
  const box = () => div.firstElementChild as HTMLElement;
  act(() => root.render(h(Camera, { worldW: 1000, worldH: 500, children: h('i') })));
  Object.defineProperty(box(), 'clientWidth', { get: () => w, configurable: true });
  Object.defineProperty(box(), 'clientHeight', { get: () => 600, configurable: true });
  const layer = () => (box().querySelector('i')?.parentElement as HTMLElement).style.transform;
  act(() => resized()); // 처음 크기를 재는 호출과 같게
  w = 1400;
  act(() => resized());
  // 전체 보기 배율 (fitZoom) → 가운데
  const z = fitZoom(1400, 600, 1000, 500);
  expect(layer()).toBe(`translate(${(1400 - 1000 * z) / 2}px, ${(600 - 500 * z) / 2}px) scale(${z})`);
  // 끌고 나서 넓어지면 절반만큼 옮긴다 (배율 그대로)
  const hit = box();
  act(
    () =>
      void hit.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 0, clientY: 0, buttons: 1 })),
  );
  act(
    () =>
      void hit.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 10, clientY: 0, buttons: 1 })),
  );
  act(() => void hit.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 10, clientY: 0 })));
  const x0 = (1400 - 1000 * z) / 2 + 10;
  w = 1600;
  act(() => resized());
  expect(layer()).toBe(`translate(${x0 + 100}px, ${(600 - 500 * z) / 2}px) scale(${z})`);
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

test('전체 보기 (02 문서 7.5, 2026-10-01): 섬 전체가 늘 보인다 — 80×80 섬이면 0.6 밑으로. 손으로 줄이는 바닥 = min(0.6, 전체 보기)', () => {
  const [cw, ch] = [1080, 640]; // 1440×900 메인 화면의 마을 칸
  for (const M of [16, 24, 40, 56, 80]) {
    const W = world(M);
    const z = fitZoom(cw, ch, W.w, W.h);
    const [tx, ty] = [(cw - W.w * z) / 2, (ch - W.h * z) / 2];
    const at = (x: number, y: number) => {
      const p = iso(x, y, M);
      return { x: tx + p.sx * z, y: ty + p.sy * z };
    };
    // 섬 네 꼭짓점(아래는 옆면 두께 14까지)이 화면 안
    expect(at(0, M).x, `${M} 왼쪽`).toBeGreaterThanOrEqual(0);
    expect(at(M, 0).x, `${M} 오른쪽`).toBeLessThanOrEqual(cw);
    expect(at(0, 0).y, `${M} 위`).toBeGreaterThanOrEqual(0);
    expect(at(M, M).y + 14 * z, `${M} 아래`).toBeLessThanOrEqual(ch + 1e-9);
  }
  expect(fitZoom(cw, ch, world(16).w, world(16).h)).toBeCloseTo(0.98, 2); // 16칸 = 예전과 거의 같은 꽉 참
  expect(fitZoom(cw, ch, world(80).w, world(80).h)).toBeLessThan(0.6);
  expect(fitZoom(4000, 4000, 1200, 700)).toBe(1.6);
  expect(clampZoom(0.1, 0.25)).toBe(0.25); // 큰 섬: 전체 보기까지
  expect(clampZoom(0.1, 0.98)).toBe(0.6); // 작은 섬: 예전 바닥 0.6
  expect(clampZoom(3, 0.98)).toBe(1.6);
});
