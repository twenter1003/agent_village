// @vitest-environment happy-dom
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, test } from 'vitest';
import { defaultConfig as cfg } from '@tycoon/core';
import {
  cellAt,
  cellsOf,
  depthSort,
  furnitureAsset,
  restCell,
  roomBox,
  RoomScene,
  toRoom,
  type RoomItem,
} from './RoomScene';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  document.body.innerHTML = '';
});

/** z-index 순서 (그리는 순서) */
const byDepth = (root: Element, sel: string) =>
  [...root.querySelectorAll<HTMLElement>(sel)]
    .sort((a, b) => Number(a.style.zIndex) - Number(b.style.zIndex))
    .map((e) => e.dataset.fid ?? 'who');

const item = (
  id: string,
  kind: string,
  x: number,
  y: number,
  rot: 0 | 1 = 0,
  fabric: string | null = null,
): RoomItem => ({
  id,
  kind,
  fabric,
  placed: { x, y, rot },
});

test('2×1 차지 칸: rot 0은 x쪽, rot 1은 y쪽 (01 문서 8.4), 1×1은 한 칸', () => {
  expect(cellsOf('bed', { x: 1, y: 2, rot: 0 }, cfg)).toEqual([
    [1, 2],
    [2, 2],
  ]);
  expect(cellsOf('bed', { x: 1, y: 2, rot: 1 }, cfg)).toEqual([
    [1, 2],
    [1, 3],
  ]);
  expect(cellsOf('desk', { x: 4, y: 4, rot: 0 }, cfg)).toEqual([[4, 4]]);
});

test('칸 ↔ 방 좌표: 칸 가운데를 되돌리면 같은 칸', () => {
  for (const [x, y] of [
    [0, 0],
    [5, 0],
    [0, 5],
    [3, 2],
    [5, 5],
  ] as const) {
    const { sx, sy } = toRoom(x + 0.5, y + 0.5);
    expect(cellAt(sx, sy)).toEqual({ x, y });
  }
  expect(cellAt(0, -1).x + cellAt(0, -1).y).toBeLessThan(0); // 뒤 모서리 위 = 방 밖
});

test('깊이: 바닥 층(러그) 먼저, 그다음 차지 칸 가운데 x+y (캔버스 15 배치)', () => {
  const order = depthSort([
    { u: 5.5, v: 1.5, n: 'coralpot' },
    { u: 3, v: 2.5, n: 'rug', floor: true },
    { u: 1.5, v: 0.5, n: 'shelf' },
    { u: 4, v: 0.5, n: 'bed' },
    { u: 0.5, v: 2.5, n: 'desk' },
  ]).map((d) => d.n);
  expect(order).toEqual(['rug', 'shelf', 'desk', 'bed', 'coralpot']);
});

test('바다 에셋: 가구 표 + 꽃밭은 prop.anemone', () => {
  expect(furnitureAsset('armchair')).toBe('furniture.clamchair');
  expect(furnitureAsset('bookcase')).toBe('furniture.shelf');
  expect(furnitureAsset('flowers')).toBe('prop.anemone');
});

test('쉬는 자리: 빈 칸 중 가운데(3,3)에 가까운 칸', () => {
  expect(restCell([], cfg)).toEqual([3, 3]);
  expect(restCell([item('a', 'bed', 2, 3)], cfg)).not.toEqual([3, 3]); // (2,3)(3,3) 차지
});

test('RoomScene: 그리는 순서 = 깊이, 돌린 2×1은 기준점(차지 칸 가운데)에서 좌우 반전, 천 색 = 슬롯 색', () => {
  const S = 1.6;
  const items = [
    item('pot', 'plant', 5, 1),
    item('bed', 'bed', 0, 3, 1, 'blue'), // (0,3)(0,4) 차지, 가운데 (0.5, 4)
    item('rug', 'rug', 2, 2, 0, 'green'),
    item('shelf', 'bookcase', 1, 0),
  ];
  const div = document.body.appendChild(document.createElement('div'));
  const root = createRoot(div);
  act(() => root.render(h(RoomScene, { cfg, items, scale: S, label: '방' })));
  const drawn = [...div.querySelectorAll<HTMLElement>('[data-fid]')];
  expect(drawn.map((e) => e.dataset.fid)).toEqual(['pot', 'bed', 'rug', 'shelf']); // DOM은 받은 순서 그대로
  expect(byDepth(div, '[data-fid]')).toEqual(['rug', 'shelf', 'bed', 'pot']); // 깊이 = z-index. bed x+y 4.5 < pot 7

  const bed = drawn.find((e) => e.dataset.fid === 'bed');
  const { ox, oy } = roomBox();
  const c = toRoom(0.5, 4);
  expect(bed?.style.transform).toBe('scaleX(-1)');
  expect(parseFloat(bed?.style.left ?? '')).toBeCloseTo((ox + c.sx) * S - 64 * S); // 2×1 기준점 64,168
  expect(parseFloat(bed?.style.top ?? '')).toBeCloseTo((oy + c.sy) * S - 168 * S);
  expect(drawn.find((e) => e.dataset.fid === 'rug')?.style.transform).toBe('');
  expect(bed?.querySelector('[data-asset-id="furniture.clambed"]')).not.toBeNull();
  expect(bed?.innerHTML).toContain('#6f97d8'); // blue = slot1
  expect(div.querySelector('button')).toBeNull(); // 보기 모드는 버튼 없음
  act(() => root.unmount());
});

test('RoomScene: 쉬는 팀원은 빈 칸에, 깊이 순서 안에 들어간다', () => {
  const div = document.body.appendChild(document.createElement('div'));
  const root = createRoot(div);
  const items = [item('front', 'plant', 5, 5), item('back', 'plant', 0, 0)];
  act(() =>
    root.render(
      h(RoomScene, { cfg, items, scale: 1, label: '방', who: { species: 'seal', accessory: 'none', pose: 'rest' } }),
    ),
  );
  expect(byDepth(div, '[data-fid], .rs-who')).toEqual(['back', 'who', 'front']);
  expect(div.querySelector<HTMLElement>('.rs-who')?.dataset.cell).toBe('3,3');
  act(() => root.unmount());
});
