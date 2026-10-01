// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { makeConfig, type Building, type VillageState } from '@tycoon/core';
import { targets } from '../live/movement';
import { actorsFromState, frontTiles, sceneFromState } from '../live/sceneFromState';
import { iso } from '../render/iso';
import { LiveVillage } from './LiveVillage';
import { critterOrigin } from './Village';
import { fullVillage } from '../test/village';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 다 자란 마을 (시설 3채·슬롯 순 집·모두 입주): 그리기·이동 논리만 본다 — 자라는 순서는 core growth.test */
const golden = () =>
  fullVillage(
    JSON.parse(
      readFileSync(join(import.meta.dirname, '../../../../fixtures/sample-session.golden.json'), 'utf8'),
    ) as VillageState,
  );
const at = (p: { x: number; y: number }) => {
  const c = iso(p.x, p.y);
  return critterOrigin(c.sx, c.sy);
};

// rAF를 손으로 돌린다 (한 프레임 100ms → LiveVillage가 0.1초로 자름)
let frames: FrameRequestCallback[] = [];
let tm = 0;
const run = (n: number) => {
  for (let i = 0; i < n; i++) {
    tm += 100;
    const f = frames;
    frames = [];
    act(() => f.forEach((cb) => cb(tm)));
  }
};

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

test('공사 돕는 외부인: 인력 부두 문 앞에서 나와 현장으로 가서 자재를 나른다 (01 문서 3.2)', () => {
  frames = [];
  tm = performance.now();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => {});
  const s0 = golden(); // backend-dev 일터 공사 중
  const div = document.body.appendChild(document.createElement('div'));
  const root = createRoot(div);
  act(() => root.render(h(LiveVillage, { state: s0 })));

  const s1 = golden();
  s1.visitors.g1 = { runId: 'g1', kind: 'general-purpose', facility: 'agency', startedAt: s1.clock.now };
  act(() => root.render(h(LiveVillage, { state: s1 })));
  const walker = () => div.querySelector('[data-walker="g1"]');
  const [dx = 0, dy = 0] = (s1.facilities.agency && frontTiles(s1.facilities.agency)[0]) || [];
  expect(walker()?.getAttribute('transform')).toBe(at({ x: dx + 0.5, y: dy + 0.5 })); // 현장에 바로 나타나지 않는다

  const cfg = makeConfig();
  const goal = targets(s1, sceneFromState(s1, cfg), actorsFromState(s1, cfg, Date.now())).get('g1');
  if (!goal) throw new Error('no target');
  run(150); // 15초면 도착
  expect(walker()?.getAttribute('transform')).toBe(at(goal));
  expect(walker()?.querySelector('svg')?.getAttribute('data-asset-id')).toBe('fish.carry');
  act(() => root.unmount());
});

// ── M6 공사 연출 ──
const mount = (state: VillageState, props: Record<string, unknown> = {}) => {
  frames = [];
  tm = performance.now();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => {});
  const div = document.body.appendChild(document.createElement('div'));
  const root = createRoot(div);
  const render = (s: VillageState) => act(() => root.render(h(LiveVillage, { state: s, ...props })));
  render(state);
  return { div, root, render };
};

test('일터·집을 누르면 onBuildingClick(장면 건물 id). 시설은 누를 곳이 없다', () => {
  const onBuildingClick = vi.fn();
  const s = golden();
  const { div, root } = mount(s, { onBuildingClick });
  const hits = [...div.querySelectorAll<HTMLButtonElement>('button[data-building-hit]')];
  const ids = hits.map((b) => b.dataset.buildingHit);
  expect(ids.filter((id) => id?.startsWith('house:')).sort()).toEqual(
    Object.keys(s.houses)
      .map((m) => `house:${m}`)
      .sort(),
  );
  expect(ids.filter((id) => !id?.startsWith('house:'))).toEqual(['work:w1:qa-reviewer', 'work:w1:backend-dev']);
  const label = (id: string) => hits.find((b) => b.dataset.buildingHit === id)?.getAttribute('aria-label');
  expect(label('work:w1:qa-reviewer')).toBe('qa-reviewer의 초소 건물 보기');
  expect(label('work:w1:backend-dev')).toBe('backend-dev의 공방 공사 현장 보기');
  act(() => hits.find((b) => b.dataset.buildingHit === 'work:w1:backend-dev')?.click());
  expect(onBuildingClick).toHaveBeenCalledWith('work:w1:backend-dev');
  const home = hits.find((b) => b.dataset.buildingHit === 'house:qa-reviewer');
  expect(home?.getAttribute('aria-label')).toBe('qa-reviewer 집 보기');
  act(() => home?.click());
  expect(onBuildingClick).toHaveBeenLastCalledWith('house:qa-reviewer');
  act(() => root.unmount());
});

test('시청을 누르면 onBuildingClick("hall") (06 문서 6.4: 경제 패널로)', () => {
  const onBuildingClick = vi.fn();
  const s = golden();
  s.facilities = {};
  s.hall = { x: 3, y: 3, size: 3 };
  const { div, root } = mount(s, { onBuildingClick });
  const hit = div.querySelector<HTMLButtonElement>('button[data-building-hit="hall"]');
  expect(hit?.getAttribute('aria-label')).toBe('시청 보기 · 마을 기금');
  act(() => hit?.click());
  expect(onBuildingClick).toHaveBeenCalledWith('hall');
  act(() => root.unmount());
});

test('레벨이 오르면 섬 가운데 거품 (06 문서 6.1 연출, 처음 그린 장면은 조용히)', () => {
  const { div, root, render } = mount(golden());
  const pops = () => div.querySelectorAll('[data-layer="fx-site"] > g').length;
  expect(pops()).toBe(0);
  const s1 = golden();
  s1.level = 2;
  render(s1);
  expect(pops()).toBe(1);
  act(() => root.unmount());
});

test('누르기 칸은 그림과 같은 앞뒤 순서(z-index): 건물 뒤 캐릭터 칸은 건물 칸 밑, 앞 캐릭터는 위', () => {
  const { div, root } = mount(golden(), { onBuildingClick: () => {}, onSelect: () => {} });
  const z = (sel: string) => Number(div.querySelector<HTMLElement>(sel)?.style.zIndex || NaN);
  const sides = new Set<boolean>();
  for (const bid of ['w1:qa-reviewer', 'w1:backend-dev']) {
    const drawn = [...div.querySelectorAll(`svg [data-building="work:${bid}"], svg [data-walker]`)].map(
      (e) => e.getAttribute('data-walker') ?? 'b',
    );
    const hit = z(`[data-building-hit="work:${bid}"]`);
    const at = drawn.indexOf('b');
    for (const id of drawn.filter((x) => x !== 'b')) {
      sides.add(drawn.indexOf(id) > at);
      expect(z(`[data-walker-ui="${id}"]`) > hit, `${bid} ${id}`).toBe(drawn.indexOf(id) > at);
    }
  }
  expect([...sides].sort()).toEqual([false, true]); // 건물 뒤 캐릭터와 앞 캐릭터를 둘 다 봤다
  act(() => root.unmount());
});

test('층이 오르면 거품이 잠깐, 새 일터 부지도 (처음 그린 장면은 조용히, 06 문서 5.4)', () => {
  const { div, root, render } = mount(golden());
  const pops = () => div.querySelectorAll('[data-layer="fx-site"] > g').length;
  expect(pops()).toBe(0);
  const s1 = golden();
  Object.assign(s1.buildings['w1:qa-reviewer'] ?? {}, { floor: 2, floorAt: 1 });
  render(s1);
  expect(pops()).toBe(1);
  run(15);
  expect(pops()).toBe(0);
  const s2 = structuredClone(s1);
  s2.buildings['w1:frontend-dev'] = {
    ...(s1.buildings['w1:qa-reviewer'] as Building),
    id: 'w1:frontend-dev',
    memberId: 'frontend-dev',
    lot: { x: 13, y: 13, size: 3 },
    floor: 0,
  };
  render(s2);
  expect(pops()).toBe(1);
  act(() => root.unmount());
});

test('임시 층 배지는 labels와 상관없이, 떠난 주인이면 건물처럼 흐리게', () => {
  const s = golden();
  Object.assign(s.buildings['w1:qa-reviewer'] ?? {}, { floor: 3 });
  Object.assign(s.members['qa-reviewer'] ?? {}, { departed: true });
  const { div, root } = mount(s, { labels: false });
  const badge = div.querySelector<HTMLElement>('[data-floor-badge]');
  expect([badge?.textContent, badge?.style.opacity]).toEqual(['3층', '0.55']);
  act(() => root.unmount());
});

test('층이 오른 반짝임(fx.complete)은 floorAt부터 completeFxMs(3초) 동안만', () => {
  const T = 1_800_000_000_000;
  const now = vi.spyOn(Date, 'now').mockReturnValue(T + 100);
  const s = golden();
  Object.assign(s.buildings['w1:qa-reviewer'] ?? {}, { floorAt: T });
  const { div, root } = mount(s);
  const fxOn = () => !!div.querySelector('[data-building="work:w1:qa-reviewer"] [data-asset-id="fx.complete"]');
  run(1);
  expect(fxOn()).toBe(true);
  now.mockReturnValue(T + 3000);
  run(1);
  expect(fxOn()).toBe(false);
  act(() => root.unmount());
  now.mockRestore();
});

// ── M16 집 주인 표시·캐릭터 누르기 (06 문서 7·8장) ──
test('집 간판 = 주인 얼굴(clipPath 원 안 critter 얼굴) + 이름표, 팀장은 "팀장의 집"', () => {
  const { div, root } = mount(golden());
  const sign = div.querySelector('[data-owner-sign="qa-reviewer"]');
  expect(sign?.querySelector('clipPath circle')).toBeTruthy();
  expect(sign?.querySelector('g[clip-path] svg[data-asset-id="hamster.face"]')).toBeTruthy();
  expect(div.querySelector('[data-building="house:qa-reviewer"] [data-asset-id="sign.home"]')).toBeNull(); // 그림 간판 대신
  expect(div.querySelector('[data-building="facility:library"] [data-asset-id="sign.library"]')).toBeTruthy(); // 시설은 그대로
  const tags = [...div.querySelectorAll('.lv-tag')].map((e) => e.textContent);
  expect(tags.sort()).toEqual(['backend-dev', 'frontend-dev', 'qa-reviewer', 'qa-reviewer', '팀장의 집']); // 집 넷 + 1층 일터 (qa-reviewer)
  act(() => root.unmount());
});

test('캐릭터 누르기: 1.2초 버둥(flail)·말풍선, 외부인도 / 끌어 놓으면 걸을 수 있는 칸에 내려 다시 걷는다', () => {
  const s = golden();
  s.visitors.v1 = { runId: 'v1', kind: 'Explore', facility: 'library', startedAt: s.clock.now };
  const onSelect = vi.fn();
  const { div, root } = mount(s, { onSelect });
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => tm); // 누른 시각도 손으로 돌리는 rAF 시계로
  const ui = (id: string) => div.querySelector<HTMLElement>(`[data-walker-ui="${id}"]`);
  const pose = (id: string) => div.querySelector(`[data-walker="${id}"] svg`)?.getAttribute('data-asset-id');
  const hitOf = (id: string) => ui(id)?.querySelector<HTMLButtonElement>('button.lv-hit');

  act(() => hitOf('backend-dev')?.click());
  expect(onSelect).toHaveBeenCalledWith('backend-dev'); // 하던 동작(카드 강조)은 그대로
  run(1);
  expect(ui('backend-dev')?.hasAttribute('data-poked')).toBe(true);
  expect(pose('backend-dev')).toBe('seal.flail');
  expect(ui('backend-dev')?.querySelector('[data-poke-say]')?.textContent).toBe('막힘 · 권한 기다림'); // 골든 backend-dev: 권한 요청으로 막힘
  expect(ui('backend-dev')?.querySelector('[aria-label="막힘"]')).toBeNull(); // '!'는 말풍선이 대신
  run(12); // 1.2초 뒤
  expect(ui('backend-dev')?.hasAttribute('data-poked')).toBe(false);
  expect(pose('backend-dev')).not.toBe('seal.flail');

  act(() => hitOf('v1')?.click()); // 외부인
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(ui('v1')?.querySelector('[data-poke-say]')?.textContent).toBe('일하는 중 · 탐사 기지');

  // 끌기: 6px 넘게 → 집어 듦(held) → 놓으면 칸 가운데, 다시 가던 곳으로
  run(150); // 모두 자리 잡기
  const walker = () => div.querySelector('[data-walker="frontend-dev"]');
  const home = walker()?.getAttribute('transform');
  const hit = hitOf('frontend-dev');
  const ev = (type: string, x: number, y: number) =>
    act(() => {
      hit?.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          clientX: x,
          clientY: y,
          pointerId: 7,
          pointerType: 'mouse',
          button: 0,
        }),
      );
    });
  ev('pointerdown', 100, 100);
  ev('pointermove', 104, 100); // 4px: 아직
  run(1);
  expect(pose('frontend-dev')).not.toBe('otter.held');
  ev('pointermove', 100 + 64 * 3, 100); // 오른쪽으로 세 칸쯤
  run(1);
  expect(pose('frontend-dev')).toBe('otter.held');
  ev('pointerup', 100 + 64 * 3, 100);
  act(() => void hit?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))); // 끌기 뒤 마우스 click은 누르기가 아니다
  run(1);
  expect(pose('frontend-dev')).not.toBe('otter.held');
  expect(ui('frontend-dev')?.hasAttribute('data-poked')).toBe(false);
  const dropped = walker()?.getAttribute('transform');
  expect(dropped).not.toBe(home);
  run(150);
  expect(walker()?.getAttribute('transform')).toBe(home); // 원래 가던 곳으로 걸어 돌아왔다
  act(() => root.unmount());
  clock.mockRestore();
});
