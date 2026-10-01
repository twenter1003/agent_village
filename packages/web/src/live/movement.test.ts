import { readFileSync } from 'node:fs';
import { isPlaza, isRoad, makeConfig, MAP, type VillageState } from '@tycoon/core';
import { expect, test } from 'vitest';
import { advance, findPath, memberViews, poseFor, retarget, ROCK_LIFT, step, targets } from './movement';
import { actorsFromState, sceneFromState } from './sceneFromState';
import { fullVillage } from '../test/village';

/** 다 자란 마을 (시설 3채·슬롯 순 집·모두 입주): 그리기·이동 논리만 본다 — 자라는 순서는 core growth.test */
const golden = () =>
  fullVillage(
    JSON.parse(
      readFileSync(new URL('../../../../fixtures/sample-session.golden.json', import.meta.url), 'utf8'),
    ) as VillageState,
  );

const cfg = makeConfig();
const tileOf = (p: { x: number; y: number }) => [Math.floor(p.x), Math.floor(p.y)] as const;

test('A*: 부지를 피한다', () => {
  const sc = sceneFromState(golden(), cfg);
  // 도서관 문 앞 → qa-reviewer 일터 앞마당: 집·시설·현장 부지를 밟지 않는다
  const path = findPath(sc.blocked, { x: 1.5, y: 6.5 }, { x: 10.5, y: 12.5 });
  expect(path.at(-1)).toEqual({ x: 10.5, y: 12.5 });
  for (const p of path.slice(0, -1)) {
    const [x, y] = tileOf(p);
    expect(sc.blocked[y * MAP + x]).toBe(0);
  }
  // 이웃 칸끼리만 이어진다 (4방향)
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = tileOf(path[i - 1] ?? { x: 0, y: 0 });
    const [bx, by] = tileOf(path[i] ?? { x: 0, y: 0 });
    expect(Math.abs(ax - bx) + Math.abs(ay - by)).toBe(1);
  }
});

test('A*: 길 칸을 좋아한다', () => {
  const empty = new Uint8Array(MAP * MAP);
  // y=6 모래 줄을 곧장 가는 대신 한 칸 내려가 십자 길(y=7)로 간다
  const path = findPath(empty, { x: 2.5, y: 6.5 }, { x: 13.5, y: 6.5 });
  const road = path.filter((p) => isRoad(...tileOf(p)) || isPlaza(...tileOf(p))).length;
  expect(road).toBeGreaterThan(path.length / 2);
  // 막힌 곳이 없으면 곧장 (길이 = 맨해튼 거리)
  expect(findPath(empty, { x: 2.5, y: 2.5 }, { x: 2.5, y: 4.5 })).toEqual([
    { x: 2.5, y: 3.5 },
    { x: 2.5, y: 4.5 },
  ]);
});

test('step: 1.5타일/초로 경로를 따라가고, 화면 오른쪽이면 +', () => {
  const w = {
    x: 0.5,
    y: 0.5,
    path: [
      { x: 1.5, y: 0.5 },
      { x: 1.5, y: 1.5 },
    ],
  };
  expect(step(w, 0.5)).toBeGreaterThan(0); // +x = 화면 오른쪽 아래
  expect(w).toMatchObject({ x: 1, y: 0.5 });
  expect(step(w, 1)).toBeLessThan(0); // +y = 화면 왼쪽 아래
  expect(w).toMatchObject({ x: 1.5, y: 1, path: [{ x: 1.5, y: 1.5 }] });
  expect(step(w, 5)).toBeLessThan(0);
  expect(w.path).toEqual([]);
  expect(step(w, 1)).toBe(0);
});

test('목적지: 작업 = 현장 앞 칸, 휴식 = 집 문 앞, 막힘 = 제자리', () => {
  const s = golden();
  const sc = sceneFromState(s, cfg);
  const t = targets(s, sc, actorsFromState(s, cfg, s.clock.now));
  // backend-dev: 막힘 → 자기 일터(동 10,3) 앞마당. 첫 칸 (10,5)는 앞 칸 (10,6)이 광장 해파리등이라 가려져 → (11,5), stay
  expect(t.get('backend-dev')).toEqual({ x: 11.5, y: 5.5, stay: true });
  // 휴식: 집 부지 (x, y) → 문 앞 (x, y+2). 뒷줄 집은 문 앞이 앞집에 가려져서 오른쪽 옆 (x+2, y+1)
  expect(t.get('@leader')).toEqual({ x: 6.5, y: 11.5 }); // 집 4,10, 문 앞 4,12는 frontend-dev 집 4,13 뒤
  expect(t.get('frontend-dev')).toEqual({ x: 4.5, y: 15.5 }); // 집 4,13
  expect(t.get('qa-reviewer')).toEqual({ x: 1.5, y: 15.5 }); // 집 1,13

  // 일하러 가면 각자 자기 일터 앞 (06 문서 5장)
  const qa = s.members['qa-reviewer'];
  const be = s.members['backend-dev'];
  if (!qa || !be) throw new Error('fixture');
  Object.assign(qa, { status: 'working', currentRunId: 'a9', currentTaskId: 't2' });
  Object.assign(be, { status: 'working', blocked: null });
  const t2 = targets(s, sc, actorsFromState(s, cfg, s.clock.now));
  expect(t2.get('backend-dev')).toEqual({ x: 11.5, y: 5.5 });
  expect(t2.get('qa-reviewer')).toEqual({ x: 10.5, y: 12.5 });
});

test('목적지: 물범은 쉴 때 가까운 빈 바위 위, 없으면 집 앞 (05 문서 S5)', () => {
  const s = golden();
  const be = s.members['backend-dev'];
  if (!be) throw new Error('fixture');
  Object.assign(be, { status: 'resting', blocked: null, currentRunId: null, currentTaskId: null });
  const sc = sceneFromState(s, cfg);
  sc.props = sc.props.filter((p) => p.kind !== 'rock');
  expect(targets(s, sc, actorsFromState(s, cfg, 0)).get('backend-dev')).toEqual({ x: 3.5, y: 11.5 }); // 집 1,10 옆 (문 앞은 앞집 뒤)
  // 앞집 뒤에 가려지는 바위(3,12: 앞 칸 4,13이 집)는 건너뛴다
  sc.props.push({ x: 14, y: 1, kind: 'rock' }, { x: 3, y: 12, kind: 'rock' }, { x: 7, y: 12, kind: 'rock' });
  expect(targets(s, sc, actorsFromState(s, cfg, 0)).get('backend-dev')).toEqual({ x: 7.5, y: 12.5, lift: ROCK_LIFT });
  expect(ROCK_LIFT).toBe(25);
  // 팀원 패널 칩용: 마을과 같은 seed 장면에서 바위 위인 팀원만 (골든 마을에는 바위가 있다)
  expect(sceneFromState(s, cfg).props.some((p) => p.kind === 'rock')).toBe(true);
  expect(memberViews(s, cfg, 0).get('backend-dev')).toEqual({ status: 'resting', place: 'rock' });
  expect(memberViews(golden(), cfg, 0).get('backend-dev')).toEqual({ status: 'blocked', place: 'site' }); // 막힘이면 제자리
});

test('목적지: 회의 = 게시판 앞 반원, 외부인 = 자기 시설 앞 / 공사 돕기', () => {
  const s = golden();
  s.meeting = { kind: 'prompt', startedAt: 0, until: Infinity, preview: '', participants: ['@leader', 'frontend-dev'] };
  for (const id of ['@leader', 'frontend-dev']) Object.assign(s.members[id] ?? {}, { status: 'meeting' });
  s.visitors.v1 = { runId: 'v1', kind: 'Explore', facility: 'library', startedAt: 1 };
  s.visitors.v2 = { runId: 'v2', kind: 'Plan', facility: 'plan', startedAt: 2 };
  s.visitors.v3 = { runId: 'v3', kind: 'general-purpose', facility: 'agency', startedAt: 3 };
  const sc = sceneFromState(s, cfg);
  const t = targets(s, sc, actorsFromState(s, cfg, s.clock.now));
  const board = sc.props.find((p) => p.kind === 'board') ?? { x: 0, y: 0 };
  const [a, b] = [t.get('@leader'), t.get('frontend-dev')];
  for (const p of [a, b]) {
    if (!p) throw new Error('no target');
    expect(Math.hypot(p.x - board.x - 0.5, p.y - board.y - 0.5)).toBeCloseTo(1.4);
    expect(p.x + p.y).toBeGreaterThan(board.x + board.y + 1); // 화면에서 게시판 앞(아래)
    const [x, y] = tileOf(p);
    expect(sc.blocked[y * MAP + x]).toBe(0);
  }
  expect(a).not.toEqual(b);
  expect(t.get('v1')).toEqual({ x: 1.5, y: 6.5 }); // 도서관 1,4 앞
  expect(t.get('v2')).toEqual({ x: 6.5, y: 2.5 }); // 해도실 4,1 옆 (문 앞 4,3은 인력 부두 4,4 뒤)
  expect(t.get('v3')).toEqual({ x: 12.5, y: 4.5 }); // 일하는 backend-dev의 일터 앞마당. backend-dev가 (11,5) → 다음 칸 오른쪽 옆 (12,4)
});

test('목적지: 앞 칸이 부지·가구인 자리(앞 건물에 가려짐)로 보내지 않는다', () => {
  const s = golden();
  Object.assign(s.members['backend-dev'] ?? {}, { status: 'resting', blocked: null, currentRunId: null });
  s.visitors.v1 = { runId: 'v1', kind: 'Explore', facility: 'library', startedAt: 1 };
  s.visitors.v2 = { runId: 'v2', kind: 'Plan', facility: 'plan', startedAt: 2 };
  s.visitors.v3 = { runId: 'v3', kind: 'Plan', facility: 'plan', startedAt: 3 };
  const sc = sceneFromState(s, cfg);
  const t = targets(s, sc, actorsFromState(s, cfg, s.clock.now));
  expect(t.size).toBe(7);
  const wall = (x: number, y: number) => x < MAP && y < MAP && sc.blocked[y * MAP + x] === 1;
  for (const [id, p] of t) {
    const [x, y] = tileOf(p);
    expect([id, wall(x, y + 1) || wall(x + 1, y + 1)]).toEqual([id, false]);
  }
});

test('목적지: 자재 더미 칸에는 아무도 서지 않는다 (공사 돕는 외부인이 많아도)', () => {
  const s = golden(); // backend-dev 일터 기초 (10,3) → 더미 (12,3)
  for (let i = 1; i <= 6; i++)
    s.visitors[`g${i}`] = { runId: `g${i}`, kind: 'general-purpose', facility: 'agency', startedAt: i };
  const sc = sceneFromState(s, cfg);
  const piles = sc.props.filter((p) => p.kind === 'materials').map((p) => `${p.x},${p.y}`);
  expect(piles).toEqual(['12,3']);
  const t = targets(s, sc, actorsFromState(s, cfg, s.clock.now));
  const tiles = [...t.values()].map((p) => tileOf(p).join(','));
  expect(tiles.filter((k) => piles.includes(k))).toEqual([]);
});

test('걷기: 막히면 가던 길을 멈추고, 바위 위 높이는 떠나는 첫걸음에 내린다', () => {
  const open = new Uint8Array(MAP * MAP);
  const w = { x: 3.5, y: 3.5, path: [], goal: '3.5,3.5', lift: ROCK_LIFT, goalLift: ROCK_LIFT };
  retarget(w, { x: 3.5, y: 7.5 }, open);
  expect(w.path.at(-1)).toEqual({ x: 3.5, y: 7.5 });
  expect(w.lift).toBe(ROCK_LIFT); // 환호로 멈춘 동안(advance 전)은 바위 위 그대로
  advance(w, 1);
  expect(w).toMatchObject({ x: 3.5, y: 4.5, lift: 0 });
  // 막힘 = 제자리 (01 문서 4장): 가던 길을 버린다. 같은 막힘 목적지가 다시 와도 그대로
  retarget(w, { x: 3.5, y: 7.5, stay: true }, open);
  expect(w.path).toEqual([]);
  retarget(w, { x: 3.5, y: 7.5, stay: true }, open);
  expect(w).toMatchObject({ x: 3.5, y: 4.5, path: [] });
  // 풀리면 다시 가고, 바위에 닿으면 올라간다
  retarget(w, { x: 3.5, y: 7.5, lift: ROCK_LIFT }, open);
  advance(w, 10);
  expect(w).toMatchObject({ x: 3.5, y: 7.5, lift: ROCK_LIFT });
});

test('팀원 카드: 마을과 같은 시계 — 회의가 이벤트 없이 끝나면 휴식/작업, 곳도 같이', () => {
  const s = golden();
  s.meeting = { kind: 'kickoff', startedAt: 0, until: 1000, preview: '', participants: ['@leader', 'frontend-dev'] };
  for (const id of ['@leader', 'frontend-dev']) Object.assign(s.members[id] ?? {}, { status: 'meeting' });
  expect(memberViews(s, cfg, 999).get('@leader')).toEqual({ status: 'meeting', place: 'plaza' });
  const after = memberViews(s, cfg, 1000);
  expect(after.get('@leader')).toEqual({ status: 'resting', place: 'home' });
  expect(after.get('qa-reviewer')).toEqual({ status: 'resting', place: 'home' });
  expect(after.get('backend-dev')).toEqual({ status: 'blocked', place: 'site' });
});

test('포즈: 상태 → 포즈 (01 문서 4장)', () => {
  const a = { status: 'working' as const, heavy: false, cheerUntil: null };
  expect(poseFor(a, false, 0)).toBe('hammer');
  expect(poseFor(a, true, 0)).toBe('walk');
  expect(poseFor({ ...a, cheerUntil: 10 }, true, 5)).toBe('cheer');
  expect(poseFor({ ...a, cheerUntil: 10 }, false, 10)).toBe('hammer');
  const heavy = { ...a, heavy: true };
  expect(new Set([0, 4000, 8000].map((t) => poseFor(heavy, false, t)))).toEqual(new Set(['hammer', 'carry']));
  expect(poseFor({ ...a, status: 'meeting' }, false, 0)).toBe('talk');
  expect(poseFor({ ...a, status: 'resting' }, false, 0)).toBe('rest');
  expect(poseFor({ ...a, status: 'blocked' }, false, 0)).toBe('stand');
  expect(poseFor({ ...a, status: 'visiting' }, false, 0)).toBe('stand');
  // 공사 돕는 외부인(general-purpose)은 자재를 나른다 (01 문서 3.2)
  expect(poseFor({ ...a, visitor: { kind: 'general-purpose', facility: 'agency' } }, false, 0)).toBe('carry');
});

test('일하는 팀장은 시청 앞마당 (06 문서 5.9·6.3), 카드 곳 "시청". 시청이 없으면 지금처럼', () => {
  const s = golden();
  s.facilities = {};
  s.hall = { x: 3, y: 3, size: 3 };
  const leader = s.members['@leader'];
  if (!leader) throw new Error('팀장');
  leader.status = 'working';
  const sc = sceneFromState(s, cfg);
  const t = targets(s, sc, actorsFromState(s, cfg, 0)).get('@leader');
  if (!t) throw new Error('목적지');
  const [x, y] = tileOf(t);
  expect([x - sc.off, y - sc.off].every((v) => v >= 3 && v <= 5)).toBe(true); // 3×3 앞마당
  expect(memberViews(s, cfg, 0).get('@leader')?.place).toBe('hall');
  s.hall = null;
  expect(memberViews(s, cfg, 0).get('@leader')?.place).not.toBe('hall');
});
