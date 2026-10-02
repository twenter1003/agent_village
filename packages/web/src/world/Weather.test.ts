// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement as h, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import type { WeatherKind } from '@tycoon/core';
import { tokens } from '../tokens';
import { CameraWeather, Weather } from './Weather';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const html = (kind: WeatherKind, still = false) => renderToStaticMarkup(h(Weather, { kind, still }));
const count = (s: string, cls: string) => s.split(new RegExp(`class="[^"]*\\b${cls}\\b`)).length - 1;

test('날씨별 겹 (06 문서 10장): 폭풍 어둠·탁함·해류·소용돌이, 흐림 탁함만, 무지개 물결, 맑음 빛줄기, 잔잔 없음', () => {
  const storm = html('storm');
  expect([
    count(storm, 'wx__murk'),
    count(storm, 'wx__dark'),
    count(storm, 'wx__current'),
    count(storm, 'wx__swirl'),
  ]).toEqual([1, 1, 2, 3]);
  const cloudy = html('cloudy');
  expect([count(cloudy, 'wx__murk'), count(cloudy, 'wx__dark'), count(cloudy, 'wx__move')]).toEqual([1, 0, 0]);
  expect(count(html('rainbow'), 'wx__caustic')).toBe(2);
  expect(count(html('rainbow'), 'wx__murk')).toBe(0);
  expect(count(html('sunny'), 'wx__rays')).toBe(2);
  expect(html('calm')).toBe('');
});

test('동작 줄이기·거품 끔(still)이면 물빛만 — 움직이는 겹이 없다', () => {
  for (const k of ['storm', 'cloudy', 'rainbow', 'sunny'] as const) expect(count(html(k, true), 'wx__move')).toBe(0);
  expect([count(html('storm', true), 'wx__murk'), count(html('storm', true), 'wx__dark')]).toEqual([1, 1]);
});

test('색은 토큰만, 겹은 누르기를 막지 않는다', () => {
  const all = (['storm', 'cloudy', 'rainbow', 'sunny'] as const).map((k) => html(k)).join('');
  const css = readFileSync(join(import.meta.dirname, 'weather.css'), 'utf8');
  const used = [...`${all}${css}`.matchAll(/var\(--([\w-]+)\)/g)].map((m) => m[1] ?? '');
  expect(used.filter((v) => !(v in tokens))).toEqual([]);
  expect(css).toMatch(/\.wx \{[^}]*pointer-events: none/);
});

test('CameraWeather: 카메라 칸의 변환 div 바로 뒤(확대 버튼 앞)에 붙고, 내리면 떼어진다', () => {
  // Camera 모양: 루트 > [변환 div > 마을] + 확대 버튼 칸
  function Cam() {
    const ref = useRef<HTMLDivElement>(null);
    return h('div', { id: 'cam' }, [
      h('div', { key: 'frame', id: 'frame' }, h('div', { ref }, h(CameraWeather, { anchor: ref, kind: 'storm' }))),
      h('div', { key: 'buttons', id: 'buttons' }),
    ]);
  }
  const div = document.body.appendChild(document.createElement('div'));
  const root = createRoot(div);
  act(() => root.render(h(Cam)));
  const ids = [...(div.querySelector('#cam')?.children ?? [])].map((e) => e.id || e.firstElementChild?.className);
  expect(ids).toEqual(['frame', 'wx', 'buttons']);
  expect(div.querySelector('#frame .wx')).toBeNull(); // 변환(카메라 줌) 밖
  act(() => root.unmount());
  expect(document.querySelector('.wx')).toBeNull();
});
