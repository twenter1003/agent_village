import { expect, test } from 'vitest';
import { completeFxOn, popBubbles, stageUp } from './constructionFx';

test('완공 반짝임은 완공 뒤 completeFxMs 동안만, 한참 뒤에 열면 없다 (03 문서 3.1)', () => {
  expect(completeFxOn(undefined, 5, 3000)).toBe(false);
  expect(completeFxOn(1000, 1000, 3000)).toBe(true);
  expect(completeFxOn(1000, 3999, 3000)).toBe(true);
  expect(completeFxOn(1000, 4000, 3000)).toBe(false);
  expect(completeFxOn(1000, 1000 + 3_600_000, 3000)).toBe(false);
});

test('단계 거품: 앞으로 갈 때만, 올라가며 사라진다', () => {
  expect(stageUp(undefined, 'foundation')).toBe(false); // 처음 본 건물
  expect(stageUp('planned', 'foundation')).toBe(true);
  expect(stageUp('frame', 'done')).toBe(true);
  expect(stageUp('frame', 'frame')).toBe(false);
  expect(stageUp('frame', 'foundation')).toBe(false); // 완료 작업이 지워져 되돌아감
  const [a, b] = [popBubbles(0.1), popBubbles(0.9)];
  expect(a).toHaveLength(5);
  a.forEach((p, i) => {
    expect(b[i]?.y ?? 0).toBeLessThan(p.y);
    expect(b[i]?.o ?? 1).toBeLessThan(p.o);
  });
});
