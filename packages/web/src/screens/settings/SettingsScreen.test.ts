// @vitest-environment happy-dom
// 설정 화면 (01 문서 10장 화면 메모 M9): 바다 이름으로 고르고 정본 id로, 바꾼 것만 보낸다. 햄스터 소품 잠금, 하루 길이 검사, 저장 결과 알림
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { defaultConfig as cfg, type VillageState } from '@tycoon/core';
import { SettingsScreen } from './SettingsScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const golden = () =>
  JSON.parse(
    readFileSync(join(import.meta.dirname, '../../../../../fixtures/sample-session.golden.json'), 'utf8'),
  ) as VillageState;
afterEach(() => vi.unstubAllGlobals());

function render(s: VillageState, c = cfg) {
  const div = document.body.appendChild(document.createElement('div'));
  const root = createRoot(div);
  act(() =>
    root.render(
      h(SettingsScreen, { state: s, cfg: c, projectId: 'p', onBack: () => {}, cwd: '/w/app', connected: true }),
    ),
  );
  return { div, unmount: () => act(() => root.unmount()) };
}
const row = (div: Element, id: string) => div.querySelector(`[data-member="${id}"]`);
const selects = (div: Element, id: string) => [...(row(div, id)?.querySelectorAll('select') ?? [])];
const pick = (el: HTMLSelectElement | HTMLInputElement | null | undefined, value: string) =>
  act(() => {
    if (!el) return;
    // React가 value 세터를 가로채므로 원래 세터로 넣고 이벤트
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));

test('팀원 줄: 떠나지 않은 팀원과 팀장, 바다 이름으로 보이고 햄스터 소품은 잠금', () => {
  const r = render(golden());
  expect([...r.div.querySelectorAll('[data-member]')].map((e) => e.getAttribute('data-member'))).toEqual([
    '@leader',
    'backend-dev',
    'frontend-dev',
    'qa-reviewer',
  ]);
  const [species, job, acc] = selects(r.div, 'backend-dev');
  // 정본 bear = 바다 점박이물범, 동물 목록에 외부인(복어)은 없다. 동물 도감(D15) 5종도 고를 수 있다
  expect(species?.selectedOptions[0]?.textContent).toBe('점박이물범');
  expect([...(species?.options ?? [])].map((o) => o.textContent)).toEqual([
    '점박이물범',
    '수달',
    '골든햄스터',
    '바다거북',
    '펭귄',
    '북극곰',
    '바다코끼리',
    '바다사자',
    '갈매기',
    '해달',
    '흰동가리',
    '퍼핀',
    '듀공',
    '플라밍고',
    '하프물범',
    '붉은바다거북',
    '갈색펠리컨',
    '코끼리물범',
    '황제펭귄 아기',
    '바다이구아나',
  ]);
  expect(job?.selectedOptions[0]?.textContent).toBe('백엔드');
  // 소품: 헤드랜턴 하나(glasses·magnifier가 한 곳으로), 없음 포함
  expect([...(acc?.options ?? [])].map((o) => o.textContent)).toEqual([
    '없음',
    '헤드랜턴',
    '불가사리 핀',
    '선장 모자',
    '모자',
  ]);
  const [, , hamster] = selects(r.div, 'qa-reviewer'); // raccoon = 햄스터
  expect([hamster?.disabled, hamster?.selectedOptions[0]?.textContent]).toEqual([true, '씨워크 헬멧 (고정)']);
  // 아무것도 안 바꾸면 저장 버튼은 꺼짐
  expect(r.div.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
  r.unmount();
});

test('저장: 바꾼 팀원·하루 길이만 정본 id로 보내고, 쓴 파일·백업을 알린다. 실패 까닭도', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const r = render(golden());
  const [species, , acc] = selects(r.div, 'backend-dev');
  pick(species, 'rabbit'); // 수달
  pick(acc, 'starfishPin');
  const day = r.div.querySelector<HTMLInputElement>('input[type="number"]');
  expect(day?.value).toBe('60');
  pick(day, '0');
  const save = r.div.querySelector<HTMLButtonElement>('button[type="submit"]');
  expect([day?.getAttribute('aria-invalid'), save?.disabled]).toEqual(['true', true]);
  expect(r.div.textContent).toContain('1~1440분');
  pick(day, '30');
  expect(save?.disabled).toBe(false);
  fetch.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        path: '/h/.subagent-tycoon/settings/p.json',
        backup: '/h/.subagent-tycoon/settings/p.json.bak',
      }),
    ),
  );
  act(() => save?.click());
  await flush();
  const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
  expect([url, init.method]).toEqual(['/api/projects/p/settings', 'PUT']);
  expect(JSON.parse(String(init.body))).toEqual({
    members: { 'backend-dev': { species: 'rabbit', job: 'backend', accessory: 'beret' } },
    gameDayMs: 1_800_000,
  });
  const msg = r.div.querySelector('.st-msg')?.textContent ?? '';
  expect(msg).toContain('/h/.subagent-tycoon/settings/p.json');
  expect(msg).toContain('p.json.bak');
  expect(save?.disabled).toBe(true); // 보낸 뒤엔 상태(SSE)가 새 값을 가져온다

  // 헤드랜턴은 정본 첫 키(glasses)로, 팀장은 leader로. 깨진 파일이면 그 까닭
  const [, , lead] = selects(r.div, '@leader');
  pick(lead, 'headlamp');
  fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'unreadable' }), { status: 409 }));
  act(() => save?.click());
  await flush();
  // 앞 저장은 끝나서 고친 값이 비었다 → 이번엔 팀장만
  expect(JSON.parse(String((fetch.mock.calls[1] as [string, RequestInit])[1].body))).toEqual({
    leader: { species: 'penguin', job: 'lead', accessory: 'glasses' },
  });
  expect(r.div.querySelector('.st-msg .st-meta--error')?.textContent).toContain('올바른 JSON이 아니라');
  r.unmount();
});

test('훅 설치 안내: 연결 상태, 훅 주소, 예시 settings.json 복사', async () => {
  const writeText = vi.fn(() => Promise.resolve());
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  const r = render(golden());
  const guide = r.div.querySelector('.hg');
  expect(guide?.textContent).toContain('연결됨');
  expect(guide?.textContent).toContain('http://127.0.0.1:4777/hook');
  const code = guide?.querySelector('pre')?.textContent ?? '';
  expect(JSON.parse(code)).toHaveProperty('hooks.SessionStart');
  expect(code).toContain('"async": true');
  act(() => [...(guide?.querySelectorAll('button') ?? [])].find((b) => b.textContent === '복사')?.click());
  await flush();
  expect(writeText).toHaveBeenCalledWith(code);
  expect(guide?.querySelector('[role="status"]')?.textContent).toBe('복사했어요');
  r.unmount();
});

test('손으로 적은 목록 밖 값은 그대로 보이고, 하루 길이가 분 단위가 아니어도(e2e 2초) 다른 칸 저장은 된다 (M9 리뷰)', async () => {
  const fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ path: '/x', backup: null }))));
  vi.stubGlobal('fetch', fetch);
  const s = golden();
  Object.assign(s.members['qa-reviewer'] ?? {}, { job: 'devops', species: 'fox', accessory: 'monocle' });
  const r = render(s, { ...cfg, time: { ...cfg.time, gameDayMs: 2000 } });
  const [species, job, acc] = selects(r.div, 'qa-reviewer');
  expect([species?.value, species?.selectedOptions[0]?.textContent]).toEqual(['fox', 'fox']);
  expect([job?.value, job?.selectedOptions[0]?.textContent]).toEqual(['devops', 'devops']);
  expect(acc?.selectedOptions[0]?.textContent).toBe('monocle');
  expect(r.div.querySelector('form')?.noValidate).toBe(true);
  pick(job, 'qa');
  act(() => r.div.querySelector<HTMLButtonElement>('button[type="submit"]')?.click());
  await flush();
  expect(JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({
    members: { 'qa-reviewer': { species: 'fox', job: 'qa', accessory: 'monocle' } },
  });
  r.unmount();
});
