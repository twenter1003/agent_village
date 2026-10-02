// M17 설명서 (06 문서 11장, D29): 상단 바 "?" → 설명서(&guide), 목차를 누르면 장이 바뀌고 주소에 &guide=<장 id>,
// 뒤로 가기 = 앞 장, 주소로 바로 연 장, 설정 화면의 "설명서 보기". 글자·숫자·그림 규칙은 packages/web/src/screens/guide/GuideScreen.test.ts
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const COLLECTOR = 'http://127.0.0.1:4798'; // playwright.config.ts
const root = resolve(import.meta.dirname, '..');
const SHOTS = process.env.SHOTS;
const SESSION = 'm17g'; // 수집기는 세션을 첫 마을에 묶는다 → 다른 spec과 다른 세션

let cwd = '';
let pid = '';
const post = async (e: Record<string, unknown>) => {
  const r = await fetch(`${COLLECTOR}/hook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session_id: SESSION, cwd, ...e }),
  });
  expect(r.status).toBe(204);
};
const shot = (page: Page, name: string) => (SHOTS ? page.screenshot({ path: join(SHOTS, name) }) : undefined);

test.beforeAll(async () => {
  cwd = mkdtempSync(join(tmpdir(), 'tycoon-m17g-'));
  cpSync(join(root, 'examples/target-project/.claude'), join(cwd, '.claude'), { recursive: true });
  await post({ hook_event_name: 'SessionStart', source: 'startup' });
  const list = (await (await fetch(`${COLLECTOR}/api/projects`)).json()) as { id: string; cwd: string }[];
  pid = encodeURIComponent(list.find((p) => p.cwd === cwd)?.id ?? '');
  expect(pid).not.toBe('');
});
test.afterAll(async () => {
  if (pid) await post({ hook_event_name: 'SessionEnd' });
});

test('설명서: "?" → 목차 → 장 바꾸기(주소 &guide=<id>, 뒤로 가기), 주소로 바로 열기, 설정에서 링크', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?project=${pid}`);
  await page.getByRole('button', { name: '설명서', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`\\?project=${pid}&guide$`));
  await expect(page.getByRole('heading', { name: '설명서', level: 1 })).toBeVisible();
  const toc = page.getByRole('navigation', { name: '설명서 목차' });
  await expect(toc.getByRole('button')).toHaveCount(11);
  await expect(page.getByRole('heading', { name: '시작하기', level: 2 })).toBeVisible();

  await toc.getByRole('button', { name: '마을이 크는 법' }).click();
  await expect(page).toHaveURL(new RegExp(`&guide=growth$`));
  await expect(page.getByRole('heading', { name: '마을이 크는 법', level: 2 })).toBeVisible();
  await expect(toc.getByRole('button', { name: '마을이 크는 법' })).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('article [data-asset-id^="body.hall-"]')).toHaveCount(4); // 실제 에셋 그림
  await shot(page, 'm17-guide-growth.png');

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`&guide$`));
  await expect(page.getByRole('heading', { name: '시작하기', level: 2 })).toBeVisible();

  await page.goto(`/?project=${pid}&guide=privacy`);
  await expect(page.getByRole('heading', { name: '개인정보', level: 2 })).toBeVisible();

  await page.goto(`/?project=${pid}&settings`);
  await page.getByRole('button', { name: '설명서 보기' }).click();
  await expect(page).toHaveURL(new RegExp(`&guide$`));
  await expect(page.getByRole('heading', { name: '설명서', level: 1 })).toBeVisible();
});
