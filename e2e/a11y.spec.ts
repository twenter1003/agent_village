// M10 접근성 점검 (04 문서 M10, 03 문서 5장): 모든 화면에서 (1) Tab 멈춤마다 3px --focus 링, (2) 누르는 것·입력은 이름이 있고
// 진짜 button/a/select/input, (3) 상태 칩은 색 + 아이콘. 픽스처 훅 → 수집기(:4798) → 마을·격자·집·상점·건물·경제·설정
import { cpSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const COLLECTOR = 'http://127.0.0.1:4798'; // playwright.config.ts
const root = resolve(import.meta.dirname, '..');
const SESSION = 'm10a';
let cwd = '';
let pid = '';
let building = '';

const post = (e: Record<string, unknown>) =>
  fetch(`${COLLECTOR}/hook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...e, session_id: SESSION, cwd }),
  });

test.beforeAll(async () => {
  cwd = mkdtempSync(join(tmpdir(), 'tycoon-m10a-'));
  cpSync(join(root, 'examples/target-project/.claude'), join(cwd, '.claude'), { recursive: true });
  for (const line of readFileSync(join(root, 'fixtures/sample-session.jsonl'), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const e = JSON.parse(line) as Record<string, unknown>;
    delete e._t;
    delete e._synthetic;
    expect((await post(e)).status).toBe(204);
  }
  const list = (await (await fetch(`${COLLECTOR}/api/projects`)).json()) as { id: string; cwd: string }[];
  pid = encodeURIComponent(list.find((p) => p.cwd === cwd)?.id ?? '');
  await expect
    .poll(async () => {
      const s = (await (await fetch(`${COLLECTOR}/api/projects/${pid}/state`)).json()) as {
        buildings: Record<string, unknown>;
      };
      return (building = Object.keys(s.buildings)[0] ?? '');
    })
    .not.toBe('');
});
test.afterAll(async () => {
  if (pid) await post({ hook_event_name: 'SessionEnd' });
});

/** Tab을 끝까지 눌러 멈춤마다 링을 본다. 링이 없는 멈춤 목록 */
async function tabStops(page: Page) {
  await page.locator('body').click({ position: { x: 1, y: 1 } }); // 포커스를 문서 처음으로
  const seen: string[] = [];
  const bad: string[] = [];
  for (let i = 0; i < 150; i++) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const probe = document.body.appendChild(document.createElement('i'));
      probe.style.color = 'var(--focus)';
      const focus = getComputedStyle(probe).color;
      probe.remove();
      const cs = getComputedStyle(el);
      const ring = cs.outlineStyle === 'solid' && cs.outlineWidth === '3px' && cs.outlineColor === focus;
      const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30);
      const again = el.hasAttribute('data-a11y-seen'); // 한 바퀴 돌았다
      el.setAttribute('data-a11y-seen', '');
      return { again, ring, label: `${el.tagName} ${name}` };
    });
    if (!stop || stop.again) break;
    seen.push(stop.label);
    if (!stop.ring) bad.push(stop.label);
  }
  return { count: seen.length, bad };
}

/** 보이는 누르는 것·입력 중 이름이 없거나 진짜 요소가 아닌 것 */
const unnamed = (page: Page) =>
  page.evaluate(() => {
    const visible = (e: Element) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
    };
    const name = (e: Element) => {
      const by = e.getAttribute('aria-labelledby');
      return (
        e.getAttribute('aria-label') ||
        (by && document.getElementById(by)?.textContent) ||
        ((e as HTMLInputElement).labels?.[0]?.textContent ?? '') ||
        e.textContent ||
        e.getAttribute('title') ||
        ''
      ).trim();
    };
    const out: string[] = [];
    for (const e of document.querySelectorAll('button, a[href], select, input, [role="button"], [tabindex="0"]')) {
      if (!visible(e)) continue;
      if (!name(e)) out.push(`${e.tagName}.${e.className} 이름 없음`);
      if (e.getAttribute('role') === 'button' && e.tagName !== 'BUTTON') out.push(`${e.tagName} role=button`);
    }
    // 상태 = 색 + 아이콘 (03 문서 5장)
    for (const c of document.querySelectorAll('.ui-chip--status'))
      if (visible(c) && !c.querySelector('.ui-chip__dot svg')) out.push(`상태 칩 아이콘 없음: ${c.textContent}`);
    return out;
  });

test('접근성: 모든 화면의 Tab 멈춤은 3px --focus 링, 누르는 것은 이름 있는 진짜 요소, 상태는 색 + 아이콘', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const screens: [string, string][] = [
    ['마을', ''],
    ['격자', '&grid'],
    ['집', '&house=backend-dev'],
    ['상점', '&shop=backend-dev'],
    ['건물', `&building=${encodeURIComponent(building)}`],
    ['경제', '&economy'],
    ['설정', '&settings'],
  ];
  const report: Record<string, { count: number; bad: string[]; unnamed: string[] }> = {};
  for (const [name, q] of screens) {
    await page.goto(`/?project=${pid}${q}`);
    await expect(page.locator('.tb')).toBeVisible();
    await page.waitForTimeout(400); // 첫 스냅샷
    const stops = await tabStops(page);
    report[name] = { ...stops, unnamed: await unnamed(page) };
  }
  console.log(JSON.stringify(report, null, 1));
  for (const [name, r] of Object.entries(report)) {
    expect([name, r.bad]).toEqual([name, []]);
    expect([name, r.unnamed]).toEqual([name, []]);
    expect(r.count).toBeGreaterThan(5);
  }
});
