// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import type { VillageState } from '@tycoon/core';
import { RETRY_MS, type ProjectInfo } from '../live/api';
import { LiveApp } from './LiveApp';

// 마을 그림은 여기서 안 본다 (LiveVillage 테스트는 live/)
vi.mock('../world/Camera', () => ({ Camera: ({ children }: { children?: unknown }) => children }));
const village = vi.hoisted(() => ({ onBuildingClick: undefined as ((id: string) => void) | undefined }));
vi.mock('../world/LiveVillage', () => ({
  liveWorld: () => ({ w: 1, h: 1 }),
  LiveVillage: (p: { onBuildingClick?: (id: string) => void }) => {
    village.onBuildingClick = p.onBuildingClick;
    return null;
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FakeES {
  static CLOSED = 2;
  static all: FakeES[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  listeners: Record<string, (e: { data: string }) => void> = {};
  constructor(public url: string) {
    FakeES.all.push(this);
  }
  addEventListener(type: string, fn: (e: { data: string }) => void) {
    this.listeners[type] = fn;
  }
  close() {
    this.readyState = FakeES.CLOSED;
  }
}
/** 열려 있는 SSE의 마을 id */
const streams = () =>
  FakeES.all.filter((e) => e.readyState !== FakeES.CLOSED).map((e) => decodeURIComponent(e.url.split('/')[3] ?? ''));

let list: ProjectInfo[] = [];
let up = true;
const P = (id: string, lastAt: number): ProjectInfo => ({ id, cwd: `/work/${id}`, lastAt });

function start(search = '') {
  vi.useFakeTimers();
  vi.stubGlobal('EventSource', FakeES);
  vi.stubGlobal('fetch', () =>
    up ? Promise.resolve({ ok: true, json: () => Promise.resolve(list) }) : Promise.reject(new Error('down')),
  );
  history.replaceState(null, '', `/${search}`);
  const div = document.body.appendChild(document.createElement('div'));
  const root = createRoot(div);
  act(() => root.render(h(LiveApp)));
  return { div, root };
}
const wait = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const golden = () =>
  JSON.parse(
    readFileSync(join(import.meta.dirname, '../../../../fixtures/sample-session.golden.json'), 'utf8'),
  ) as VillageState;
const send = (s: VillageState) => act(() => FakeES.all.at(-1)?.listeners.state?.({ data: JSON.stringify(s) }));
const picked = (div: Element) => div.querySelector<HTMLSelectElement>('.tb__pick select')?.value;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  FakeES.all = [];
  list = [];
  up = true;
  document.body.innerHTML = '';
});

test('?project= 없이 연 마을은 고정: 다른 마을에 이벤트가 와서 목록 순서가 바뀌어도 그대로', async () => {
  list = [P('alpha', 2), P('beta', 1)];
  const { div, root } = start();
  await wait(0);
  expect(picked(div)).toBe('alpha');
  expect(streams()).toEqual(['alpha']);
  list = [P('beta', 3), P('alpha', 2)]; // beta에 새 이벤트 → 목록 맨 앞
  await wait(RETRY_MS);
  expect(picked(div)).toBe('alpha');
  expect(streams()).toEqual(['alpha']);
  act(() => root.unmount());
});

test('저절로 고른 마을은 주소에 적힌다: 상세를 닫으면 뒤로 가기(기록이 안 쌓임), 뒤로 가도 그 마을 (M9 리뷰)', async () => {
  list = [P('alpha', 2), P('beta', 1)];
  const { div, root } = start('?grid');
  await wait(0);
  expect(location.search).toBe('?project=alpha&grid');
  send(golden());
  const len = history.length;
  act(() => village.onBuildingClick?.('work:w1:qa-reviewer'));
  act(() => [...div.querySelectorAll('button')].find((b) => b.textContent === '마을로')?.click());
  expect([location.search, history.length]).toEqual(['?project=alpha&grid', len + 1]);
  // beta로 바꾸고 beta가 가장 최근이 돼도, 뒤로 = alpha
  const pick = div.querySelector<HTMLSelectElement>('.tb__pick select');
  act(() => {
    if (pick) pick.value = 'beta';
    pick?.dispatchEvent(new Event('change', { bubbles: true }));
  });
  list = [P('beta', 3), P('alpha', 2)];
  await wait(RETRY_MS);
  act(() => history.back());
  expect([location.search, picked(div)]).toEqual(['?project=alpha&grid', 'alpha']);
  act(() => root.unmount());
});

test('상세를 연 채 드롭다운으로 마을을 바꾸면 포커스는 드롭다운에 남는다 (M9 리뷰)', async () => {
  list = [P('alpha', 2), P('beta', 1)];
  const { div, root } = start('?project=alpha');
  await wait(0);
  send(golden());
  act(() => village.onBuildingClick?.('work:w1:qa-reviewer'));
  const pick = div.querySelector<HTMLSelectElement>('.tb__pick select');
  act(() => pick?.focus());
  act(() => {
    if (pick) pick.value = 'beta';
    pick?.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect([div.querySelector('.ms__detail'), document.activeElement]).toEqual([null, pick]);
  act(() => root.unmount());
});

test('?project=가 목록에 없으면(옛 북마크) 가장 최근 마을, 마을이 하나도 없으면 안내', async () => {
  list = [P('alpha', 2), P('beta', 1)];
  const a = start('?project=nope');
  await wait(0);
  expect(picked(a.div)).toBe('alpha');
  expect(streams()).toEqual(['alpha']);
  act(() => a.root.unmount());

  list = [];
  const b = start('?project=nope');
  await wait(0);
  expect(b.div.querySelector('.ms__empty')?.textContent).toContain('아직 마을이 없어요');
  act(() => b.root.unmount());
});

test('끊김 칩: --paper 상태 칩 + --st-blocked 원 (글자 대비 AA)', async () => {
  up = false;
  const { div, root } = start();
  await wait(0);
  const chip = div.querySelector('.ms__offline[role="status"] .ui-chip--status');
  expect(chip?.textContent).toContain('수집기 연결 끊김');
  expect(chip?.getAttribute('style')).toBeNull(); // 칩 바탕은 ui.css의 --paper
  expect(chip?.querySelector('.ui-chip__dot')?.getAttribute('style')).toContain('--st-blocked');
  act(() => root.unmount());
});

test('팀원 카드: 회의가 다음 이벤트 없이 끝나면 그 순간 카드도 회의 중 → 휴식', async () => {
  list = [P('alpha', 1)];
  const { div, root } = start();
  await wait(0);
  const s = golden();
  s.meeting = {
    kind: 'kickoff',
    startedAt: Date.now(),
    until: Date.now() + 1000,
    preview: '',
    participants: ['@leader'],
  };
  Object.assign(s.members['@leader'] ?? {}, { status: 'meeting' });
  send(s);
  const leader = () => div.querySelector('[data-member="@leader"] .ui-chip--status')?.textContent;
  expect(leader()).toBe('회의 중 · 광장');
  await wait(1100);
  expect(leader()).toBe('휴식 · 집');
  act(() => root.unmount());
});

test('일터 상세 (M13): 건물 누르기 → ?building=, 마을로 → 마을 (마을은 가리기만), 링크로 바로 열기', async () => {
  list = [P('alpha', 1)];
  const a = start('?project=alpha');
  await wait(0);
  send(golden());
  expect(a.div.querySelector('.ms__detail')).toBeNull();
  act(() => village.onBuildingClick?.('facility:library')); // 시설 상세는 아직 없음 → 그대로
  expect(location.search).toBe('?project=alpha');
  act(() => village.onBuildingClick?.('work:w1:qa-reviewer'));
  expect(location.search).toBe('?project=alpha&building=w1%3Aqa-reviewer');
  expect(a.div.querySelector('.ms--detail .bd-name')?.textContent).toBe('qa-reviewer의 초소');
  expect(a.div.querySelector('.ms__village')).not.toBeNull(); // 카메라·걷던 자리를 지키려고 남겨 둔다
  expect(document.activeElement).toBe(a.div.querySelector('.ms__detail'));
  const back = [...a.div.querySelectorAll('button')].find((b) => b.textContent === '마을로');
  act(() => back?.click());
  expect(location.search).toBe('?project=alpha');
  expect(a.div.querySelector('.ms__detail')).toBeNull();
  act(() => history.pushState(null, '', '?project=alpha&building=w1%3Aqa-reviewer')); // 브라우저 앞으로
  act(() => dispatchEvent(new PopStateEvent('popstate')));
  expect(a.div.querySelector('.ms__detail')).not.toBeNull();
  act(() => a.root.unmount());

  const b = start('?project=alpha&building=w1%3Aqa-reviewer');
  await wait(0);
  send(golden());
  expect(b.div.querySelector('.ms--detail .bd-name')?.textContent).toBe('qa-reviewer의 초소');
  act(() => b.root.unmount());
});

test('뒤로/앞으로는 주소의 마을도 읽는다: 마을을 바꾼 뒤 앞으로 → 원래 마을의 건물 (일터 id는 팀원 기준이라 마을마다 겹친다)', async () => {
  list = [P('alpha', 2), P('beta', 1)];
  const { div, root } = start('?project=alpha');
  await wait(0);
  send(golden());
  act(() => village.onBuildingClick?.('work:w1:qa-reviewer'));
  // 상세를 연 채 드롭다운으로 beta (새 기록, 01 문서 8.2 M9) → 상세 닫힘. 브라우저 뒤로 = 바로 앞 주소(alpha의 건물 상세)
  const pick = div.querySelector<HTMLSelectElement>('.tb__pick select');
  act(() => {
    if (pick) pick.value = 'beta';
    pick?.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect([picked(div), streams(), div.querySelector('.ms__detail')]).toEqual(['beta', ['beta'], null]);
  expect(location.search).toBe('?project=beta');
  const beta = golden();
  Object.assign(beta.buildings['w1:qa-reviewer'] ?? {}, { name: '결제 화면' });
  send(beta);
  act(() => history.back());
  expect(location.search).toBe('?project=alpha&building=w1%3Aqa-reviewer');
  expect([picked(div), streams()]).toEqual(['alpha', ['alpha']]);
  // 다시 beta에서 alpha 건물 주소로 앞으로 (브라우저 앞으로와 같은 popstate) → alpha의 qa-reviewer 일터
  act(() => {
    if (pick) pick.value = 'beta';
    pick?.dispatchEvent(new Event('change', { bubbles: true }));
  });
  send(beta);
  act(() => history.pushState(null, '', '?project=alpha&building=w1%3Aqa-reviewer'));
  act(() => dispatchEvent(new PopStateEvent('popstate')));
  expect([picked(div), streams()]).toEqual(['alpha', ['alpha']]);
  send(golden());
  expect(div.querySelector('.ms--detail .bd-name')?.textContent).toBe('qa-reviewer의 초소');
  act(() => root.unmount());
});

test('마을에서 연 상세를 닫으면 뒤로 가기: 기록이 쌓이지 않고, 앞으로 가면 다시 상세', async () => {
  list = [P('alpha', 1)];
  const { div, root } = start('?project=alpha');
  await wait(0);
  send(golden());
  const len = history.length;
  const back = () => [...div.querySelectorAll('button')].find((b) => b.textContent === '마을로');
  for (let i = 0; i < 2; i++) {
    act(() => village.onBuildingClick?.('work:w1:qa-reviewer'));
    act(() => back()?.click());
    expect([location.search, div.querySelector('.ms__detail')]).toEqual(['?project=alpha', null]);
  }
  expect(history.length).toBe(len + 1); // 열 때 하나만 (pushState로 닫으면 +4)
  act(() => history.forward());
  expect(div.querySelector('.ms--detail .bd-name')?.textContent).toBe('qa-reviewer의 초소');
  act(() => root.unmount());
});

test('집·상점·경제 (M7): 카드 → 강조 + 집, 집 → 상점 → 집으로 → 마을로는 뒤로 가기, 마을의 집·상단 바 칩, 링크로 바로 열기', async () => {
  list = [P('alpha', 1)];
  const a = start('?project=alpha');
  await wait(0);
  send(golden());
  const len = history.length;
  const button = (text: string) =>
    [...a.div.querySelectorAll<HTMLButtonElement>('.ms__detail button')].find((b) => b.textContent === text);
  const card = a.div.querySelector<HTMLButtonElement>('button.tp-card[data-member="qa-reviewer"]');
  card?.focus(); // 브라우저는 누른 버튼에 포커스 (happy-dom click은 안 줌)
  act(() => card?.click());
  expect(location.search).toBe('?project=alpha&house=qa-reviewer');
  expect(card?.getAttribute('aria-pressed')).toBe('true');
  expect(a.div.querySelector('.ms--detail .hs-name')?.textContent).toBe('qa-reviewer');
  act(() => button('가구 사러 가기')?.click());
  expect(location.search).toBe('?project=alpha&shop=qa-reviewer');
  expect(document.activeElement).toBe(a.div.querySelector('.ms__detail')); // 누른 버튼이 사라졌다 → 새 상세로
  expect(a.div.querySelector('.ms--detail .sh-who[aria-checked="true"]')?.getAttribute('data-member')).toBe(
    'qa-reviewer',
  );
  act(() => button('집으로')?.click());
  expect(location.search).toBe('?project=alpha&house=qa-reviewer');
  act(() => button('마을로')?.click());
  expect([location.search, a.div.querySelector('.ms__detail'), history.length]).toEqual([
    '?project=alpha',
    null,
    len + 2, // 집·상점을 열 때만 (돌아올 때는 뒤로)
  ]);
  expect(document.activeElement).toBe(card); // 처음 연 버튼으로

  // 마을의 집 (id에 @) → 집, 상단 바 금고·마을 기금 → 경제, 경제의 "마을" → 마을
  act(() => village.onBuildingClick?.('house:@leader'));
  expect(location.search).toBe('?project=alpha&house=%40leader');
  expect(a.div.querySelector('.ms--detail .hs-name')?.textContent).toBe(golden().members['@leader']?.name);
  act(() => a.div.querySelector<HTMLButtonElement>('.tb__chip--vault')?.click());
  expect(location.search).toBe('?project=alpha&economy');
  expect(a.div.querySelector('.ms--detail .ec')).not.toBeNull();
  act(() => button('마을')?.click());
  expect([location.search, a.div.querySelector('.ms__detail')]).toEqual(['?project=alpha', null]);
  // 시청 → 경제 패널 (시청 금고 = 마을 기금, 06 문서 6.4)
  act(() => village.onBuildingClick?.('hall'));
  expect(location.search).toBe('?project=alpha&economy');
  act(() => button('마을')?.click());
  act(() => a.root.unmount());

  for (const [q, sel] of [
    ['&house=backend-dev', '.hs-name'],
    ['&shop=backend-dev', '.sh-who[aria-checked="true"]'],
    ['&economy', '.ec-title'],
  ] as const) {
    const b = start(`?project=alpha${q}`);
    await wait(0);
    send(golden());
    expect(b.div.querySelector(`.ms--detail ${sel}`), q).not.toBeNull();
    act(() => b.root.unmount());
  }
});
