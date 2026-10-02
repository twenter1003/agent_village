// M19 날씨 = 팀 상태 (06 문서 10장, D28): 훅 → 수집기(:4798) → 상단 바 날씨 + 바다 날씨 겹.
// 도구가 3번 연달아 실패하면 그 팀원이 막힌다 (status.blockedOnToolFailureStreak) → 1명 흐림, 2명 폭풍.
// 지금 훅으로는 실행이 실패로 끝나지 않아(SubagentStop = 성공) 막힘으로 날씨를 바꾼다
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const COLLECTOR = 'http://127.0.0.1:4798'; // playwright.config.ts
const root = resolve(import.meta.dirname, '..');
const SHOTS = process.env.SHOTS;
const SESSION = 'm19w'; // 세션마다 첫 마을에 묶인다 → 다른 spec과 다른 세션
const RUNS = { 'w-a1': 'backend-dev', 'w-a2': 'frontend-dev' } as const;
let cwd = '';
let pid = '';
let seq = 0;

const post = async (e: Record<string, unknown>) => {
  const r = await fetch(`${COLLECTOR}/hook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session_id: SESSION, cwd, ...e }),
  });
  expect(r.status).toBe(204);
};
/** 테스트 명령 3번 연달아 실패 → 그 팀원 막힘 */
const failThrice = async (agent_id: keyof typeof RUNS) => {
  for (let i = 0; i < 3; i++)
    await post({
      hook_event_name: 'PostToolUseFailure',
      agent_id,
      agent_type: RUNS[agent_id],
      tool_name: 'Bash',
      tool_use_id: `m19w-${seq++}`,
      tool_input: { command: 'pnpm test' },
      error: 'exit code 1',
    });
};

test.beforeAll(async () => {
  cwd = mkdtempSync(join(tmpdir(), 'tycoon-m19w-'));
  cpSync(join(root, 'examples/target-project/.claude/agents'), join(cwd, '.claude/agents'), { recursive: true });
  await post({ hook_event_name: 'SessionStart', source: 'startup' });
  const list = (await (await fetch(`${COLLECTOR}/api/projects`)).json()) as { id: string; cwd: string }[];
  pid = list.find((p) => p.cwd === cwd)?.id ?? '';
  expect(pid).not.toBe('');
  for (const [agent_id, agent_type] of Object.entries(RUNS))
    await post({ hook_event_name: 'SubagentStart', agent_id, agent_type });
});
test.afterAll(async () => {
  if (!pid) return;
  for (const [agent_id, agent_type] of Object.entries(RUNS))
    await post({ hook_event_name: 'SubagentStop', agent_id, agent_type });
  await post({ hook_event_name: 'SessionEnd' });
});

test('날씨: 일하는 중 맑음 → 막힘 1명 흐림 → 2명 폭풍, 누르면 이유, 바다에 폭풍 겹', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?project=${encodeURIComponent(pid)}`);
  const button = page.locator('.tb__weather button');
  await expect(button).toHaveAccessibleName('맑음');

  await failThrice('w-a1');
  await expect(button).toHaveAccessibleName('흐림');
  await expect(page.locator('.wx[data-weather="cloudy"]')).toBeAttached();

  await failThrice('w-a2');
  await expect(button).toHaveAccessibleName('폭풍');
  await button.click();
  await expect(page.locator('.tb__weather-why')).toHaveText('막힘 2명');
  // 화면 고정 겹: 카메라 변환(줌) 밖, 누르기를 막지 않는다
  const layer = page.locator('.wx[data-weather="storm"]');
  await expect(layer).toBeAttached();
  await expect(layer).toHaveCSS('pointer-events', 'none');
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'm19-weather-storm.png') });
  await page.keyboard.press('Escape');
  await expect(page.locator('.tb__weather-box')).toHaveCount(0);
});
