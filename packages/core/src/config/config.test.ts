import { expect, test } from 'vitest';
import { canonicalAccessory, canonicalSpecies, makeConfig, normalizeTycoon } from './config';

test('바다 id는 정본 id로, 여러 개가 한 곳으로 오면 첫 키', () => {
  expect(canonicalSpecies('seal')).toBe('bear');
  expect(canonicalSpecies('bear')).toBe('bear');
  expect(canonicalAccessory('headlamp')).toBe('glasses');
  const t = normalizeTycoon({
    members: { a: { species: 'hamster', accessory: 'starfishPin' } },
    leader: { species: 'turtle' },
  });
  expect(t.members?.a).toEqual({ species: 'raccoon', accessory: 'beret' });
  expect(t.leader?.species).toBe('penguin');
});

test('overrides는 기본값 위에 덮는다', () => {
  expect(makeConfig({ overrides: { time: { gameDayMs: 60000 } } }).time).toMatchObject({
    gameDayMs: 60000,
    frameMs: 150,
  });
});

test('손으로 고친 tycoon.json: 객체가 아닌 항목·문자열이 아닌 값은 버린다', () => {
  const t = normalizeTycoon({
    members: { a: null, b: { species: 5, accessory: null, job: 'qa' } },
    leader: 'x',
  } as unknown as Parameters<typeof normalizeTycoon>[0]);
  expect(Object.keys(t.members ?? {})).toEqual(['b']);
  expect(t.members?.b).toEqual({ accessory: null, job: 'qa' });
  expect(t.leader).toBeUndefined();
});

test('마을 레벨·공공시설·일터 층 표 (06 문서 5.3·6.1·6.2, ×10 D31): 기본 10줄·6줄·4줄, 광장 소품 설정은 없다. 손으로 고친 표가 잘못되면 기본 표', () => {
  const d = makeConfig();
  expect(d.village.levels.map((l) => [l.points, l.cost, l.era])).toEqual([
    [0, 0, 'village'],
    [1500, 1500, 'village'],
    [3500, 2500, 'village'],
    [6000, 4000, 'town'],
    [10000, 6000, 'town'],
    [18000, 9000, 'town'],
    [30000, 15000, 'city'],
    [45000, 20000, 'city'],
    [65000, 30000, 'city'],
    [100000, 50000, 'capital'],
  ]);
  expect(d.publicWorks.map((w) => [w.id, w.cost, w.level])).toEqual([
    ['streetlamp', 1000, 1],
    ['bench', 1000, 1],
    ['flowers', 1000, 1],
    ['park', 4000, 4],
    ['paving', 6000, 4],
    ['landmark', 20000, 7],
  ]);
  // 성장 속도 ×10 (D31, 06 문서 6.4): 일터 층 점수·자재비도 (5.3 표)
  expect(d.workplace.levels.map((l) => [l.points, l.cost, l.level])).toEqual([
    [0, 0, 1],
    [750, 8000, 1],
    [2250, 12000, 4],
    [4500, 17000, 7],
  ]);
  expect(d.economy).not.toHaveProperty('plaza');
  const row = (points: number, cost: number, era = 'village') => ({ points, cost, era });
  for (const village of [
    { levels: [] },
    { levels: [row(0, 0), row(50, -10)] }, // 공사비 음수 = 기금이 생김
    { levels: [row(0, 0), row(50, 10), row(40, 10)] }, // 점수가 줄어 레벨을 건너뜀
    { levels: [row(0, 0), row(50, 10, 'metropolis')] }, // 모르는 시대 = 시청 층을 모름
    { levels: [{ points: 'a', cost: 0, era: 'village' }] },
    { levels: 'x' },
    5,
  ])
    expect(makeConfig({ overrides: { village } }).village.levels, JSON.stringify(village)).toEqual(d.village.levels);
  for (const publicWorks of [
    [{ id: 'park', cost: -1, level: 4 }],
    [{ id: 3, cost: 1, level: 1 }],
    [{ id: 'park', cost: 1, level: 0 }],
    [null],
    'x',
  ])
    expect(makeConfig({ overrides: { publicWorks } }).publicWorks, JSON.stringify(publicWorks)).toEqual(d.publicWorks);
  expect(makeConfig({ overrides: { publicWorks: [] } }).publicWorks).toEqual([]); // 공공시설 없는 마을 (시험용)
});
