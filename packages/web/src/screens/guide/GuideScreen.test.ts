// @vitest-environment happy-dom
// 설명서 (M17, 06 문서 11장): 목차 11장, 장 바꾸기, 규칙 숫자는 cfg에서, 바다 이름은 이름 사전에서 (05 문서 3장), 설정 화면 링크
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';
import { defaultConfig as cfg, type GameConfig, type VillageState } from '@tycoon/core';
import sea from '../../../../../design/theme-map.sea.json';
import { SettingsScreen } from '../settings/SettingsScreen';
import { GuideScreen, SECTIONS } from './GuideScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const golden = () =>
  JSON.parse(
    readFileSync(join(import.meta.dirname, '../../../../../fixtures/sample-session.golden.json'), 'utf8'),
  ) as VillageState;

function render(section: string, c: GameConfig = cfg, onSection = vi.fn()) {
  const div = document.body.appendChild(document.createElement('div'));
  const root = createRoot(div);
  act(() =>
    root.render(h(GuideScreen, { state: golden(), cfg: c, projectId: 'p', onBack: () => {}, section, onSection })),
  );
  const body = () => div.querySelector('article')?.textContent ?? '';
  return { div, body, onSection, unmount: () => act(() => root.unmount()) };
}

test('목차 11장: 누르면 onSection(장 id), 지금 장만 aria-current. 빈 값·모르는 id는 첫 장', () => {
  const r = render('');
  const items = [...r.div.querySelectorAll<HTMLButtonElement>('nav button')];
  expect(items.map((b) => b.dataset.section)).toEqual([...SECTIONS]);
  expect(items).toHaveLength(11);
  expect(items.map((b) => b.getAttribute('aria-current'))).toEqual(['true', ...Array(10).fill(null)]);
  expect(r.div.querySelector('article')?.dataset.section).toBe('start');
  act(() => items[2]?.click());
  expect(r.onSection).toHaveBeenCalledWith('growth');
  r.unmount();

  const g = render('growth');
  expect(g.div.querySelector('h2')?.textContent).toBe('마을이 크는 법');
  expect(g.div.querySelector('[aria-current="true"]')?.textContent).toBe('마을이 크는 법');
  g.unmount();
  expect(render('nope').div.querySelector('article')?.dataset.section).toBe('start');
});

test('모든 장: 빠진 사전 키·채우지 않은 {자리} 없음, 그림 장엔 실제 에셋·캐릭터', () => {
  for (const id of SECTIONS) {
    const r = render(id);
    expect(r.div.textContent, id).not.toMatch(/guide\.|weather\.|works\.|\{\w+\}/);
    r.unmount();
  }
  const g = render('growth');
  // 일터 1층·2층·3층·큰 건물 + 시대별 시청 (data-asset-id 유지)
  const ids = [...g.div.querySelectorAll('[data-asset-id^="body."]')].map((e) => e.getAttribute('data-asset-id'));
  expect(ids).toEqual([
    ...['body.coral-1f', 'body.wreck-2f', 'body.wreck-3f', 'body.big-wreck'],
    ...['body.hall-village', 'body.hall-town', 'body.hall-city', 'body.hall-capital'],
  ]);
  expect(g.div.querySelectorAll('[data-icon^="era"]')).toHaveLength(4);
  g.unmount();
  const m = render('members');
  expect(m.div.querySelectorAll('[data-asset-id$=".stand"]').length).toBeGreaterThanOrEqual(8); // 팀장·팀원·외부인·변형
  m.unmount();
  const w = render('news');
  expect([...w.div.querySelectorAll('[data-icon]')].map((e) => e.getAttribute('data-icon'))).toEqual([
    'storm',
    'cloudy',
    'rainbow',
    'sunny',
    'calm',
  ]);
  w.unmount();
});

test('규칙 숫자는 cfg에서: 급여·세금·층·레벨·날씨 기준을 바꾸면 글자도 바뀐다', () => {
  const c: GameConfig = {
    ...cfg,
    economy: { ...cfg.economy, wagePerCall: 31, taxRate: 0.25 },
    workplace: { ...cfg.workplace, levels: cfg.workplace.levels.map((l, i) => (i === 1 ? { ...l, points: 777 } : l)) },
    village: { ...cfg.village, levels: cfg.village.levels.slice(0, 7) },
    weather: { ...cfg.weather, stormBlocked: 4 },
  };
  const e = render('economy', c);
  expect(e.body()).toContain('급여 = 31 × 도구 호출 수 × 품질');
  expect(e.body()).toContain('급여의 25%');
  expect(e.body()).toContain(`급여 ${(31 * 15).toLocaleString('ko-KR')}`);
  e.unmount();
  const g = render('growth', c);
  expect(g.body()).toContain('777');
  expect(g.div.querySelectorAll('table')[1]?.querySelectorAll('tbody tr')).toHaveLength(7); // 레벨 표 = cfg 줄 수
  expect(g.body()).toContain('Lv.7에는'); // 마지막 레벨
  g.unmount();
  const w = render('news', c);
  expect(w.body()).toContain('막힌 팀원 4명 이상');
  w.unmount();
});

test('바다 이름은 화면 코드·설명서 글자에 직접 쓰지 않는다 (이름 사전 자리로)', () => {
  const dir = import.meta.dirname;
  const code = readdirSync(dir)
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n');
  const i18n = readFileSync(join(dir, '../../i18n.ts'), 'utf8');
  const block = i18n.slice(i18n.indexOf('\n  guide: {'), i18n.indexOf('\n  // M18'));
  expect(block.length).toBeGreaterThan(1000);
  const L = sea.labels;
  const names = [
    L.town,
    L.currency,
    L.vault,
    ...[L.facilities, L.buildings, L.eras, L.works, L.species, L.speciesShort].flatMap((o) => Object.values(o)),
  ];
  expect(names).toContain('진주');
  for (const n of names) {
    expect(code, n).not.toContain(n);
    expect(block, n).not.toContain(n);
  }
});

test('설정 화면 머리 줄의 "설명서 보기" → onGuide', () => {
  const onGuide = vi.fn();
  const div = document.body.appendChild(document.createElement('div'));
  const root = createRoot(div);
  act(() =>
    root.render(
      h(SettingsScreen, {
        state: golden(),
        cfg,
        projectId: 'p',
        onBack: () => {},
        cwd: '/w',
        connected: true,
        onGuide,
      }),
    ),
  );
  const link = [...div.querySelectorAll('button')].find((b) => b.textContent === '설명서 보기');
  act(() => link?.click());
  expect(onGuide).toHaveBeenCalledOnce();
  act(() => root.unmount());
});
