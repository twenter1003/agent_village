// M8 성격 (04 문서): 훅 → 수집기(:4798) → 화면. backend-dev(ISTJ, T/F 25)가 칭찬·고마움 말만 가득한 최종 보고로
// 작업을 끝내면 T/F가 F 쪽으로 움직인다 → 카드 MBTI 칩의 T가 라벤더(바뀌는 중), 하루 한도에 걸려 그날은 더 안 가고,
// 다음 날 55를 넘으면 F로 한 번 바뀜 → 성격 토스트 + 활동 기록 '성격' 한 줄, 집 상세 막대·이유 문장.
// 규칙 자체(30 → 60 = 15일, 45~55 히스테리시스)는 packages/core/src/rules/personality.test.ts
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const COLLECTOR = 'http://127.0.0.1:4798'; // playwright.config.ts (TYCOON_CLOCK_MS 250)
const root = resolve(import.meta.dirname, '..');
const SHOTS = process.env.SHOTS;
const SESSION = 'm8'; // 수집기는 세션을 첫 마을에 묶는다 → 다른 spec과 다른 세션
// 게임 하루 = 활동 2초 (01 문서 6.2): 작업 실행(120ms)으로는 하루가 안 가고, 시계 실행을 열어 둔 동안만 간다
const DAY_MS = 2000;
// 이 마을만 성격을 빨리: 기본(emaAlpha 0.1, 하루 2)이면 25 → 55에 15일. 0.5·20이면 표본 하나에 +20(한도),
// 같은 날 두 번째 표본은 한도에 걸려 그대로, 다음 날 +20 → 65 > 55로 F. 계산식은 01 문서 7장 그대로
const PERSONALITY = { emaAlpha: 0.5, maxDriftPerDay: 20 };
// feeling 낱말만 (lexicon.thinking의 fix·error·원인 같은 부분 문자열도 없게)
const WARM = '다들 고마워요! 리뷰 감사합니다. 화면이 좋아요, 멋지네요. thanks, great work, nice';
const FLIP = 'backend-dev 성격이 T → F로 바뀜';
const WHY = '보고에 칭찬·고마움 말이 늘어서';

interface State {
  clock: { day: number };
  runs: Record<string, { endedAt: number | null }>;
  members: Record<
    string,
    { personality: { TF: number; letters: string; driftToday: { TF: number }; samples: unknown[]; reason: string } }
  >;
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
/** 작업 하나: in_progress → backend-dev 실행(최종 보고 WARM) → 완료. 표본은 완료 순간 → 실행이 먼저 끝나야 보고가 들어간다 */
async function work(taskId: string) {
  await update(taskId, 'in_progress');
  const agent_id = `m8-a${++agents}`;
  await post({ hook_event_name: 'SubagentStart', agent_id, agent_type: 'backend-dev' });
  await sleep(120);
  await post({ hook_event_name: 'SubagentStop', agent_id, agent_type: 'backend-dev', last_assistant_message: WARM });
  await update(taskId, 'completed');
}
const state = async () => (await (await fetch(`${COLLECTOR}/api/projects/${pid}/state`)).json()) as State;
const me = async () => (await state()).members['backend-dev']?.personality;
/** 하루 넘기기: 외부인(Explore) 실행을 열어 둔 동안 수집기가 250ms마다 시계 줄(Tick)을 넣어 활동 시간이 흐른다 → 닫으면 멈춤 */
async function nextDay() {
  const day = (await state()).clock.day;
  await post({ hook_event_name: 'SubagentStart', agent_id: 'm8-clock', agent_type: 'Explore' });
  await expect.poll(async () => (await state()).clock.day, { timeout: 10_000 }).toBeGreaterThan(day);
  await post({ hook_event_name: 'SubagentStop', agent_id: 'm8-clock', agent_type: 'Explore' });
  await expect.poll(async () => (await state()).runs['m8-clock']?.endedAt).not.toBeNull(); // /hook은 204 뒤에 처리
}
const shot = (page: Page, name: string) => (SHOTS ? page.screenshot({ path: join(SHOTS, name) }) : undefined);

test.beforeAll(async () => {
  cwd = mkdtempSync(join(tmpdir(), 'tycoon-m8-'));
  cpSync(join(root, 'examples/target-project/.claude'), join(cwd, '.claude'), { recursive: true });
  const path = join(cwd, '.claude/tycoon.json');
  const tycoon = JSON.parse(readFileSync(path, 'utf8')) as { overrides?: Record<string, unknown> };
  tycoon.overrides = { ...tycoon.overrides, time: { gameDayMs: DAY_MS }, personality: PERSONALITY };
  writeFileSync(path, JSON.stringify(tycoon));
  await post({ hook_event_name: 'SessionStart', source: 'startup' });
  const list = (await (await fetch(`${COLLECTOR}/api/projects`)).json()) as { id: string; cwd: string }[];
  pid = encodeURIComponent(list.find((p) => p.cwd === cwd)?.id ?? '');
  expect(pid).not.toBe('');
});
// 실패로 끝나도 마을이 쉬게(열린 실행을 닫음) — 쉬는 마을엔 시계 줄이 없다
test.afterAll(async () => {
  if (pid) await post({ hook_event_name: 'SessionEnd' });
});

test('칭찬 가득한 보고 → 카드 칩 T가 라벤더, 하루 한도, 다음 날 F로 바뀜 → 토스트·활동 기록·집 막대', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?project=${pid}`);
  await expect(page.locator('button.tp-card')).toHaveCount(4);
  const card = page.locator('button.tp-card[data-member="backend-dev"]');
  const chip = card.locator('.ui-chip--mbti');
  await expect(chip).toHaveAttribute('aria-label', '성격 ISTJ'); // 직업 씨앗, 바뀌는 중 없음
  await expect(chip.locator('.ui-mbti-drift')).toHaveCount(0);

  // ── 첫날: 표본 하나에 25 → 45 (한도 20), 글자는 아직 T, 바뀌는 중 T → F (45−25)/(55−25) = 67% ──
  for (const [id, subject] of [
    ['t1', '주문 API'],
    ['t2', '주문 API 문서'],
    ['t3', '주문 API 캐시'],
  ] as const)
    await create(id, subject);
  await work('t1');
  await expect.poll(async () => (await me())?.TF).toBe(45);
  await expect(chip).toHaveAttribute('aria-label', '성격 ISTJ, T가 F 쪽으로 67%');
  await expect(chip.locator('.ui-mbti-drift')).toHaveText('T');
  // 같은 날 두 번째 표본: 한도에 걸려 그대로 (7장 driftToday)
  await work('t2');
  await expect.poll(async () => (await me())?.samples.length).toBe(2);
  expect(await me()).toMatchObject({ TF: 45, letters: 'ISTJ', driftToday: { TF: 20 }, reason: WHY });
  await shot(page, 'm8-team-drift.png');

  // 집 상세: T/F 막대가 라벤더 + "T가 F 쪽으로 67%", 이유 문장
  await card.click();
  await expect(page).toHaveURL(/[?&]house=backend-dev$/);
  const house = page.locator('.ms__detail .hs');
  const tf = house.locator('.hs-ax[data-axis="TF"]');
  await expect(tf).toHaveClass(/hs-ax--drift/);
  await expect(tf.locator('.hs-ax__drift')).toHaveText('T가 F 쪽으로 67%');
  await expect(tf.locator('.hs-ax__mark')).toHaveAttribute('style', /left: 45%/);
  await expect(house.locator('.hs-drift')).toHaveText('T');
  await expect(house.locator('.hs-reason')).toHaveText(WHY);
  await shot(page, 'm8-house-drift.png');
  await house.getByRole('button', { name: '마을', exact: true }).click();
  await expect(page).not.toHaveURL(/house=/);

  // ── 다음 날: 틱이 한도를 풀고 45 → 65 > 55 → F로 한 번 바뀜 ──
  expect((await state()).clock.day).toBe(0); // 작업 둘(실행 120ms씩)로는 하루가 안 간다
  await nextDay();
  await work('t3');
  await expect.poll(async () => (await me())?.letters).toBe('ISFJ');
  expect((await me())?.TF).toBe(65);
  const toast = page.locator('.ts .ui-toast').filter({ hasText: FLIP });
  await expect(toast).toBeVisible(); // 자동 토스트 5초
  await expect(toast.locator('.ui-toast__desc')).toHaveText(WHY);
  await expect(chip).toHaveAttribute('aria-label', '성격 ISFJ'); // F 쪽이라 더 바뀌는 중 아님
  await expect(chip.locator('.ui-mbti-drift')).toHaveCount(0);
  const feed = page.locator('section.af');
  await feed.getByRole('button', { name: '성격' }).click();
  await expect(feed.locator('.af__row')).toHaveCount(1); // 글자는 한 번만 바뀐다
  await expect(feed.locator('.af__row[data-kind="personality"] .af__text')).toHaveText(`${FLIP} · ${WHY}`);
  await shot(page, 'm8-flip.png');

  // 집 상세: 막대 65, 바뀌는 중 없음, 제목 ISFJ
  await card.click();
  await expect(tf.locator('.hs-ax__mark')).toHaveAttribute('style', /left: 65%/);
  await expect(tf).not.toHaveClass(/hs-ax--drift/);
  await expect(house.locator('.hs-mbti')).toHaveText('ISFJ');
  await expect(house.locator('.hs-reason')).toHaveText(WHY);
  await expect(house.locator('.hs-pers .hs-meta')).toHaveText('최근 작업 20개로 계산 · 하루 최대 20%');
  await shot(page, 'm8-house.png');
});
