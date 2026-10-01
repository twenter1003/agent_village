// M16 집 주인 표시·캐릭터 누르기 (06 문서 7·8장): 훅 → 수집기(:4798) → 화면.
// 집 간판 = 주인 얼굴(clipPath 안 critter) + 이름표, 줄여 보면 이름표만 숨김. 캐릭터 클릭 → 1.2초 버둥·말풍선,
// 끌어 놓기 → 자리가 바뀌고 다시 걸어 제자리로 (마을은 안 움직인다). 화면 놀이라 수집기에는 아무것도 안 보낸다
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const COLLECTOR = 'http://127.0.0.1:4798'; // playwright.config.ts
const root = resolve(import.meta.dirname, '..');
const SHOTS = process.env.SHOTS;
const SESSION = 'm16'; // 세션마다 첫 마을에 묶인다 → 다른 spec과 다른 세션
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
const shot = (page: Page, name: string, clip?: { x: number; y: number; width: number; height: number }) =>
  SHOTS ? page.screenshot({ path: join(SHOTS, name), clip }) : undefined;
/** 요소 둘레를 pad만큼 넓힌 영역 (확대 스냅샷) */
const around = async (page: Page, sel: string, pad: number) => {
  const b = await page.locator(sel).boundingBox();
  if (!b) throw new Error(`${sel} 안 보임`);
  return { x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 };
};

test.use({ deviceScaleFactor: 2 }); // 확대 스냅샷을 선명하게

test.beforeAll(async () => {
  cwd = mkdtempSync(join(tmpdir(), 'tycoon-m16-'));
  cpSync(join(root, 'examples/target-project/.claude/agents'), join(cwd, '.claude/agents'), { recursive: true });
  await post({ hook_event_name: 'SessionStart', source: 'startup' });
  const list = (await (await fetch(`${COLLECTOR}/api/projects`)).json()) as { id: string; cwd: string }[];
  pid = list.find((p) => p.cwd === cwd)?.id ?? '';
  expect(pid).not.toBe('');
  // 작업 둘 → 예정 부지 = 마을 세우기. backend-dev가 p1을 하는 중 (입주 + 현장에서 일함)
  for (const [taskId, subject] of [
    ['p1', '검색 필터 만들기'],
    ['p2', '검색 필터 테스트'],
  ])
    await post({
      hook_event_name: 'PostToolUse',
      tool_name: 'TaskCreate',
      tool_input: { subject },
      tool_response: { taskId },
    });
  await post({
    hook_event_name: 'PostToolUse',
    tool_name: 'TaskUpdate',
    tool_input: { taskId: 'p1', status: 'in_progress' },
  });
  await post({ hook_event_name: 'SubagentStart', agent_id: 'm16-a1', agent_type: 'backend-dev' });
});
test.afterAll(async () => {
  if (!pid) return;
  await post({ hook_event_name: 'SubagentStop', agent_id: 'm16-a1', agent_type: 'backend-dev' });
  await post({ hook_event_name: 'SessionEnd' });
});

test('집 간판·이름표, 캐릭터 누르기(버둥·말풍선 1.2초), 끌어 놓기 → 다시 걷기', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?project=${encodeURIComponent(pid)}`);

  // 얼굴 간판 (둥근 틀 안 주인 얼굴) + 이름표. 팀장은 "팀장의 집"과 시청(06 문서 6.3, M14) "시청"
  const sign = page.locator('[data-owner-sign="backend-dev"]');
  await expect(sign.locator('clipPath circle')).toBeAttached();
  await expect(sign.locator('g[clip-path] svg[data-asset-id$=".face"]')).toBeAttached();
  await expect(page.locator('[data-name-tag="backend-dev"]')).toHaveText('backend-dev');
  await expect(page.locator('[data-name-tag="@leader"]')).toHaveText(['팀장의 집', '시청']);
  await expect(page.locator('[data-name-tag="backend-dev"]')).toBeVisible();

  // 현장에 도착해 일하는 중 (망치질·나르기)
  const body = page.locator('[data-walker="backend-dev"] svg');
  await expect(body).toHaveAttribute('data-asset-id', /\.(hammer|carry)$/, { timeout: 15000 });
  if (SHOTS) {
    const houses = await around(page, '[data-building="house:@leader"]', 70);
    const b = await around(page, '[data-building="house:backend-dev"]', 70);
    const x = Math.min(houses.x, b.x);
    const y = Math.min(houses.y, b.y);
    await shot(page, 'm16-signs.png', {
      x,
      y,
      width: Math.max(houses.x + houses.width, b.x + b.width) - x,
      height: Math.max(houses.y + houses.height, b.y + b.height) - y,
    });
  }

  // 누르기: 버둥(flail) + 머리 위 말풍선 = 지금 상태, 1.2초 뒤 사라짐. 카드 강조는 그대로
  const hit = page.getByRole('button', { name: 'backend-dev', exact: true });
  const say = page.locator('[data-walker-ui="backend-dev"] [data-poke-say]');
  await hit.click();
  const t0 = Date.now();
  await expect(body).toHaveAttribute('data-asset-id', /\.flail$/);
  await expect(say).toHaveText('일하는 중 · 검색 필터 만들기');
  await expect(page.locator('button.tp-card[data-member="backend-dev"]')).toHaveAttribute('aria-pressed', 'true');
  await shot(page, 'm16-poke.png', await around(page, '[data-walker-ui="backend-dev"] [data-poke-say]', 90));
  await expect(say).toHaveCount(0, { timeout: 3000 });
  await expect(body).not.toHaveAttribute('data-asset-id', /\.flail$/);
  expect(Date.now() - t0).toBeGreaterThanOrEqual(1000);

  // 끌어 옮기기: 6px 넘게 끌면 집어 듦(held, 떠서 버둥), 놓으면 칸에 내려놓고 원래 자리로 걸어간다. 마을(카메라)은 그대로
  const walker = page.locator('[data-walker="backend-dev"]');
  const home = await walker.getAttribute('transform');
  const ground = await page.locator('[data-building="house:@leader"]').boundingBox();
  const hb = await hit.boundingBox();
  if (!hb) throw new Error('캐릭터 안 보임');
  const [cx, cy] = [hb.x + hb.width / 2, hb.y + hb.height / 2];
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 3, cy, { steps: 2 }); // 6px 안: 아직
  await expect(body).not.toHaveAttribute('data-asset-id', /\.held$/);
  await page.mouse.move(cx - 70, cy + 110, { steps: 10 });
  await expect(body).toHaveAttribute('data-asset-id', /\.held$/);
  await expect(say).toBeVisible();
  await shot(page, 'm16-held.png', await around(page, '[data-walker-ui="backend-dev"] button.lv-hit', 110));
  await page.mouse.up();
  await expect(body).not.toHaveAttribute('data-asset-id', /\.held$/);
  expect(await walker.getAttribute('transform')).not.toBe(home);
  await expect(body).toHaveAttribute('data-asset-id', /\.(walk|swim)$/); // 다시 걷는다
  expect(await page.locator('[data-building="house:@leader"]').boundingBox()).toEqual(ground);
  await expect(page).not.toHaveURL(/house=|building=/); // 끌기는 클릭(상세 열기)이 아니다
  await expect.poll(() => walker.getAttribute('transform'), { timeout: 15000 }).toBe(home);

  // 많이 줄여 보면 이름표는 숨기고 얼굴 간판만 (Camera TAG_MIN_ZOOM)
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: '축소' }).click();
  await expect(page.locator('[data-name-tag="backend-dev"]')).toBeHidden();
  await expect(sign).toBeVisible();
  await shot(page, 'm16-far.png');
});
