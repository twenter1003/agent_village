// M9 격자 보기·마을 전환·알림 목록 (01 문서 8.1·8.2·8.3 화면 메모): 훅 → 수집기(:4798) → 화면.
// 격자 카드를 누르면 상세, 닫으면 격자로 (&grid가 남음). 마을 바꾸기는 새 기록(뒤로 = 앞 마을). 알림 목록을 열면 모두 읽음
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const COLLECTOR = 'http://127.0.0.1:4798'; // playwright.config.ts
const root = resolve(import.meta.dirname, '..');
const SHOTS = process.env.SHOTS;
const A = 'm9g'; // 세션마다 첫 마을에 묶인다 → 마을 둘 = 세션 둘
const B = 'm9g2';
const cwds: Record<string, string> = {};
const ids: Record<string, string> = {};

const post = async (session: string, e: Record<string, unknown>) => {
  const r = await fetch(`${COLLECTOR}/hook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session_id: session, cwd: cwds[session], ...e }),
  });
  expect(r.status).toBe(204);
};
const create = (taskId: string, subject: string) =>
  post(A, {
    hook_event_name: 'PostToolUse',
    tool_name: 'TaskCreate',
    tool_input: { subject },
    tool_response: { taskId },
  });
const shot = (page: Page, name: string) => (SHOTS ? page.screenshot({ path: join(SHOTS, name) }) : undefined);

test.beforeAll(async () => {
  for (const s of [A, B]) {
    cwds[s] = mkdtempSync(join(tmpdir(), `tycoon-${s}-`));
    cpSync(join(root, 'examples/target-project/.claude/agents'), join(cwds[s], '.claude/agents'), { recursive: true });
    await post(s, { hook_event_name: 'SessionStart', source: 'startup' });
  }
  const list = (await (await fetch(`${COLLECTOR}/api/projects`)).json()) as { id: string; cwd: string }[];
  for (const s of [A, B]) ids[s] = list.find((p) => p.cwd === cwds[s])?.id ?? '';
  expect(Object.values(ids)).not.toContain('');
  // A 마을: 작업 둘(건물 없음) + backend-dev가 한 번 일함 = 입주 + 1층 일터 (06 문서 5장)
  await create('g1', '검색 필터 만들기');
  await create('g2', '검색 필터 테스트');
  await post(A, { hook_event_name: 'SubagentStart', agent_id: 'g-a1', agent_type: 'backend-dev' });
  await post(A, { hook_event_name: 'SubagentStop', agent_id: 'g-a1', agent_type: 'backend-dev' });
});
test.afterAll(async () => {
  for (const s of [A, B]) if (ids[s]) await post(s, { hook_event_name: 'SessionEnd' });
});

test('격자: 집 카드·일터 카드, 카드 → 상세 → 닫으면 격자, 마을 전환은 새 기록, 알림 목록은 모두 읽음', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const a = encodeURIComponent(ids[A] ?? '');
  const b = encodeURIComponent(ids[B] ?? '');
  await page.goto(`/?project=${a}`);
  const view = page.getByRole('group', { name: '보기 방식' });
  await view.getByRole('button', { name: '격자' }).click();
  await expect(page).toHaveURL(new RegExp(`\\?project=${a}&grid$`));
  const grid = page.getByRole('region', { name: '격자 보기' });
  await expect(grid.locator('a[data-house]')).toHaveCount(2); // 입주한 팀장 + backend-dev만 (나머지 md 팀원은 입주 전)
  await expect(grid.getByRole('heading', { name: '팀원 일터' })).toBeVisible();
  await expect(grid.locator('a.gs-card[data-building]')).toHaveCount(1);
  await expect(page.locator('.ms__village')).toBeHidden(); // 가리기만 (카메라 그대로)
  await shot(page, 'm9-grid.png');

  // 집 카드 → 집 상세 (&grid 남음) → 닫으면 격자로, 기록이 쌓이지 않는다 (뒤로 = 격자 앞)
  const len = await page.evaluate(() => history.length);
  await grid.locator('a[data-house="backend-dev"]').click();
  await expect(page).toHaveURL(new RegExp(`\\?project=${a}&grid&house=backend-dev$`));
  await expect(page.locator('.ms__detail')).toBeVisible();
  await page.locator('.ms__detail').getByRole('button', { name: '마을로' }).click();
  await expect(page).toHaveURL(new RegExp(`\\?project=${a}&grid$`));
  await expect(grid).toBeVisible();
  expect(await page.evaluate(() => history.length)).toBe(len + 1);
  // 일터 카드 → 일터 상세
  await grid.locator('a.gs-card[data-building]').click();
  await expect(page).toHaveURL(new RegExp(`\\?project=${a}&grid&building=`));
  await page.goBack();
  await expect(grid).toBeVisible();

  // 마을 바꾸기 = 새 기록, 보기(격자)는 그대로. 뒤로 = 앞 마을
  await page.getByRole('combobox', { name: '마을 바꾸기' }).selectOption(ids[B] ?? '');
  await expect(page).toHaveURL(new RegExp(`\\?project=${b}&grid$`));
  await expect(grid.locator('a.gs-card[data-building]')).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`\\?project=${a}&grid$`));
  await expect(grid.locator('a.gs-card[data-building]')).toHaveCount(1);
  await view.getByRole('button', { name: '마을' }).click();
  await expect(page).toHaveURL(new RegExp(`\\?project=${a}$`));
  await expect(page.locator('.ms__village')).toBeVisible();

  // 알림: 회의 토스트(직접 닫는 것) → 뱃지 1 → 목록을 열면 모두 읽음, Esc로 닫고 포커스는 버튼
  await post(A, { hook_event_name: 'UserPromptSubmit', prompt: '격자 화면 다듬기' });
  const bell = page.getByRole('button', { name: /^알림 \d+개$/ });
  await expect(bell).toHaveAccessibleName('알림 1개');
  await bell.click();
  await expect(bell).toHaveAccessibleName('알림 0개');
  await expect(page.locator('.ts .ui-toast')).toHaveCount(0);
  const list = page.getByRole('region', { name: '최근 알림' });
  await expect(list.locator('li').first()).toContainText('광장 회의 시작 · 격자 화면 다듬기');
  await shot(page, 'm9-notifications.png');
  await page.keyboard.press('Escape');
  await expect(list).toHaveCount(0);
  await expect(bell).toBeFocused();
});
