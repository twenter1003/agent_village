// M14 완료 기준 (04 문서, 06 문서 6·16장): 훅 → 수집기(:4798) → 화면. 첫 일에 시청(회관 그림 + 팀장 얼굴 간판 "시청"), 상단 바 레벨 칸,
// Lv.1 정산에서 기금으로 가로등·벤치·꽃밭, 하루 정산에서 레벨업(여러 단계·알림 "Lv.4 산호 읍이 됐어요"·섬 넓힘) → 같은 정산에서
// "Lv.4 필요"였던 일터 3층, 시청 2층, 공공시설(공원 → 길 포장), Lv.10 해저 궁전·두 번째 랜드마크·등대, 경제 패널 "레벨업·공공시설",
// 시청 누르기 → 경제. 수치는 이 마을만 작게. 규칙 자체는 packages/core/src/rules/village.test.ts
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const COLLECTOR = 'http://127.0.0.1:4798'; // playwright.config.ts
const root = resolve(import.meta.dirname, '..');
const SHOTS = process.env.SHOTS;
const SESSION = `m14-${Date.now()}`; // 수집기는 세션을 첫 마을에 묶는다 → 워커가 다시 뜨면(앞 시험 실패) 새 세션·새 마을
const DAY_MS = 2000; // 이 마을만 게임 하루 = 활동 2초 (economy.spec과 같은 방법)
const ERAS = ['village', 'village', 'village', 'town', 'town', 'town', 'city', 'city', 'city', 'capital'];
/** Lv.N = 일 점수 2(N−1), 공사비 5. 도구 1번 = 일 1점, 세금 약 5 (토큰 기록이 없어 팀장 토큰값 0) */
const VILLAGE = { levels: ERAS.map((era, i) => ({ points: 2 * i, cost: i ? 5 : 0, era })) };
const WORKS = [
  { id: 'streetlamp', cost: 1, level: 1 },
  { id: 'bench', cost: 1, level: 1 },
  { id: 'flowers', cost: 1, level: 1 },
  { id: 'park', cost: 2, level: 4 },
  { id: 'paving', cost: 2, level: 4 },
  { id: 'landmark', cost: 3, level: 7 },
];
const SMALL = new Set(['streetlamp', 'bench', 'flowers']);
/** 2층 3점 · 3층 6점(Lv.4) · 큰 건물 30점(Lv.7), 자재비 10씩 */
const FLOORS = [
  { points: 0, cost: 0, level: 1 },
  { points: 3, cost: 10, level: 1 },
  { points: 6, cost: 10, level: 4 },
  { points: 30, cost: 10, level: 7 },
];
interface State {
  level: number;
  ring: number;
  publicWorks: { kind: string }[];
  buildings: Record<string, { floor: number; points: number; waiting: string | null }>;
  members: Record<string, { balance: number }>;
  economy: { fund: number; today: { leaderTokens: number; leaderUnpaid: number } };
  runs: Record<string, { endedAt: number | null }>;
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
async function work(agent_type: string, calls: number) {
  const agent_id = `m14-${++n}`;
  await post({ hook_event_name: 'SubagentStart', agent_id, agent_type });
  for (let k = 0; k < calls; k++)
    await post({ hook_event_name: 'PostToolUse', agent_id, tool_name: 'Read', tool_use_id: `${agent_id}-${k}` });
  await post({ hook_event_name: 'SubagentStop', agent_id, agent_type });
}
const state = async () => (await (await fetch(`${COLLECTOR}/api/projects/${pid}/state`)).json()) as State;
/** 시계: 외부인 실행을 열어 두는 동안만 활동 시간이 흘러 정산이 돈다 (economy.spec clockOn/Off) */
async function withClock(id: string, until: () => Promise<void>) {
  await post({ hook_event_name: 'SubagentStart', agent_id: id, agent_type: 'Explore' });
  await until();
  await post({ hook_event_name: 'SubagentStop', agent_id: id, agent_type: 'Explore' });
  await expect.poll(async () => (await state()).runs[id]?.endedAt ?? null).not.toBeNull();
}
const shot = (page: Page, name: string) => (SHOTS ? page.screenshot({ path: join(SHOTS, name) }) : undefined);
/** 광장 쪽으로 n번 확대해 찍고 전체 보기로 되돌린다 (눈으로 보는 용) */
async function zoomShot(page: Page, n: number, name: string) {
  if (!SHOTS) return;
  for (let i = 0; i < n; i++) await page.getByRole('button', { name: '확대', exact: true }).click();
  await shot(page, name);
  await page.getByRole('button', { name: '마을 전체 보기' }).click();
}
const kinds = async () => (await state()).publicWorks.map((w) => w.kind);
/** 한 번짜리(공원·길 포장·랜드마크)만 — 소품은 날마다 섞여 들어온다 */
const once = async () => (await kinds()).filter((k) => !SMALL.has(k));

test.beforeAll(async () => {
  cwd = mkdtempSync(join(tmpdir(), 'tycoon-m14-levels-and-public-works-')); // 긴 마을 이름: 상단 바 넘침 시험
  cpSync(join(root, 'examples/target-project/.claude'), join(cwd, '.claude'), { recursive: true });
  const path = join(cwd, '.claude/tycoon.json');
  const tycoon = JSON.parse(readFileSync(path, 'utf8')) as { overrides?: Record<string, unknown> };
  tycoon.overrides = {
    ...tycoon.overrides,
    time: { gameDayMs: DAY_MS },
    village: VILLAGE,
    publicWorks: WORKS,
    workplace: { levels: FLOORS },
  };
  writeFileSync(path, JSON.stringify(tycoon));
  await post({ hook_event_name: 'SessionStart', source: 'startup' });
  const list = (await (await fetch(`${COLLECTOR}/api/projects`)).json()) as { id: string; cwd: string }[];
  pid = encodeURIComponent(list.find((p) => p.cwd === cwd)?.id ?? '');
  expect(pid).not.toBe('');
});
test.afterAll(async () => {
  if (pid) await post({ hook_event_name: 'SessionEnd' });
});

test('레벨: 시청 → Lv.1 소품 → 레벨 칸 → 정산에서 Lv.4(알림·섬·같은 정산 3층·시청 산호 읍) → 공원·길 포장 → Lv.10 해저 궁전·랜드마크 둘 → 경제 패널', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?project=${pid}`);
  const hall = page.locator('[data-building="hall"]');
  const hallBody = () => hall.locator('[data-asset-id^="body."]').getAttribute('data-asset-id');
  const level = page.locator('.tb__level');

  // 1) 첫 일(도구 1번 = 1점, Lv.2 기준 2점 아래) = 마을을 세움 → 시청(회관 1층) + 팀장 얼굴 간판 "시청"
  await work('backend-dev', 1);
  await expect.poll(hallBody).toBe('body.hall-village'); // 시대 그림 (06 문서 14.1)
  await expect(page.locator('[data-name-tag="@leader"]').filter({ hasText: '시청' })).toHaveCount(1);
  await expect(level.locator('.tb__prog-title')).toHaveText('Lv.1 모래섬 마을');

  // 2) Lv.1 정산: 레벨은 그대로, 기금으로 하루 하나씩 가로등 → 벤치 → 꽃밭 (06 문서 6.2·6.4)
  await withClock(`${SESSION}-clock-0`, async () => {
    await expect
      .poll(async () => (await kinds()).slice(0, 3), { timeout: DAY_MS * 6 })
      .toEqual(['streetlamp', 'bench', 'flowers']);
  });
  expect((await state()).level).toBe(1);
  await expect(page.locator('[data-asset-id="prop.jellypost"]')).not.toHaveCount(0);
  await shot(page, 'm14-lv1.png');
  if (SHOTS) await level.screenshot({ path: join(SHOTS, 'm14-topbar-level.png') });

  // 3) 일 1번 더 = 2점 → 정산에서 Lv.2만 (층·한 번짜리 시설 없음): 토스트 "Lv.2 모래섬 마을이 됐어요" + 섬 가운데 거품, 섬 +1
  const ring0 = (await state()).ring;
  await work('backend-dev', 1);
  await withClock(`${SESSION}-clock-1`, async () => {
    const toast = page.locator('.ts .ui-toast').filter({ hasText: 'Lv.2 모래섬 마을이 됐어요' });
    await expect(toast).toBeVisible({ timeout: DAY_MS * 4 });
    await shot(page, 'm14-levelup.png'); // 거품은 1.2초
  });
  expect((await state()).level).toBe(2);

  // 4) 일 4번 더 = 6점: 일터는 2층에서 "Lv.4 필요"
  await work('backend-dev', 4);
  await expect
    .poll(async () => (await state()).buildings['w1:backend-dev'])
    .toMatchObject({ floor: 2, waiting: 'level' });

  // 5) 하루 정산: Lv.3·4 차례로, 같은 정산에서 일터 3층, 시청 2층, 섬 넓힘, 그다음 날들 공원 → 길 포장
  await withClock(`${SESSION}-clock-2`, async () => {
    await expect.poll(async () => (await state()).level, { timeout: DAY_MS * 4 }).toBe(4);
    await expect.poll(async () => (await once()).slice(0, 2), { timeout: DAY_MS * 6 }).toEqual(['park', 'paving']);
  });
  const s1 = await state();
  expect(s1.ring).toBeGreaterThanOrEqual(ring0 + 3);
  expect(s1.buildings['w1:backend-dev']).toMatchObject({ floor: 3, waiting: null }); // 큰 건물 30점까지 게이지가 덜 참
  await expect(level.locator('.tb__prog-title')).toHaveText('Lv.4 산호 읍');
  await expect.poll(hallBody).toBe('body.hall-town');
  await expect(page.locator('svg[data-paved]')).toHaveCount(1);
  await page.getByRole('button', { name: /^알림 \d+개$/ }).click();
  const notes = page.locator('.tb__notif-list');
  await expect(notes).toContainText('Lv.4 산호 읍이 됐어요');
  await expect(notes).toContainText('Lv.2 모래섬 마을이 됐어요');
  await expect(notes).toContainText('마을 기금으로 공원을 지었어요 · 기금 −2');
  await page.keyboard.press('Escape');
  await shot(page, 'm14-town.png');
  await zoomShot(page, 6, 'm14-town-zoom.png');

  // 6) 일 12번 더 → 점수 18 → Lv.10: 시청 해저 궁전, 두 번째 랜드마크(공사비에 포함), 등대(Lv.7에 열림)
  await work('backend-dev', 12);
  await withClock(`${SESSION}-clock-3`, async () => {
    await expect.poll(async () => (await state()).level, { timeout: DAY_MS * 4 }).toBe(10);
    await expect
      .poll(kinds, { timeout: DAY_MS * 6 })
      .toEqual(expect.arrayContaining(['park', 'paving', 'landmark', 'landmark2']));
  });
  await expect(level.locator('.tb__prog-title')).toHaveText('Lv.10 해저 수도');
  await expect(level.locator('.tb__sub')).toHaveText('최고 레벨');
  await expect(page.locator('[data-building="public:landmark"]')).toBeAttached();
  await expect(page.locator('[data-building="public:landmark2"]')).toBeAttached();
  await expect.poll(hallBody).toBe('body.hall-capital');
  if (SHOTS) {
    // 토스트(5초)가 걷힌 뒤: 섬이 넓어질 때 다시 맞춘 전체 보기(02 문서 7.5)라 공원·길 포장·등대·소라 탑·해저 궁전이 한 장에
    await expect(page.locator('.ts .ui-toast')).toHaveCount(0, { timeout: 8000 });
    await shot(page, 'm14-capital.png');
    await zoomShot(page, 11, 'm14-capital-zoom.png');
  }

  // 6-2) 일 12번 더 → 점수 30: 일터 큰 건물 = 3×3 몸통 + 큰 지붕 + 공방 장식 (06 문서 14.1), 격자 카드·일터 상세도 같은 그림
  await work('backend-dev', 12);
  await expect.poll(async () => (await state()).buildings['w1:backend-dev']?.floor).toBe(4);
  const bigWork = page.locator('[data-building="work:w1:backend-dev"]');
  for (const id of ['body.big-wreck', 'roof.big-scallop', 'deco.big-workshop'])
    await expect(bigWork.locator(`[data-asset-id="${id}"]`)).toBeAttached();
  if (SHOTS) {
    await page.goto(`/?project=${pid}&grid`);
    await expect(page.locator('.gs-card__illo [data-asset-id="body.big-wreck"]')).toBeVisible();
    await shot(page, 'm15-grid.png');
    await page.goto(`/?project=${pid}&building=${encodeURIComponent('w1:backend-dev')}`);
    await expect(page.locator('.bd-site [data-asset-id="body.big-wreck"]')).toBeVisible();
    await shot(page, 'm15-detail-big.png');
    await page.goto(`/?project=${pid}`);
  }

  // 7) 레벨 칸 → 경제 패널: 기금 흐름 "레벨업·공공시설"(나감), 지금 기금 = 상태. 시청 누르기도 경제 패널
  await level.click();
  await expect(page).toHaveURL(/[?&]economy$/);
  const rows = page.locator('.ms__detail .ec-fund .ec-frow');
  await expect(rows.filter({ hasText: '레벨업·공공시설' })).toHaveText(/^레벨업·공공시설−\d/);
  const fund = (await state()).economy.fund;
  await expect(rows.filter({ hasText: '지금 기금' })).toHaveText(`지금 기금${fund.toLocaleString('ko-KR')}`);
  if (SHOTS) await page.locator('.ms__detail .ec-fund').screenshot({ path: join(SHOTS, 'm14-economy-fund.png') });
  await page.goto(`/?project=${pid}`);
  await page.locator('[data-building-hit="hall"]').dispatchEvent('click');
  await expect(page).toHaveURL(/[?&]economy$/);
});

test('상단 바: 큰 숫자(Lv.9·6자리 보물상자·긴 보조 글자)에도 1024~1440 폭에서 넘치지 않고 설정 버튼이 다 보인다 — 보조 글자는 줄임표, title엔 전부', async ({
  page,
}) => {
  if (!Object.keys((await state()).buildings).length) {
    await work('backend-dev', 1); // 이 시험만 돌 때: 일터가 있어야 점수를 넣는다
    await expect.poll(async () => Object.keys((await state()).buildings).length).toBeGreaterThan(0);
  }
  // 이 마을 상태를 Lv.9 · 다음 레벨 점수는 넘었고 기금이 모자란 모양으로 바꿔 스트림에 한 번 보낸다. 설정은 안 보내 기본 수치(06 문서 6.1)
  const s = await state();
  s.level = 9;
  Object.values(s.buildings).forEach((b, i) => (b.points = i ? 0 : 100_500)); // Lv.10 100,000점 넘음
  Object.values(s.members).forEach((m) => (m.balance = 102_880)); // 보물상자 6자리
  s.economy.fund = 45_678;
  s.economy.today = { ...s.economy.today, leaderTokens: 300, leaderUnpaid: 0 }; // 공사비 50,000 + 팀장 토큰값 300
  await page.route('**/stream', (r) =>
    r.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body: `event: state\ndata: ${JSON.stringify(s)}\n\n`,
    }),
  );
  const tb = page.locator('.tb');
  const level = page.locator('.tb__level');
  const sub = '일 100,500 / 100,000 · 기금 45,678 / 50,300';
  for (const width of [1440, 1366, 1280, 1201, 1024]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`/?project=${pid}`);
    await expect(level).toHaveAttribute('aria-label', `Lv.9 해저 도시 · ${sub}`);
    await expect(level).toHaveAttribute('title', new RegExp(`^다음 Lv.10 해저 수도 · .*기금 45,678 / 50,300`));
    expect(await tb.evaluate((e) => e.scrollWidth - e.clientWidth), `${width}`).toBe(0);
    const settings = page.getByRole('button', { name: '설정', exact: true });
    await expect(settings).toBeInViewport({ ratio: 1 });
    expect((await settings.boundingBox())?.width, `${width} 설정 버튼이 눌려 줄지 않음`).toBe(44);
    if (width <= 1200) await expect(level.locator('.tb__sub')).toBeHidden();
    if (!SHOTS) continue;
    await page.waitForTimeout(400); // 막대 채움 transition (300ms)
    if (width === 1440) {
      await expect(level.locator('[role="progressbar"]')).toHaveAttribute('aria-valuenow', '100');
      await level.screenshot({ path: join(SHOTS, 'm14-topbar-level-waiting.png') });
    }
    await tb.screenshot({ path: join(SHOTS, `m14-topbar-${width}.png`) });
  }
});
