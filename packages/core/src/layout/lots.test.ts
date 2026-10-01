import { expect, test } from 'vitest';
import { findLot, isPlaza, isRoad, lotTiles, PLAZA_RIM, roadsideSpots, zoneOf, type Lot } from './lots';

test('길과 광장', () => {
  expect(isRoad(7, 0)).toBe(true);
  expect(isRoad(0, 8)).toBe(true);
  expect(isRoad(6, 6)).toBe(false);
  expect(isPlaza(6, 6) && isPlaza(9, 9) && !isPlaza(10, 9)).toBe(true);
});

test('구역을 채울 때 겹치지 않고 1칸 간격, 구역 밖으로 안 나감', () => {
  for (const zone of ['north', 'west', 'south', 'east'] as const) {
    const lots: Lot[] = [];
    for (let l = findLot(zone, lots); l; l = findLot(zone, lots)) lots.push(l);
    expect(lots.length).toBeGreaterThanOrEqual(3);
    for (const a of lots)
      for (const b of lots)
        if (a !== b) expect(Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))).toBeGreaterThanOrEqual(3);
  }
});

test('첫 부지는 광장에 가장 가깝다', () => {
  expect(findLot('south', [])).toEqual({ x: 10, y: 10 });
  expect(findLot('north', [])).toEqual({ x: 4, y: 4 });
});

test('3×3 부지 (06 문서 5.1): 남쪽 첫 자리는 광장에 가장 가까운 (10, 10), 1칸 띄워야 해서 ring 0 남쪽엔 하나뿐, 동쪽은 (10, 3)', () => {
  expect(findLot('south', [], 0, 3)).toEqual({ x: 10, y: 10, size: 3 });
  expect(findLot('south', [{ x: 10, y: 10, size: 3 }], 0, 3)).toBeNull();
  expect(findLot('east', [], 0, 3)).toEqual({ x: 10, y: 3, size: 3 });
  expect(lotTiles({ x: 10, y: 10, size: 3 })).toHaveLength(9);
  expect(lotTiles({ x: 1, y: 1 })).toEqual([
    [1, 1],
    [2, 1],
    [1, 2],
    [2, 2],
  ]);
});

test('크기가 섞여도 겹치지 않고 1칸 이상 떨어진다 (ring 2, 3×3과 2×2 번갈아)', () => {
  const lots: Lot[] = [];
  for (let i = 0; i < 12; i++) {
    const l = findLot('south', lots, 2, i % 2 ? 2 : 3);
    if (l) lots.push(l);
  }
  expect(lots.length).toBeGreaterThan(4);
  for (const a of lots)
    for (const b of lots) {
      if (a === b) continue;
      const touch = lotTiles(a).some(([ax, ay]) =>
        lotTiles(b).some(([bx, by]) => Math.abs(ax - bx) <= 1 && Math.abs(ay - by) <= 1),
      );
      expect(touch, `${JSON.stringify(a)} ${JSON.stringify(b)}`).toBe(false);
    }
});

test('공공시설 자리 (06 문서 6.2·6.4): 길가·광장 둘레는 길·광장이 아니고 부지 구역 밖이다. 섬을 넓히면 길가가 늘어난다', () => {
  expect(roadsideSpots(0).slice(0, 8)).toEqual([
    [6, 4],
    [9, 4],
    [11, 6],
    [11, 9],
    [9, 11],
    [6, 11],
    [4, 9],
    [4, 6],
  ]);
  expect([roadsideSpots(0).length, roadsideSpots(1).length, roadsideSpots(8).length]).toEqual([16, 24, 80]);
  const all = [...roadsideSpots(8), ...PLAZA_RIM];
  expect(new Set(all.map(String)).size).toBe(all.length);
  for (const [x, y] of all) {
    expect(isRoad(x, y) || isPlaza(x, y), `${x},${y}`).toBe(false);
    expect((x < 6 || x >= 10) && (y < 6 || y >= 10), `${x},${y} 구역 안`).toBe(false);
    expect(x >= -32 && y >= -32 && x < 48 && y < 48, `${x},${y} 섬 밖`).toBe(true);
  }
  const lots: Lot[] = [
    { x: 3, y: 3, size: 3 },
    { x: 0, y: 12 },
    { x: 10, y: 10, size: 3 },
    { x: 12, y: 0 },
  ];
  expect(lots.map(zoneOf)).toEqual(['north', 'west', 'south', 'east']);
});
