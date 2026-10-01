import { readFileSync } from 'node:fs';
import { makeConfig, MAP, type VillageState } from '@tycoon/core';
import { expect, test } from 'vitest';
import { dropTile, pokePose, pokeText, pressIntent, POKE_MS, TILT_MS } from './poke';
import { actorsFromState, sceneFromState } from './sceneFromState';
import { fullVillage } from '../test/village';

const golden = () =>
  fullVillage(
    JSON.parse(
      readFileSync(new URL('../../../../fixtures/sample-session.golden.json', import.meta.url), 'utf8'),
    ) as VillageState,
  );
const cfg = makeConfig();
const actor = (s: VillageState, id: string) => {
  const a = actorsFromState(s, cfg, s.clock.now).find((x) => x.id === id);
  if (!a) throw new Error(id);
  return a;
};

test('말풍선 = 지금 상태: 일하는 중 · 작업 제목, 쉬는 중, 막힘 · 까닭, 회의 중, 외부인', () => {
  const s = golden();
  const m = s.members['frontend-dev'];
  const task = Object.values(s.tasks)[0];
  if (!m || !task) throw new Error('fixture');
  expect(pokeText(actor(s, 'frontend-dev'), s)).toBe('쉬는 중');
  Object.assign(m, { status: 'working', currentTaskId: task.id });
  expect(pokeText(actor(s, 'frontend-dev'), s)).toBe(`일하는 중 · ${task.subject}`);
  m.currentTaskId = null;
  expect(pokeText(actor(s, 'frontend-dev'), s)).toBe('일하는 중');
  Object.assign(m, { status: 'blocked', blocked: 'permission' });
  expect(pokeText(actor(s, 'frontend-dev'), s)).toBe('막힘 · 권한 기다림');
  m.blocked = 'failures';
  expect(pokeText(actor(s, 'frontend-dev'), s)).toBe('막힘 · 연속 실패');
  m.blocked = null;
  expect(pokeText(actor(s, 'frontend-dev'), s)).toBe('막힘');
  s.meeting = { kind: 'prompt', startedAt: 0, until: 9e15, preview: '', participants: ['frontend-dev'] };
  m.status = 'meeting';
  expect(pokeText(actor(s, 'frontend-dev'), s)).toBe('회의 중');

  s.visitors.v1 = { runId: 'v1', kind: 'Explore', facility: 'library', startedAt: 1 };
  s.visitors.v2 = { runId: 'v2', kind: 'general-purpose', facility: 'agency', startedAt: 2 };
  expect(pokeText(actor(s, 'v1'), s)).toBe('일하는 중 · 탐사 기지');
  expect(pokeText(actor(s, 'v2'), s)).toBe('공사 돕는 중'); // 짓는 중인 b2가 있다
});

test('끌기 문턱: 마우스·펜은 6px 넘게, 터치는 0.3초 누른 뒤 (그전에 움직이면 마을 끌기)', () => {
  expect(pressIntent('mouse', 6, 0)).toBe('wait');
  expect(pressIntent('mouse', 6.1, 0)).toBe('grab');
  expect(pressIntent('pen', 7, 50)).toBe('grab');
  expect(pressIntent('touch', 3, 299)).toBe('wait');
  expect(pressIntent('touch', 3, 300)).toBe('grab');
  expect(pressIntent('touch', 7, 100)).toBe('pan');
});

test('버둥 1.2초, 동작 줄이기면 짧게 한 번 기울이기(고정 프레임)만, 들고 있으면 계속', () => {
  expect(pokePose(undefined, false, 0, false)).toBeNull();
  expect(pokePose(1000, false, 1000, false)).toEqual({ pose: 'flail' });
  expect(pokePose(1000, false, 1000 + POKE_MS - 1, false)).toEqual({ pose: 'flail' });
  expect(pokePose(1000, false, 1000 + POKE_MS, false)).toBeNull();
  expect(pokePose(1000, false, 1000 + TILT_MS - 1, true)).toEqual({ pose: 'flail', frame: 0 });
  expect(pokePose(1000, false, 1000 + TILT_MS, true)).toBeNull();
  expect(pokePose(undefined, true, 9e9, false)).toEqual({ pose: 'held' });
  expect(pokePose(undefined, true, 9e9, true)).toEqual({ pose: 'held', frame: 0 }); // 떠 있어도 버둥 없음
});

test('놓은 자리 → 가장 가까운 걸을 수 있는 칸 가운데', () => {
  const sc = sceneFromState(golden(), cfg);
  const free = (p: { x: number; y: number }) => sc.blocked[Math.floor(p.y) * MAP + Math.floor(p.x)] === 0;
  expect(dropTile(sc.blocked, { x: 7.2, y: 9.9 })).toEqual({ x: 7.5, y: 9.5 }); // 빈 칸이면 그 칸
  const house = sc.buildings.find((b) => b.id === 'house:backend-dev');
  if (!house) throw new Error('house');
  const p = dropTile(sc.blocked, { x: house.x + 0.9, y: house.y + 0.9 }); // 부지 한가운데
  expect(free(p)).toBe(true);
  expect(Math.hypot(p.x - (house.x + 0.9), p.y - (house.y + 0.9))).toBeLessThanOrEqual(1.7);
  expect(dropTile(sc.blocked, { x: -5, y: 40 })).toEqual({ x: 0.5, y: MAP - 0.5 }); // 섬 밖 → 가장자리 칸
});
