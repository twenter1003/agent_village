import { afterEach, expect, test, vi } from 'vitest';
import { RETRY_MS, subscribeVillage } from './api';

// 가짜 EventSource: 테스트가 open/state/error를 직접 일으킨다
class FakeES {
  static CLOSED = 2;
  static all: FakeES[] = [];
  readyState = 0;
  closed = false;
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
    this.closed = true;
    this.readyState = FakeES.CLOSED;
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  FakeES.all = [];
});

test('state 이벤트를 받고, 수집기가 죽으면 끊었다가 살아나면 다시 연다', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('EventSource', FakeES);
  let up = true;
  vi.stubGlobal('fetch', () => (up ? Promise.resolve({ ok: true }) : Promise.reject(new Error('down'))));
  const states: unknown[] = [];
  const conn: boolean[] = [];
  const cfgs: unknown[] = [];
  const stop = subscribeVillage(
    'p1',
    (s) => states.push(s),
    (c) => conn.push(c),
    (c) => cfgs.push(c),
  );
  const a = FakeES.all[0];
  expect(a?.url).toBe('/api/projects/p1/stream');
  a?.listeners.config?.({ data: '{"buildings":{"twoStoryFrom":4}}' });
  a?.listeners.config?.({ data: '{깨짐' });
  a?.listeners.state?.({ data: '{"project":"p1"}' });
  a?.listeners.state?.({ data: '{깨짐' });
  expect(states).toEqual([{ project: 'p1' }]);
  expect(cfgs).toEqual([{ buildings: { twoStoryFrom: 4 } }]); // 수집기 설정 (02 문서 9장 event: config)

  // 살아 있고 연결도 있으면 아무것도 안 한다 (잠깐 끊김은 EventSource가 스스로)
  await vi.advanceTimersByTimeAsync(RETRY_MS);
  expect(FakeES.all).toHaveLength(1);

  // 수집기가 죽음: 프록시 뒤라 onerror가 안 와도 확인에서 알아채고 끊는다
  up = false;
  await vi.advanceTimersByTimeAsync(RETRY_MS);
  expect(a?.closed).toBe(true);
  expect(conn.at(-1)).toBe(false);

  // 살아남 → 새 연결 (첫 프레임이 전체 스냅샷)
  up = true;
  await vi.advanceTimersByTimeAsync(RETRY_MS);
  expect(FakeES.all).toHaveLength(2);

  // 502 → CLOSED → 다음 확인 때 다시 연다
  const b = FakeES.all[1];
  if (b) b.readyState = FakeES.CLOSED;
  b?.onerror?.();
  await vi.advanceTimersByTimeAsync(RETRY_MS);
  expect(FakeES.all).toHaveLength(3);

  stop();
  expect(FakeES.all[2]?.closed).toBe(true);
});
