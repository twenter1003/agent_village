// @vitest-environment happy-dom
// 마을 신문 화면 (06 문서 9장): 1면·기사·단신·옆 칸, 회의 안건 글자 끔 → 요약 가림, 달력(점·날짜 고르기·달 넘기기), 빈 날
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { defaultConfig as cfg, type Task, type VillageState } from '@tycoon/core';
import { setPrefs } from '../../live/prefs';
import { NewsScreen } from './NewsScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const at = (d: number, h: number) => new Date(2026, 9, d, h).getTime();
const task = (id: string, subject: string, toolCalls: number, x: Partial<Task> = {}): Task => ({
  id,
  subject,
  status: 'completed',
  createdAt: at(3, 9),
  startedAt: at(3, 9),
  completedAt: at(3, 10),
  contributions: { 'backend-dev': 1000 },
  quality: 'noTests',
  toolCalls,
  salaryPaid: 0,
  ...x,
});

function village(): VillageState {
  const s = JSON.parse(
    readFileSync(join(import.meta.dirname, '../../../../../fixtures/sample-session.golden.json'), 'utf8'),
  ) as VillageState;
  s.tasks = {
    a: task('a', '주문 목록 API', 12, { quality: 'testsPassed', summary: '주문 목록 API를 붙였어요.' }),
    b: task('b', '주문 화면', 6, { contributions: { 'frontend-dev': 1 }, summary: '화면을 그렸어요.' }),
    c: task('c', '오타 고침', 1),
  };
  const r = Object.values(s.runs)[0];
  if (r) s.runs = { [r.runId]: { ...r, endedAt: at(3, 10) } };
  return s;
}

const onDate = vi.fn();
const roots: Root[] = [];
/** 그린 뒤 경제 기록 받기(실패 → 상태의 기록)까지 기다린다 */
async function render(date: string, s = village()) {
  const div = document.body.appendChild(document.createElement('div'));
  const root = createRoot(div);
  roots.push(root);
  act(() => root.render(h(NewsScreen, { state: s, cfg, projectId: 'p', onBack: () => {}, date, onDate })));
  await act(async () => {});
  return div;
}
const text = (root: Element, sel: string) => root.querySelector(sel)?.textContent ?? '';
const click = (el: Element | null | undefined) => act(() => (el as HTMLElement).click());
const button = (root: Element, label: string) => root.querySelector(`button[aria-label^="${label}"]`);

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('down'))),
  );
});
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  vi.unstubAllGlobals();
  setPrefs({ speech: true });
  onDate.mockClear();
  document.body.replaceChildren();
});

test('1면·기사·단신·옆 칸', async () => {
  const div = await render('2026-10-03');
  expect(text(div, '.nw-headline')).toBe('주문 목록 API');
  expect(text(div, '.nw-front .nw-summary')).toBe('주문 목록 API를 붙였어요.');
  expect(text(div, '.nw-front')).toContain('도구 12번');
  expect(text(div, '.nw-front')).toContain('테스트 통과');
  expect(div.querySelector('.nw-front .bd-face')).not.toBeNull(); // 기여가 가장 큰 팀원 얼굴
  expect(text(div, '.nw-sub .nw-subhead')).toBe('주문 화면');
  expect(text(div, '.nw-briefs')).toContain('오타 고침');
  expect(text(div, '.nw-facts')).toContain('끝낸 작업3');
  expect(text(div, '.ec-title')).toBe('마을 신문');
});

test('회의 안건 글자를 끄면 요약을 가린다', async () => {
  setPrefs({ speech: false });
  const div = await render('2026-10-03');
  expect(text(div, '.nw-front .nw-summary')).toBe('…');
  expect(text(div, '.nw-headline')).toBe('주문 목록 API'); // 제목은 그대로
});

test('달력: 일한 날에 점, 날짜 누르면 onDate, 달 넘기기', async () => {
  const div = await render('2026-10-03');
  const day3 = button(div, '10월 3일');
  expect(day3?.getAttribute('aria-pressed')).toBe('true');
  expect(day3?.querySelector('.nw-dot')).not.toBeNull();
  expect(button(div, '10월 4일')?.querySelector('.nw-dot')).toBeNull();
  click(button(div, '10월 4일'));
  expect(onDate).toHaveBeenCalledWith('2026-10-04');
  click(button(div, '이전 달'));
  expect(text(div, '.nw-cal h2')).toBe('2026년 9월');
  expect(div.querySelectorAll('.nw-days button')).toHaveLength(30);
  click(button(div, '다음 달'));
  click(button(div, '다음 달'));
  expect(text(div, '.nw-cal h2')).toBe('2026년 11월');
});

test('일이 없는 날은 빈 신문 안내, 틀린 날짜는 오늘', async () => {
  const div = await render('2026-09-01');
  expect(text(div, '[role="status"]')).toContain('이날은 끝낸 작업이 없어요');
  expect(text(div, '.nw-facts')).toContain('기록 없음');
  const now = new Date();
  const bad = await render('nope');
  expect(text(bad, '.nw-cal h2')).toBe(`${now.getFullYear()}년 ${now.getMonth() + 1}월`);
  expect(bad.querySelector('.nw-days [aria-current="date"]')?.getAttribute('aria-pressed')).toBe('true');
});
