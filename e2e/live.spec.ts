// M5 완료 기준 (04 문서): 훅 → 수집기(:4798, 빈 DB) → SSE → 메인 화면. 서브에이전트를 부르면 2초 안에 자기 일터로 걷기 시작.
// 수집기를 꺼도 훅 명령이 Claude Code를 늦추지 않는다.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import { createServer, type AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';
import { expect, test, type Locator } from '@playwright/test';

const COLLECTOR = 'http://127.0.0.1:4798'; // playwright.config.ts
const root = resolve(import.meta.dirname, '..');
const cwd = join(root, 'examples/target-project');
/** SHOTS=<폴더>면 화면을 찍어 둔다 (캔버스 보드와 나란히 비교, CLAUDE.md) */
const SHOTS = process.env.SHOTS;
const KICKOFF_WINDOW_MS = (
  JSON.parse(readFileSync(join(root, 'design/game.default.json'), 'utf8')) as { meetings: { kickoffWindowMs: number } }
).meetings.kickoffWindowMs;

const post = (e: Record<string, unknown>) =>
  fetch(`${COLLECTOR}/hook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session_id: 's1', ...e, cwd }),
  });

async function center(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error('보이지 않음');
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

test('실시간 메인: 픽스처 → 팀원 카드·공사 현장·막힘 !, 새 서브에이전트는 2초 안에 자기 일터로', async ({ page }) => {
  // 합성 픽스처를 실제 훅처럼: 시각(_t)은 수집기가 찍고, cwd는 예시 프로젝트(팀원 목록을 읽는다)
  for (const line of readFileSync(join(root, 'fixtures/sample-session.jsonl'), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const e = JSON.parse(line) as Record<string, unknown>;
    delete e._t;
    delete e._synthetic;
    expect((await post(e)).status).toBe(204);
  }
  const postedAt = Date.now();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  const cards = page.locator('button.tp-card');
  await expect(cards).toHaveCount(4); // 팀장 + .claude/agents 3
  await expect(cards.first()).toHaveAttribute('data-member', '@leader');
  const site = page.locator('[data-building="work:w1:backend-dev"]');
  await expect(site.locator('[data-asset-id^="site."]')).toBeAttached(); // 막힌 첫 실행 = 일터 현장
  await expect(page.locator('[data-walker-ui="backend-dev"]').getByRole('img', { name: '막힘' })).toBeVisible();

  // 키보드 포커스 링: 모든 멈춤이 3px --focus (03 문서 5장) — 캐릭터 버튼, 스크롤 목록, 준비 중 칩까지
  const stops: string[] = [];
  for (let i = 0; i < 60; i++) {
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
      return `${el.tagName} ${el.getAttribute('aria-label') ?? ''}${ring ? '' : ` ✗ ${cs.outlineStyle} ${cs.outlineWidth}`}`;
    });
    if (!stop) break;
    stops.push(stop);
  }
  expect(stops).toContain('OL 활동 기록');
  expect(stops).toContain('BUTTON qa-reviewer');
  expect(stops.filter((x) => x.includes('✗'))).toEqual([]);

  // 캐릭터 누르기 → 카드 강조, 카드 누르기 → 캐릭터 발밑 원판 + 그 팀원 집 (01 문서 8.2). 집을 닫으면 누른 카드로
  await page.getByRole('button', { name: 'qa-reviewer', exact: true }).click();
  await expect(page.locator('button.tp-card[data-member="qa-reviewer"]')).toHaveAttribute('aria-pressed', 'true');
  const backend = page.locator('button.tp-card[data-member="backend-dev"]');
  await backend.click();
  await expect(page).toHaveURL(/[?&]house=backend-dev$/);
  await expect(page.locator('.ms__detail h1')).toHaveText('backend-dev');
  await expect(page.locator('[data-walker="backend-dev"] [data-selected]')).toBeAttached();
  await expect(page.locator('[data-walker="qa-reviewer"] [data-selected]')).toHaveCount(0);
  await page.locator('.ms__detail').getByRole('button', { name: '마을로' }).click();
  await expect(page).not.toHaveURL(/house=/);
  await expect(backend).toBeFocused();

  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'main.png') });

  // 픽스처가 몇 ms 안에 다 들어와서 backend-dev(a3)가 방금 시작한 셈 → 지금 부르면 병렬 킥오프 회의(01 문서 4.1)가 먼저 열린다.
  // 실제 세션처럼 킥오프 창이 지난 뒤에 부른다 (그동안 다른 캐릭터도 자리를 잡는다)
  await page.waitForTimeout(Math.max(0, KICKOFF_WINDOW_MS + 500 - (Date.now() - postedAt)));
  const card = page.locator('button.tp-card[data-member="frontend-dev"]');
  const walker = page.locator('[data-walker="frontend-dev"]');
  // 픽스처에서 한 번도 일하지 않은 frontend-dev는 입주 전: 카드만 있고 마을엔 없다 (01 문서 3.3)
  await expect(card).toContainText('아직 일하지 않았어요');
  await expect(walker).toHaveCount(0);
  const t0 = Date.now();
  await post({
    hook_event_name: 'PostToolUse',
    tool_name: 'TaskUpdate',
    tool_input: { taskId: 't2', status: 'in_progress' },
  });
  await post({ hook_event_name: 'SubagentStart', agent_id: 'a4', agent_type: 'frontend-dev' });
  const mine = page.locator('[data-building="work:w1:frontend-dev"]');
  await expect(mine).toBeAttached();
  const s0 = await center(mine);
  // 2초 안에: 카드는 작업 중, 입주해서 막 지은 집 문 앞에 나타난다
  await expect
    .poll(async () => [(await card.textContent())?.includes('작업 중'), await walker.count()], {
      timeout: 2000 - (Date.now() - t0),
      intervals: [50],
    })
    .toEqual([true, 1]);
  await expect(page.locator('[data-building="house:frontend-dev"]')).toBeAttached();
  const w0 = await center(walker);
  const dist0 = Math.hypot(w0.x - s0.x, w0.y - s0.y);
  expect(dist0).toBeGreaterThan(40); // 현장에 바로 나타나지 않는다
  // 길은 돌아갈 수 있어서 방향은 도착으로 본다: 현장 가까이 와서 멈춘다
  await expect
    .poll(
      async () => {
        const w = await center(walker);
        return Math.hypot(w.x - s0.x, w.y - s0.y);
      },
      { timeout: 15_000 },
    )
    .toBeLessThan(dist0 / 2);
});

test('훅 명령: 수집기가 꺼져 있어도 0으로 1.5초 안에 끝난다 (Claude Code를 늦추지 않음)', async () => {
  const settings = JSON.parse(readFileSync(join(cwd, '.claude/settings.json'), 'utf8')) as {
    hooks: Record<string, { hooks: { command: string }[] }[]>;
  };
  const commands = new Set(
    Object.values(settings.hooks).flatMap((m) => m.flatMap((h) => h.hooks.map((x) => x.command))),
  );
  expect(commands.size).toBe(1); // 모든 훅이 같은 명령 → 하나만 재면 된다
  const [cmd = ''] = commands;
  expect(cmd).toContain('127.0.0.1:4777');

  // 닫힌 포트 = 잠깐 열었다 닫은 포트 (4777엔 개발용 수집기가 돌고 있을 수 있음)
  const srv = createServer().listen(0, '127.0.0.1');
  await once(srv, 'listening');
  const { port } = srv.address() as AddressInfo;
  await new Promise((r) => srv.close(r));

  const t0 = performance.now();
  const r = spawnSync('bash', ['-c', cmd.replace('127.0.0.1:4777', `127.0.0.1:${port}`)], {
    input: JSON.stringify({
      hook_event_name: 'SubagentStart',
      session_id: 's1',
      cwd,
      agent_id: 'a9',
      agent_type: 'qa-reviewer',
    }),
    timeout: 5000,
  });
  expect(r.status).toBe(0);
  expect(performance.now() - t0).toBeLessThan(1500);
});

test('마을이 없으면 훅 설치 안내, 수집기가 안 보이면 끊김 표시', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('**/api/projects', (r) => r.fulfill({ json: [] }));
  await page.goto('/');
  await expect(page.getByRole('status').filter({ hasText: '아직 마을이 없어요' })).toContainText('settings.json');
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'main-empty.png') });
  await page.route('**/api/projects', (r) => r.abort());
  await expect(page.getByRole('status').filter({ hasText: '수집기 연결 끊김' })).toBeVisible({ timeout: 5000 });
});

test('dev 화면 스냅샷 (SHOTS 있을 때만)', async ({ page }) => {
  test.skip(!SHOTS, 'SHOTS=<폴더>일 때만');
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const p of ['ui', 'icons', 'gallery']) {
    await page.goto(`/dev/${p}`);
    await page.screenshot({ path: join(SHOTS ?? '', `dev-${p}.png`), fullPage: true });
  }
  // 일터 임시 그림 (06 문서 14장): 마을 레벨 7, m1~m8 일터가 층 1·2·3·4·0·1·2·3 — 3층·큰 건물 배지, 일하는 주인의 비계·게이지
  await page.goto('/dev/village?live=stress');
  await expect(page.locator('[data-floor-badge]').first()).toBeVisible();
  await page.screenshot({ path: join(SHOTS ?? '', 'dev-floors.png') });
});
