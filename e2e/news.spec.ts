// M18 마을 신문 (04 문서, 06 문서 9장): 훅 → 수집기(:4798) → 화면. 작업 2개를 끝내면 상단 바 신문 버튼 → 오늘 신문 —
// 1면 = 일 점수가 큰 작업, 도구 2번 이하는 단신, 달력의 오늘에 점. 계산 자체는 packages/web/src/screens/news/paper.test.ts
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const COLLECTOR = 'http://127.0.0.1:4798'; // playwright.config.ts
const root = resolve(import.meta.dirname, '..');
const SHOTS = process.env.SHOTS;
const SESSION = 'm18'; // 수집기는 세션을 첫 마을에 묶는다 → 다른 spec과 다른 세션

let cwd = '';
let pid = '';
let agents = 0;
const post = async (e: Record<string, unknown>) => {
  const r = await fetch(`${COLLECTOR}/hook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session_id: SESSION, cwd, ...e }),
  });
  expect(r.status).toBe(204);
};
const update = (taskId: string, status: string) =>
  post({ hook_event_name: 'PostToolUse', tool_name: 'TaskUpdate', tool_input: { taskId, status } });
/** 작업 하나: 만들기 → in_progress → 그 팀원 실행(도구 calls번) → 완료 */
async function work(taskId: string, subject: string, member: string, calls: number) {
  await post({
    hook_event_name: 'PostToolUse',
    tool_name: 'TaskCreate',
    tool_input: { subject },
    tool_response: { taskId },
  });
  await update(taskId, 'in_progress');
  const agent_id = `m18-a${++agents}`;
  await post({ hook_event_name: 'SubagentStart', agent_id, agent_type: member });
  for (let i = 0; i < calls; i++)
    await post({ hook_event_name: 'PostToolUse', agent_id, tool_name: 'Read', tool_use_id: `${agent_id}-${i}` });
  await post({ hook_event_name: 'SubagentStop', agent_id, agent_type: member });
  await update(taskId, 'completed');
}

test.beforeAll(async () => {
  cwd = mkdtempSync(join(tmpdir(), 'tycoon-m18-'));
  cpSync(join(root, 'examples/target-project/.claude'), join(cwd, '.claude'), { recursive: true });
  await post({ hook_event_name: 'SessionStart', source: 'startup' });
  const list = (await (await fetch(`${COLLECTOR}/api/projects`)).json()) as { id: string; cwd: string }[];
  pid = encodeURIComponent(list.find((p) => p.cwd === cwd)?.id ?? '');
  expect(pid).not.toBe('');
});
test.afterAll(async () => {
  if (pid) await post({ hook_event_name: 'SessionEnd' });
});

test('작업 2개 → 신문 버튼 → 1면 = 큰 작업, 작은 작업은 단신, 달력 오늘에 점', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await work('n1', '결제 API 붙이기', 'backend-dev', 8);
  await work('n2', '오타 고침', 'frontend-dev', 1);

  await page.goto(`/?project=${pid}`);
  await page.getByRole('button', { name: '마을 신문' }).click();
  await expect(page).toHaveURL(/[?&]news/);
  await expect(page.locator('.nw-headline')).toHaveText('결제 API 붙이기');
  await expect(page.locator('.nw-briefs')).toContainText('오타 고침');
  await expect(page.locator('.nw-days [aria-current="date"] .nw-dot')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'news.png') });
});
