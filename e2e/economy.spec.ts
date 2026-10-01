// M7·M12 경제 (04 문서, 06 문서 3·4장): 훅 → 수집기(:4798) → 화면. 실행이 끝나면 카드·보물상자에 급여(도구 호출 × wagePerCall),
// 세금은 마을 기금(= 팀장 지갑). 게임 하루(활동 2초)가 지나면 정산 토스트·경제 패널(기금 흐름, 주별 흐름, 효율, 표로 보기),
// 팀장 토큰값이 기금보다 크면 시청 적자(상단 바·패널·팀장 집), 상점에서 사기 → 잔고·방, 집에서 옮기기 → 새로고침에도 남음, 잔고 부족.
// 규칙 자체는 packages/core/src/rules/economy.test.ts
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';

const COLLECTOR = 'http://127.0.0.1:4798'; // playwright.config.ts (TYCOON_CLOCK_MS 250)
const root = resolve(import.meta.dirname, '..');
const SHOTS = process.env.SHOTS;
const SESSION = 'm7'; // 수집기는 세션을 첫 마을에 묶는다 → 다른 spec과 다른 세션
const DAY_MS = 2000; // 이 마을만 게임 하루 = 활동 2초 (.claude/tycoon.json overrides.time.gameDayMs, 01 문서 6.2)
const CALLS = 10; // 실행마다 도구 호출 수 → 급여 26 × 10 = 260 (세금 52는 기금, 208은 잔고)

interface Furniture {
  id: string;
  kind: string;
  by: string;
  price: number;
  placed: { x: number; y: number; rot: number } | null;
}
interface State {
  clock: { day: number };
  members: Record<string, { name: string; isLeader: boolean; balance: number; furniture: Furniture[] }>;
  runs: Record<string, { endedAt: number | null; wage?: number }>;
  economy: { fund: number; deficit: boolean; history: { day: number; tax: number }[] };
}

let cwd = '';
let pid = '';
let agents = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const post = async (e: Record<string, unknown>) => {
  const r = await fetch(`${COLLECTOR}/hook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session_id: SESSION, cwd, ...e }),
  });
  expect(r.status).toBe(204);
};
const create = (taskId: string, subject: string) =>
  post({ hook_event_name: 'PostToolUse', tool_name: 'TaskCreate', tool_input: { subject }, tool_response: { taskId } });
const update = (taskId: string, status: string) =>
  post({ hook_event_name: 'PostToolUse', tool_name: 'TaskUpdate', tool_input: { taskId, status } });
/** 작업 하나: in_progress → 그 팀원 실행(도구 CALLS번) → 완료. 급여는 실행이 끝날 때 그 팀원에게 (D20). 실행 id를 돌려준다 */
async function work(taskId: string, member: string) {
  await update(taskId, 'in_progress');
  const agent_id = `m7-a${++agents}`;
  await post({ hook_event_name: 'SubagentStart', agent_id, agent_type: member });
  for (let i = 0; i < CALLS; i++)
    await post({ hook_event_name: 'PostToolUse', agent_id, tool_name: 'Read', tool_use_id: `${agent_id}-${i}` });
  await sleep(120);
  await post({ hook_event_name: 'SubagentStop', agent_id, agent_type: member });
  await update(taskId, 'completed');
  return agent_id;
}
const state = async () => (await (await fetch(`${COLLECTOR}/api/projects/${pid}/state`)).json()) as State;
const fmt = (n: number) => n.toLocaleString('ko-KR');
/** 시간은 에이전트가 일할 때만 간다 (01 문서 6.2 활동 시간): 외부인(Explore) 실행을 열어 둔 동안 수집기가 250ms마다
 *  시계 줄(Tick)을 넣어 날이 간다. 닫으면 쉬는 마을 → 날이 멈춰 잔고가 자동 구매로 안 흔들린다 */
const CLOCK = 'm7-clock';
const clockOn = () => post({ hook_event_name: 'SubagentStart', agent_id: CLOCK, agent_type: 'Explore' });
async function clockOff() {
  await post({ hook_event_name: 'SubagentStop', agent_id: CLOCK, agent_type: 'Explore' });
  await expect.poll(async () => (await state()).runs[CLOCK]?.endedAt).not.toBeNull(); // /hook은 204 뒤에 처리
}
const shot = (page: Page, name: string) => (SHOTS ? page.screenshot({ path: join(SHOTS, name) }) : undefined);
const crop = (part: Locator, name: string) => (SHOTS ? part.screenshot({ path: join(SHOTS, name) }) : undefined);
/** 토스트 칸의 오른쪽 여백 — 상세의 정보 패널을 비켜 서는지 (01 문서 8.2 화면 메모: 집·상점 440 + 16, 경제 16) */
const toastRight = (page: Page) => page.locator('.ts').evaluate((e) => getComputedStyle(e).right);

test.beforeAll(async () => {
  cwd = mkdtempSync(join(tmpdir(), 'tycoon-m7-'));
  cpSync(join(root, 'examples/target-project/.claude'), join(cwd, '.claude'), { recursive: true });
  const path = join(cwd, '.claude/tycoon.json');
  const tycoon = JSON.parse(readFileSync(path, 'utf8')) as { overrides?: Record<string, unknown> };
  // 공공시설 없는 마을 (M14: 기금 흐름 숫자를 그대로 보려고)
  tycoon.overrides = { ...tycoon.overrides, time: { gameDayMs: DAY_MS }, publicWorks: [] };
  writeFileSync(path, JSON.stringify(tycoon));
  await post({ hook_event_name: 'SessionStart', source: 'startup' });
  const list = (await (await fetch(`${COLLECTOR}/api/projects`)).json()) as { id: string; cwd: string }[];
  pid = encodeURIComponent(list.find((p) => p.cwd === cwd)?.id ?? '');
  expect(pid).not.toBe('');
});
// 실패로 끝나도 마을이 쉬게(열린 실행을 닫음) — 쉬는 마을엔 시계 줄이 없어 live.spec의 '/'(가장 최근 마을)를 가로채지 않는다
test.afterAll(async () => {
  if (pid) await post({ hook_event_name: 'SessionEnd' });
});

test('급여 → 카드·보물상자, 하루가 지나면 정산 토스트·경제 패널, 상점에서 사고 집에서 옮기기', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?project=${pid}`);
  await expect(page.locator('button.tp-card')).toHaveCount(4);

  // ── 실행 끝 → 급여 (D20, 06 문서 3.4): 카드 잔고·상단 바 보물상자·마을 기금 = 상태. 팀장 카드 = 기금 (D21) ──
  const plan = [
    ['t1', '주문 목록 API', 'backend-dev'],
    ['t2', '주문 목록 화면', 'frontend-dev'],
    ['t3', '주문 목록 테스트', 'qa-reviewer'],
  ] as const;
  for (const [id, subject] of plan) await create(id, subject);
  const runs: string[] = [];
  for (const [id, , who] of plan) runs.push(await work(id, who));
  const wages = async () => {
    const s = await state();
    return runs.map((r) => s.runs[r]?.wage);
  };
  await expect.poll(wages).toEqual([260, 260, 260]); // 26 × 도구 10번 × 품질 1
  await expect
    .poll(async () => {
      const s = await state();
      const cards = (await page.locator('button.tp-card .tp-card__bal').allTextContents()).map(
        (x) => x.replace(/[^\d,]/g, ''), // 진주 아이콘 <title>
      );
      const vault = await page.locator('.tb__chip--vault .tb__num').textContent();
      const fund = await page.locator('.tb__chip--fund .tb__num').textContent();
      const sum = Object.values(s.members).reduce((n, m) => n + m.balance, 0);
      const want = Object.values(s.members).map((m) => fmt(m.isLeader ? s.economy.fund : m.balance));
      return (
        [...cards].sort().join('|') === [...want].sort().join('|') &&
        vault === fmt(sum) &&
        fund === fmt(s.economy.fund) &&
        s.economy.fund === 3 * 52
      );
    })
    .toBe(true);

  // ── 게임 하루 정산 → 급여 토스트 (자동으로 사라짐, 01 문서 9장). 작업 실행 셋은 합쳐 1초도 안 돼 아직 0일 ──
  expect((await state()).economy.history).toEqual([]);
  await clockOn();
  const salary = page
    .locator('.ts .ui-toast')
    .filter({ hasText: /\d+일째 정산/ })
    .first();
  await expect(salary).toBeVisible({ timeout: DAY_MS * 4 });
  await expect(salary).toContainText('급여');
  const title = (await salary.locator('.ui-toast__title').textContent()) ?? '';
  await shot(page, 'm7-main.png');
  await expect(page.locator('.ts .ui-toast__title').filter({ hasText: title })).toHaveCount(0, { timeout: 8000 });
  await expect(page.locator('.af__text').filter({ hasText: title })).toHaveCount(1); // 활동 기록 '경제'에 남음

  // ── 며칠 더 → 경제 패널 (상단 바 마을 기금 칩, D21). 물가·금리·중앙은행은 없다 (D20) ──
  await expect
    .poll(async () => (await state()).economy.history.length, { timeout: DAY_MS * 6 })
    .toBeGreaterThanOrEqual(4);
  await clockOff();
  const s1 = await state();
  const fund = page.locator('.tb__chip--fund');
  await expect(fund).toHaveAttribute('title', '팀장(시장)의 지갑 · 세금으로 벌고 팀장 토큰값을 내요 · 경제 패널 열기');
  await expect(fund).not.toHaveClass(/tb__chip--deficit/);
  await expect(page.locator('.tb')).not.toContainText('물가');
  await crop(page.locator('.tb'), 'm12-topbar-fund.png');
  await fund.click();
  await expect(page).toHaveURL(new RegExp(`[?&]economy$`));
  const ec = page.locator('.ms__detail .ec');
  // 기금 흐름 = 기간 합: 세금 3 × 52 (팀장 토큰값은 기록 파일이 없어 0), 지금 기금 = 상태
  expect(s1.economy.history.reduce((n, r) => n + r.tax, 0)).toBe(3 * 52);
  await expect(ec.locator('.ec-fund .ec-frow')).toHaveText([
    '세금+156',
    '팀장 토큰값0',
    '레벨업·공공시설0',
    '팀장 가구0',
    '못 낸 팀장 토큰값0',
    `지금 기금${fmt(s1.economy.fund)}`,
  ]);
  await expect(ec).not.toContainText(/물가|기준금리|중앙은행/);
  // 효율 = 일 1점당 토큰 (D23): 실행 1번씩이라 모두 순위 밖, 마을 전체 = 도구 호출 합
  await expect(ec.locator('.ec-erow[data-member="backend-dev"]')).toContainText('실행 1/3번');
  await expect(ec).toContainText(`마을 전체 · 지금까지 일 ${3 * CALLS}점`);
  // 주별 흐름 툴팁: 포커스 → End = 이번 주
  await ec.getByRole('group', { name: /^주별 수입과 지출/ }).focus();
  await page.keyboard.press('End');
  await expect(ec.locator('.ec-tip__val').first()).toHaveText('이번 주');
  expect(await toastRight(page)).toBe('16px');
  await shot(page, 'm12-economy.png');
  await crop(ec.locator('.ec-fund'), 'm12-fund-flow.png');
  await ec.getByRole('button', { name: '표로 보기' }).click();
  const today = Math.max(s1.clock.day, ...s1.economy.history.map((r) => r.day));
  const weeks = new Set(s1.economy.history.map((r) => Math.floor((today - r.day) / 7))).size;
  await expect(ec.getByRole('table', { name: '보물상자 흐름 (주별)' }).locator('tbody tr')).toHaveCount(weeks);
  await shot(page, 'm12-economy-table.png');
  await ec.getByRole('button', { name: '표로 보기' }).click();

  // ── 팀장 가구는 사용자가 사 주면 기금에서 (D21): 화분 80 → 기금 76, 기금 흐름 '팀장 가구' (팀원 가구 지출과 따로) ──
  const leaderBuy = await fetch(`${COLLECTOR}/api/projects/${pid}/purchase`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ memberId: '@leader', kind: 'plant', fabric: null }),
  });
  expect(leaderBuy.status).toBe(204);
  await expect(ec.locator('.ec-fund .ec-frow').nth(3)).toHaveText('팀장 가구−80');
  await expect(ec.locator('.ec-fund .ec-frow').last()).toHaveText('지금 기금76');

  // ── 시청 적자 (D21, 06 문서 3.3): 팀장 토큰값(기록 파일 출력 20만 → 진주 1,000)이 기금보다 크면 가진 만큼 내고 0에서 멈춤 ──
  const transcript = join(cwd, 'm12-main.jsonl');
  writeFileSync(transcript, `${JSON.stringify({ message: { id: 'm12-1', usage: { output_tokens: 200_000 } } })}\n`);
  await post({ hook_event_name: 'Stop', transcript_path: transcript });
  await expect.poll(async () => (await state()).economy).toMatchObject({ fund: 0, deficit: true });
  await expect(fund).toHaveClass(/tb__chip--deficit/);
  await expect(fund).toHaveAttribute('title', /^시청 적자 · /);
  await expect(fund.locator('.tb__num')).toHaveText('0');
  await expect(ec.locator('.ec-fund .ec-deficit')).toContainText('시청 적자');
  // 아직 정산 전(오늘) 몫도 흐름에: 156 − 가구 80 = 76을 다 내고 나머지 924는 못 냄 → 지금 기금 0과 맞는다
  await expect(ec.locator('.ec-fund .ec-frow')).toHaveText([
    '세금+156',
    '팀장 토큰값−76',
    '레벨업·공공시설0',
    '팀장 가구−80',
    '못 낸 팀장 토큰값924',
    '지금 기금0',
  ]);
  await shot(page, 'm12-economy-deficit.png');
  await crop(page.locator('.tb'), 'm12-topbar-deficit.png');
  await crop(ec.locator('.ec-fund'), 'm12-fund-flow-deficit.png');

  // 팀장 집 지갑 = 시청 금고 = 마을 기금 (D21): 기금 0, 시청 적자, 오늘 기금에서 낸 가구 80 · 팀장 토큰값 76
  await page.goto(`/?project=${pid}&house=${encodeURIComponent('@leader')}`);
  const lh = page.locator('.ms__detail .hs');
  await expect(lh).toContainText('시청 금고 = 마을 기금');
  await expect(lh.locator('.hs-hardship')).toContainText('시청 적자');
  await expect(lh.locator('.hs-row').filter({ hasText: '오늘 가구 구입' })).toHaveText('오늘 가구 구입−80');
  await expect(lh.locator('.hs-row').filter({ hasText: '팀장 토큰값 · 오늘' })).toHaveText('팀장 토큰값 · 오늘−76');
  await shot(page, 'm12-leader-house.png');
  await crop(lh.locator('.hs-card').filter({ has: page.locator('.hs-balance') }), 'm12-leader-wallet.png');
  await page.goto(`/?project=${pid}`);

  // ── 카드 → 집 → 상점: 사기 → 잔고가 값만큼 줄고 방에 놓인다 ──
  await page.locator('button.tp-card[data-member="backend-dev"]').click();
  await expect(page).toHaveURL(/[?&]house=backend-dev$/);
  await page.locator('.ms__detail').getByRole('button', { name: '가구 사러 가기' }).click();
  await expect(page).toHaveURL(/[?&]shop=backend-dev$/);
  const shop = page.locator('.ms__detail .sh');
  await shop
    .locator('.sh-item[data-kind="plant"]')
    .getByRole('button', { name: /고르기$/ })
    .click();
  const cost = Number(await shop.locator('.sh-side .sh-num[data-price]').getAttribute('data-price'));
  const before = (await state()).members['backend-dev'];
  const had = new Set(before?.furniture.map((f) => f.id));
  expect(await toastRight(page)).toBe('456px');
  await shot(page, 'm7-shop.png');
  await shop.getByRole('button', { name: /에 사기$/ }).click();
  await expect(shop.getByRole('status').filter({ hasText: '샀어요' })).toBeVisible();
  const after = (await state()).members['backend-dev'];
  expect(after?.balance).toBe((before?.balance ?? 0) - cost);
  const bought = after?.furniture.find((f) => !had.has(f.id));
  expect([bought?.kind, bought?.by, bought?.price]).toEqual(['plant', 'user', cost]);
  await expect(shop.locator('.sh-who[data-member="backend-dev"]')).toContainText(fmt(after?.balance ?? 0));

  // 잔고 부족: 버튼이 막히고 한 줄 안내, 서버도 409
  await shop
    .locator('.sh-item[data-kind="bed"]')
    .getByRole('button', { name: /고르기$/ })
    .click();
  await expect(shop.getByRole('button', { name: /에 사기$/ })).toBeDisabled();
  await expect(shop.locator('.sh-short')).toContainText(/진주가 [\d,]+ 모자라요/);
  const poor = await fetch(`${COLLECTOR}/api/projects/${pid}/purchase`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ memberId: 'backend-dev', kind: 'bed', fabric: 'blue' }),
  });
  expect(poor.status).toBe(409);

  // ── 집으로: 산 가구가 방에, 키보드로 옮기고 저장 → 새로고침에도 남음 ──
  await shop.getByRole('button', { name: '집으로' }).click();
  await expect(page).toHaveURL(/[?&]house=backend-dev$/);
  const house = page.locator('.ms__detail .hs');
  const fid = bought?.id ?? '';
  await expect(house.locator(`.hs-room [data-fid="${fid}"]`)).toBeAttached();
  await expect(house.locator(`.hs-list [data-fid="${fid}"]`)).toBeVisible();
  // 지갑의 최근 급여 = 이 팀원 마지막 실행의 급여 (세전, D20). TaskCreate 작업은 실행과 짝이 없어 이름은 에이전트 종류
  await expect(house.locator('.hs-meta').filter({ hasText: '최근: ' })).toHaveText('최근: backend-dev +260');
  await expect(house).not.toContainText('관리비');
  await crop(house.locator('.hs-card').filter({ has: page.locator('.hs-balance') }), 'm12-member-wallet.png');
  await house.getByRole('button', { name: '가구 옮기기' }).click();
  const item = house.locator(`button[data-fid="${fid}"]`);
  const from = await item.getAttribute('aria-label');
  await item.focus();
  for (const key of ['ArrowRight', 'ArrowDown', 'ArrowRight', 'ArrowDown']) {
    await page.keyboard.press(key);
    if ((await item.getAttribute('aria-label')) !== from) break;
  }
  const to = (await item.getAttribute('aria-label')) ?? '';
  expect(to).not.toBe(from);
  await shot(page, 'm7-house-move.png');
  await house.getByRole('button', { name: '저장' }).click();
  await expect(house.getByRole('button', { name: '가구 옮기기' })).toBeVisible();
  const [, x, y] = /\((\d+), (\d+)\)/.exec(to) ?? [];
  await expect
    .poll(async () => (await state()).members['backend-dev']?.furniture.find((f) => f.id === fid)?.placed)
    .toMatchObject({ x: Number(x), y: Number(y) });
  await page.reload();
  await page.locator('.ms__detail .hs').getByRole('button', { name: '가구 옮기기' }).click();
  await expect(page.locator(`.ms__detail button[data-fid="${fid}"]`)).toHaveAttribute('aria-label', to);
  await page.locator('.ms__detail .hs').getByRole('button', { name: '취소' }).click();
  expect(await toastRight(page)).toBe('456px');
  await shot(page, 'm7-house.png');
});
