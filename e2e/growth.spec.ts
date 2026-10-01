// 마을이 자라는 순서 (01 문서 3.3, D8·D9·D10): 훅 → 수집기(:4798) → 화면.
// 빈 모래섬 → 첫 프롬프트에 광장·팀장 집 → md 팀원은 처음 일할 때 입주 → md에 없는 에이전트(플러그인)도 일하면 팀원 →
// 외부인이 처음 오면 시설 → 팀원이 많아지면 섬이 넓어진다
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const COLLECTOR = 'http://127.0.0.1:4798'; // playwright.config.ts
const root = resolve(import.meta.dirname, '..');
const SHOTS = process.env.SHOTS;
const SESSION = 'grow';
let cwd = '';
let pid = '';
let n = 0;

const post = async (e: Record<string, unknown>) => {
  const r = await fetch(`${COLLECTOR}/hook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session_id: SESSION, cwd, ...e }),
  });
  expect(r.status).toBe(204);
};
/** 서브에이전트 한 번 일하기 (시작 → 끝) */
async function work(agent_type: string) {
  const agent_id = `grow-${++n}`;
  await post({ hook_event_name: 'SubagentStart', agent_id, agent_type });
  await post({ hook_event_name: 'SubagentStop', agent_id, agent_type });
}
const state = async () =>
  (await (await fetch(`${COLLECTOR}/api/projects/${pid}/state`)).json()) as { ring: number; foundedAt: number | null };
const shot = (page: Page, name: string) => (SHOTS ? page.screenshot({ path: join(SHOTS, name) }) : undefined);

test.beforeAll(async () => {
  cwd = mkdtempSync(join(tmpdir(), 'tycoon-grow-'));
  cpSync(join(root, 'examples/target-project/.claude/agents'), join(cwd, '.claude/agents'), { recursive: true });
  await post({ hook_event_name: 'SessionStart', source: 'startup' });
  const list = (await (await fetch(`${COLLECTOR}/api/projects`)).json()) as { id: string; cwd: string }[];
  pid = encodeURIComponent(list.find((p) => p.cwd === cwd)?.id ?? '');
  expect(pid).not.toBe('');
});
test.afterAll(async () => {
  if (pid) await post({ hook_event_name: 'SessionEnd' });
});

test('빈 모래섬에서 자란다: 첫 프롬프트 → 광장·팀장 집, 일한 팀원 입주, 플러그인 에이전트도 팀원, 시설, 섬 넓히기', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?project=${pid}`);
  const houses = page.locator('[data-building^="house:"]');
  const fountain = page.locator('[data-asset-id="prop.clamfountain"]');
  const card = (id: string) => page.locator(`button.tp-card[data-member="${id}"]`);

  // 1) 세션만 열린 마을 = 빈 섬. md 팀원은 목록에만
  await expect(card('backend-dev')).toContainText('아직 일하지 않았어요');
  await expect(houses).toHaveCount(0);
  await expect(fountain).toHaveCount(0);
  await expect(page.locator('[data-building^="facility:"]')).toHaveCount(0);
  await expect(page.locator('[data-walker]')).toHaveCount(0);
  await shot(page, 'grow-1-empty.png');

  // 2) 첫 프롬프트 = 마을 세우기: 광장 분수 + 팀장 집
  await post({ hook_event_name: 'UserPromptSubmit', prompt: '장바구니 만들어줘' });
  await expect(fountain).toHaveCount(1);
  await expect(page.locator('[data-building="house:@leader"]')).toBeAttached();
  await expect(houses).toHaveCount(1);
  await shot(page, 'grow-2-founded.png');

  // 3) md 팀원이 처음 일함 → 입주, 4) md에 없는 플러그인 에이전트도 일하면 팀원 + 집, 5) 외부인 → 시설
  await work('backend-dev');
  await expect(page.locator('[data-building="house:backend-dev"]')).toBeAttached();
  await expect(card('backend-dev')).not.toContainText('아직 일하지 않았어요');
  await work('superpowers:code-reviewer');
  await expect(card('superpowers:code-reviewer')).toBeVisible();
  await expect(page.locator('[data-building="house:superpowers:code-reviewer"]')).toBeAttached();
  await work('Explore');
  await expect(page.locator('[data-building="facility:library"]')).toBeAttached();
  await expect(card('frontend-dev')).toContainText('아직 일하지 않았어요'); // 안 일한 md 팀원은 여전히 입주 전
  await shot(page, 'grow-3-members.png');

  // 6) 일터(3×3)가 남·동에 하나씩이라 셋째 팀원부터, 집은 서쪽 4채를 넘으면 섬이 넓어진다 (D10)
  const ground = page.locator('svg[role="img"][aria-label="바다 마을 바닥"]');
  const before = Number(await ground.getAttribute('width'));
  for (const a of ['plugin:designer', 'plugin:writer', 'plugin:tester']) await work(a);
  await expect.poll(async () => (await state()).ring).toBe(1);
  await expect(houses).toHaveCount(6);
  await expect.poll(async () => Number(await ground.getAttribute('width'))).toBeGreaterThan(before);
  await page.getByRole('button', { name: '마을 전체 보기' }).click();
  await shot(page, 'grow-4-expanded.png');
});
