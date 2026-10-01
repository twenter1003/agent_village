// M13 완료 기준 (04 문서, 06 문서 5·16장): 훅 → 수집기(:4798) → 화면. 팀원이 처음 일하면 3×3 부지 + 현장 → 1층(얼굴 간판·이름표),
// 일 점수가 차고 자재비가 모이면 2층, 모자라면 "자재비 대기", 3층은 Lv.4라 M13에선 "Lv.4 필요". 일하는 동안 비계·게이지.
// 일터 상세(&building=)·이름 바꾸기(새로고침에도), 외부인은 일터를 만들지 않고, 일터 수 = 일한 팀원 수. 층 수치는 이 마을만 작게
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const COLLECTOR = 'http://127.0.0.1:4798'; // playwright.config.ts
const root = resolve(import.meta.dirname, '..');
const SHOTS = process.env.SHOTS;
const SESSION = 'm13';
/** 2층 3점 · 3층 6점(Lv.4) · 큰 건물 9점(Lv.7), 자재비 100씩. 도구 1번 = 급여 26, 세금 5 → 잔고 +21 (토큰 기록이 없어 비용 0) */
const LEVELS = [
  { points: 0, cost: 0, level: 1 },
  { points: 3, cost: 100, level: 1 },
  { points: 6, cost: 100, level: 4 },
  { points: 9, cost: 100, level: 7 },
];
interface State {
  runs: Record<string, { memberId: string | null }>;
  buildings: Record<string, { memberId: string; floor: number; points: number; waiting: string | null; name: string }>;
  members: Record<string, { balance: number }>;
  facilities: Record<string, unknown>;
}
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
/** 서브에이전트 실행 시작. tool() = 도구 한 번, stop() = 끝 */
async function start(agent_type: string) {
  const agent_id = `m13-${++n}`;
  let k = 0;
  await post({ hook_event_name: 'SubagentStart', agent_id, agent_type });
  return {
    tool: () =>
      post({ hook_event_name: 'PostToolUse', agent_id, tool_name: 'Read', tool_use_id: `${agent_id}-${k++}` }),
    stop: () => post({ hook_event_name: 'SubagentStop', agent_id, agent_type }),
  };
}
async function work(agent_type: string, calls: number) {
  const r = await start(agent_type);
  for (let i = 0; i < calls; i++) await r.tool();
  await r.stop();
}
const state = async () => (await (await fetch(`${COLLECTOR}/api/projects/${pid}/state`)).json()) as State;

test.beforeAll(async () => {
  cwd = mkdtempSync(join(tmpdir(), 'tycoon-m13-'));
  cpSync(join(root, 'examples/target-project/.claude'), join(cwd, '.claude'), { recursive: true });
  const path = join(cwd, '.claude/tycoon.json');
  const tycoon = JSON.parse(readFileSync(path, 'utf8')) as { overrides?: Record<string, unknown> };
  tycoon.overrides = { ...tycoon.overrides, workplace: { levels: LEVELS } };
  writeFileSync(path, JSON.stringify(tycoon));
  await post({ hook_event_name: 'SessionStart', source: 'startup' });
  const list = (await (await fetch(`${COLLECTOR}/api/projects`)).json()) as { id: string; cwd: string }[];
  pid = encodeURIComponent(list.find((p) => p.cwd === cwd)?.id ?? '');
  expect(pid).not.toBe('');
});
test.afterAll(async () => {
  if (pid) await post({ hook_event_name: 'SessionEnd' });
});

test('일터: 현장 → 1층(간판·이름표) → 자재비 대기 → 2층 → Lv.4 필요, 비계·게이지, 상세·이름 바꾸기, 외부인은 없음, 일터 수 = 일한 팀원 수', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?project=${pid}`);
  await expect(page.locator('button.tp-card')).toHaveCount(4);
  const site = page.locator('[data-building="work:w1:backend-dev"]');
  const body = () => site.locator('[data-asset-id^="body."]').getAttribute('data-asset-id');

  // 1) 첫 실행: 예정 부지 → 도구를 쓰면 기초 → 끝나면 1층 + 얼굴 간판·이름표 (집과 일터 둘)
  const first = await start('backend-dev');
  await expect(site.locator('[data-asset-id="site.planned"]')).toBeAttached();
  await first.tool();
  await expect(site.locator('[data-asset-id="site.foundation"]')).toBeAttached();
  await first.stop();
  await expect.poll(body).toMatch(/-1f$/);
  await expect(page.locator('[data-owner-sign="backend-dev"]')).toHaveCount(2);
  await expect(page.locator('[data-name-tag="backend-dev"]')).toHaveCount(2);

  // 2) 도구 3번: 점수 4 ≥ 3인데 잔고 83 < 100 → 자재비 대기 (알림 한 번)
  await work('backend-dev', 3);
  // 토스트는 ' · ' 앞이 제목, 뒤(100)가 본문 (ToastStack)
  await expect(page.locator('.ts').getByText('backend-dev 일터 2층 자재비 대기')).toBeVisible();
  expect((await state()).buildings['w1:backend-dev']).toMatchObject({ floor: 1, points: 4, waiting: 'materials' });
  if (SHOTS) {
    await page.goto(`/?project=${pid}&building=w1%3Abackend-dev`);
    await expect(page.locator('.ms__detail [data-waiting="materials"]')).toHaveText('자재비 대기');
    await page.screenshot({ path: join(SHOTS, 'm13-detail-materials.png') });
    await page.goto(`/?project=${pid}`);
  }

  // 3) 도구 1번: 잔고 104 → 2층 (자재비 100)
  await work('backend-dev', 1);
  await expect(page.locator('.ts').getByText('backend-dev 일터 2층 완공')).toBeVisible();
  await expect.poll(body).toMatch(/-2f$/);
  expect((await state()).members['backend-dev']?.balance).toBe(4);

  // 4) 일하는 동안: 비계 + 게이지 (점수는 실행이 끝날 때 쌓인다) → 끝나면 6점, Lv.4 필요
  const busy = await start('backend-dev');
  await busy.tool();
  await expect(site.locator('[data-asset-id="site.scaffold-2f"]')).toBeAttached();
  await expect(page.getByRole('img', { name: 'backend-dev의 공방 일 점수 5 / 6' })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'm13-working.png') });
  await busy.stop();
  await expect.poll(async () => (await state()).buildings['w1:backend-dev']?.waiting).toBe('level');
  await expect(site.locator('[data-asset-id^="site.scaffold"]')).toHaveCount(0);

  // 5) 일터 상세 (&building=w1%3Abackend-dev): 층·게이지·조건·최근 일·쌓은 일
  await page.getByRole('button', { name: 'backend-dev의 공방 건물 보기' }).click();
  await expect(page).toHaveURL(/[?&]building=w1(%3A|:)backend-dev$/);
  const detail = page.locator('.ms__detail');
  await expect(detail.locator('h1')).toHaveText('backend-dev의 공방');
  await expect(page.getByRole('list', { name: '일터 층' }).locator('[aria-current="step"]')).toContainText('2층');
  await expect(detail.locator('.bd-count')).toHaveText('일 점수 6 / 6');
  await expect(detail.locator('[data-waiting="level"]')).toHaveText('Lv.4 필요');
  await expect(detail.locator('.bd-cond[data-cond="level"]')).toHaveAttribute('data-ok', 'false');
  await expect(detail.locator('.bd-task')).toHaveCount(4);
  await expect(detail.locator('[data-contrib]')).toHaveText('실행 4번 · 일 점수 6 · 자재비 100');
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'm13-detail.png') });

  // 6) 이름 바꾸기 → PUT(:bid 디코드) → ui 줄 → SSE, 새로고침에도
  await detail.getByRole('button', { name: '이름 바꾸기' }).click();
  await detail.getByRole('textbox', { name: '건물 이름' }).fill('  고래   공방 ');
  await detail.getByRole('button', { name: '저장' }).click();
  await expect(detail.locator('h1')).toHaveText('고래 공방');
  expect((await state()).buildings['w1:backend-dev']?.name).toBe('고래 공방');
  await page.reload();
  await expect(page.locator('.ms__detail h1')).toHaveText('고래 공방');
  await page.locator('.ms__detail').getByRole('button', { name: '마을로' }).last().click();

  // 7) 둘째 팀원 → 둘째 일터(동쪽), 외부인은 일터 없음(시설만), 일터 수 = 일한 팀원 수 (06 문서 16장)
  await work('frontend-dev', 1);
  await expect(page.locator('[data-building="work:w1:frontend-dev"] [data-asset-id^="body."]')).toBeAttached();
  await work('general-purpose', 2);
  await expect(page.locator('[data-building="facility:agency"]')).toBeAttached();
  const s = await state();
  const workers = new Set(Object.values(s.runs).flatMap((r) => (r.memberId ? [r.memberId] : [])));
  expect(
    Object.values(s.buildings)
      .map((b) => b.memberId)
      .sort(),
  ).toEqual([...workers].sort());
  expect(Object.keys(s.buildings).sort()).toEqual(['w1:backend-dev', 'w1:frontend-dev']);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, 'm13-village.png') });
  if (SHOTS) {
    await page.goto(`/?project=${pid}&grid`); // 격자 일터 카드: 2층 "Lv.4 필요" + 1층
    await expect(page.locator('a.gs-card[data-building]')).toHaveCount(2);
    await page.screenshot({ path: join(SHOTS, 'm13-grid.png') });
  }
});
