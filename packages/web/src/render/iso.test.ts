import { expect, test } from 'vitest';
import { byDepth, iso, unIso, world } from './iso';

test('캔버스 바다 09와 같은 원점', () => {
  expect(world(16)).toEqual({ ox: 600, oy: 150, w: 1200, h: 700 });
  expect(iso(0, 0)).toEqual({ sx: 600, sy: 150 });
  expect(iso(16, 0)).toEqual({ sx: 1112, sy: 406 });
  expect(iso(8, 8)).toEqual({ sx: 600, sy: 406 });
});

test('깊이: 아래(앞)가 나중, 같으면 왼쪽 먼저', () => {
  const s = [
    { d: 5, sx: 1 },
    { d: 3, sx: 9 },
    { d: 5, sx: 0 },
  ].sort(byDepth);
  expect(s).toEqual([
    { d: 3, sx: 9 },
    { d: 5, sx: 0 },
    { d: 5, sx: 1 },
  ]);
});

test('화면 → 타일 (iso 거꾸로)', () => {
  for (const [x, y, m] of [
    [0, 0, 16],
    [3.25, 11.5, 16],
    [20, 2, 24],
  ] as const) {
    const c = iso(x, y, m);
    const back = unIso(c.sx, c.sy, m);
    expect(back.x).toBeCloseTo(x);
    expect(back.y).toBeCloseTo(y);
  }
});
