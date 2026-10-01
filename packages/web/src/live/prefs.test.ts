// @vitest-environment happy-dom
// 표시 설정 (01 문서 10장): 고른 값만 저장, 거품 기본값은 움직임 줄이기를 따름, 깨진 값은 기본값
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// Node 내장 localStorage(파일 없음 → 메서드 없음)가 happy-dom 것을 가린다 → 흉내
let store: Map<string, string>;
beforeEach(() => {
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
const load = () => import('./prefs');
const reduce = (on: boolean) => vi.stubGlobal('matchMedia', (q: string) => ({ matches: on && q.includes('reduce') }));
const saved = () => JSON.parse(store.get('tycoon.prefs') ?? '{}') as unknown;

/** 컴포넌트가 보는 값 */
async function watch() {
  const m = await load();
  const seen: unknown[] = [];
  const Probe = () => {
    seen.push(m.usePrefs());
    return null;
  };
  const root = createRoot(document.createElement('div'));
  act(() => root.render(h(Probe)));
  return { m, last: () => seen.at(-1), done: () => act(() => root.unmount()) };
}

test('기본값: 안건 글자 켬, 거품 켬(움직임 줄이기면 끔), 확대 = 전체 보기', async () => {
  reduce(false);
  const a = await watch();
  expect(a.last()).toEqual({ speech: true, bubbles: true, zoom: 'fit' });
  a.done();
  vi.resetModules();
  reduce(true);
  const b = await watch();
  expect(b.last()).toEqual({ speech: true, bubbles: false, zoom: 'fit' });
  // 고른 값만 저장 — 거품은 안 골랐으니 계속 움직임 줄이기를 따른다
  act(() => b.m.setPrefs({ zoom: 1.2 }));
  expect([b.last(), saved()]).toEqual([{ speech: true, bubbles: false, zoom: 1.2 }, { zoom: 1.2 }]);
  act(() => b.m.setPrefs({ bubbles: true })); // 사람이 고르면 그게 이긴다
  expect([b.last(), saved()]).toEqual([
    { speech: true, bubbles: true, zoom: 1.2 },
    { zoom: 1.2, bubbles: true },
  ]);
  b.done();
});

test('깨진·모르는 값은 기본값, 막힌 저장소도 이 탭에서는 바뀐다', async () => {
  reduce(true);
  store.set('tycoon.prefs', JSON.stringify({ speech: 'no', bubbles: 1, zoom: 3 }));
  const a = await watch();
  expect(a.last()).toEqual({ speech: true, bubbles: false, zoom: 'fit' });
  a.done();
  vi.resetModules();
  store.set('tycoon.prefs', '{not json');
  vi.stubGlobal('localStorage', {
    getItem: () => store.get('tycoon.prefs') ?? null,
    setItem: () => {
      throw new Error('blocked');
    },
  });
  const b = await watch();
  act(() => b.m.setPrefs({ speech: false }));
  expect(b.last()).toEqual({ speech: false, bubbles: false, zoom: 'fit' });
  b.done();
});

test('meetingText: 끄면 "광장 회의 시작 · 안건"에서 안건을 뺀다', async () => {
  const { meetingText } = await load();
  expect(meetingText('광장 회의 시작 · 비밀', true)).toBe('광장 회의 시작 · 비밀');
  expect(meetingText('광장 회의 시작 · 비밀', false)).toBe('광장 회의 시작');
});

test('알림 글자 (06 문서 6.4): 레벨업·공공시설은 ref로 이름 사전 — 받침 따라 이/가·을/를, 나머지는 그대로(회의는 안건 설정)', async () => {
  const { noticeText } = await load();
  expect(noticeText({ kind: 'complete', text: '마을 레벨 Lv.4', ref: '@level:4:town' }, true)).toBe(
    'Lv.4 산호 읍이 됐어요',
  );
  expect(noticeText({ kind: 'complete', text: '마을 레벨 Lv.7', ref: '@level:7:city' }, true)).toBe(
    'Lv.7 해저 도시가 됐어요',
  );
  expect(noticeText({ kind: 'complete', text: 'x · 4000', ref: '@work:park:4000' }, true)).toBe(
    '마을 기금으로 공원을 지었어요 · 기금 −4,000',
  );
  expect(noticeText({ kind: 'economy', text: 'x · 100', ref: '@work:bench:100' }, true)).toBe(
    '마을 기금으로 벤치를 지었어요 · 기금 −100',
  );
  expect(noticeText({ kind: 'complete', text: 'x', ref: '@work:landmark2:0' }, true)).toBe(
    '레벨업으로 소라 탑이 생겼어요',
  );
  expect(noticeText({ kind: 'failure', text: 'backend-dev 막힘', ref: 'backend-dev' }, true)).toBe('backend-dev 막힘');
  expect(noticeText({ kind: 'task', text: 'a 일터 1층 완공', ref: 'w1:a' }, true)).toBe('a 일터 1층 완공');
  expect(noticeText({ kind: 'meeting', text: '광장 회의 시작 · 비밀' }, false)).toBe('광장 회의 시작');
});
