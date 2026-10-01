import { expect, test } from 'vitest';
import { fishPositions, streamBubbles } from './WaterFx';

test('물고기 떼는 왼쪽으로 가고 반복된다', () => {
  expect(fishPositions(1, 1200)[0]?.x).toBeLessThan(fishPositions(0, 1200)[0]?.x ?? 0);
  const loopTicks = 1750 / (2.5 * 0.75);
  expect(fishPositions(Math.round(loopTicks * 3), 1200)[0]?.x).toBeGreaterThan(-600);
});

test('거품은 소스마다 4개, 올라가며 사라진다', () => {
  const b = streamBubbles(5, [[100, 300, 0]]);
  expect(b).toHaveLength(4);
  for (const x of b) expect(x.y).toBeLessThanOrEqual(300);
});
