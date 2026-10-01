// M9 설정 (01 문서 10장 화면 메모·D14): 훅 → 수집기(:4798) → 설정 화면에서 팀원 동물·하루 길이를 바꾸면 수집기가 타이쿤 저장 공간의
// 마을 설정 파일에 정본 id로 합쳐 쓰고(프로젝트 폴더는 안 건드림), 팀원 카드가 바로 바뀐다. 표시 설정(회의 안건 글자)은 이 브라우저에 남는다.
// 훅 설치 안내의 복사 버튼. 저장 검사 400·404·409는 packages/server/src/collector.test.ts
import { cpSync, existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const COLLECTOR = 'http://127.0.0.1:4798'; // playwright.config.ts
const root = resolve(import.meta.dirname, '..');
const SHOTS = process.env.SHOTS;
const SESSION = 'm9s'; // 수집기는 세션을 첫 마을에 묶는다 → 다른 spec과 다른 세션

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
const shot = (page: Page, name: string) => (SHOTS ? page.screenshot({ path: join(SHOTS, name) }) : undefined);

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test.beforeAll(async () => {
  cwd = mkdtempSync(join(tmpdir(), 'tycoon-m9s-'));
  cpSync(join(root, 'examples/target-project/.claude'), join(cwd, '.claude'), { recursive: true });
  await post({ hook_event_name: 'SessionStart', source: 'startup' });
  const list = (await (await fetch(`${COLLECTOR}/api/projects`)).json()) as { id: string; cwd: string }[];
  pid = encodeURIComponent(list.find((p) => p.cwd === cwd)?.id ?? '');
  expect(pid).not.toBe('');
});
test.afterAll(async () => {
  if (pid) await post({ hook_event_name: 'SessionEnd' });
});

test('설정: 팀원 동물·하루 길이 → 타이쿤 저장 공간(정본 id, 프로젝트 폴더 그대로) → 팀원 카드, 표시 설정은 새로고침에도, 훅 안내 복사', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?project=${pid}`);
  const face = page.locator('[data-member="backend-dev"] [data-asset-id$=".face"]');
  await expect(face).toHaveAttribute('data-asset-id', 'seal.face'); // 예시 tycoon.json: bear = 점박이물범

  await page.getByRole('button', { name: '설정', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`\\?project=${pid}&settings$`));
  const st = page.locator('.st');
  await expect(st.getByRole('heading', { name: '설정', level: 1 })).toBeVisible();
  const row = st.locator('[data-member="backend-dev"]');
  await row.getByLabel('동물').selectOption({ label: '수달' });
  await row.getByLabel('소품').selectOption({ label: '불가사리 핀' });
  await st.getByLabel('게임 하루 길이 (활동 분)').fill('30');
  await shot(page, 'm9-settings.png');
  const legacy = join(cwd, '.claude/tycoon.json'); // 예시로 복사해 둔 옛 방식 설정 — 읽기만
  const original = readFileSync(legacy, 'utf8');
  const answer = page.waitForResponse((r) => r.url().endsWith('/settings') && r.request().method() === 'PUT');
  await st.getByRole('button', { name: '저장' }).click();
  const { path: file, backup } = (await (await answer).json()) as { path: string; backup: string | null };
  expect(file.startsWith(cwd)).toBe(false); // 프로젝트 밖
  expect(backup).toBeNull();
  await expect(st.locator('.st-msg')).toContainText(`저장했어요 · ${file}`);
  expect(readFileSync(legacy, 'utf8')).toBe(original);
  expect(existsSync(`${legacy}.bak`)).toBe(false);
  const saved = JSON.parse(readFileSync(file, 'utf8')) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  expect(saved.members['backend-dev']).toEqual({ species: 'rabbit', job: 'backend', accessory: 'beret' }); // 정본 id
  expect(saved.members['frontend-dev']).toEqual({ species: 'rabbit', job: 'frontend', accessory: 'beret' }); // 그대로
  expect(saved.overrides.time.gameDayMs).toBe(1_800_000);
  expect(saved.$comment).toContain('게임 전용 설정'); // 옛 파일 내용에서 시작
  // 수집기가 팀원 목록을 다시 읽음 → SSE → 설정 화면 값과 팀원 카드가 새 값
  await expect(row.getByLabel('동물')).toHaveValue('rabbit');
  await expect(st.getByRole('button', { name: '저장' })).toBeDisabled();
  await st.getByRole('button', { name: '마을', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`\\?project=${pid}$`));
  await expect(face).toHaveAttribute('data-asset-id', 'otter.face');

  // 표시: 회의 안건 글자 끄기 → 회의 토스트에 프롬프트가 안 나온다, 새로고침에도 꺼져 있다
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await st.getByRole('group', { name: '회의 안건 글자' }).getByRole('button', { name: '끄기' }).click();
  await st.getByRole('button', { name: '마을', exact: true }).click();
  await post({ hook_event_name: 'UserPromptSubmit', prompt: '비밀 계획 세우기' });
  await expect(page.locator('.ts .ui-toast__title').filter({ hasText: '광장 회의 시작' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('비밀 계획');
  await page.reload();
  await page.getByRole('button', { name: '설정', exact: true }).click();
  await expect(st.getByRole('group', { name: '회의 안건 글자' }).getByRole('button', { name: '끄기' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // 훅 설치 안내: 연결됨, 훅 주소, 예시 settings.json 복사
  const guide = st.locator('.hg');
  await expect(guide).toContainText('연결됨');
  await expect(guide).toContainText('http://127.0.0.1:4777/hook');
  await guide.getByRole('button', { name: '복사' }).click();
  await expect(guide.getByRole('status')).toHaveText('복사했어요');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(JSON.parse(copied)).toEqual(
    JSON.parse(readFileSync(join(root, 'examples/target-project/.claude/settings.json'), 'utf8')),
  );
  await shot(page, 'm9-settings-display.png');
});
