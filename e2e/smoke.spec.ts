import { expect, test } from '@playwright/test';

test('배경이 바다 --cream', async ({ page }) => {
  await page.goto('');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(230, 243, 241)');
});

test('갤러리: 에셋 id가 DOM에 남아 있다', async ({ page }) => {
  await page.goto('/dev/gallery');
  await expect(page.locator('[data-asset-id="roof.dome"]').first()).toBeAttached();
  expect(await page.locator('[data-asset-id][data-anchor]').count()).toBeGreaterThan(40);
});

test('캐릭터 시트: 21종(동물 도감 20 + 복어) × (7포즈 + 얼굴), 파츠가 움직인다', async ({ page }) => {
  await page.goto('/dev/characters');
  await expect(page.locator('[data-sheet="poses"] svg[data-asset-id]')).toHaveCount(168);
  const body = page.locator('[data-part="body"]').nth(1); // 물범 헤엄
  const seen = new Set<string | null>();
  for (let i = 0; i < 8; i++) {
    seen.add(await body.getAttribute('transform'));
    await page.waitForTimeout(160);
  }
  expect(seen.size).toBeGreaterThan(1);
});

test('마을: 바다 09 구성 (건물 14, 캐릭터 7, 전체 보기)', async ({ page }) => {
  await page.goto('/dev/village');
  await expect(page.locator('svg[data-asset-id$=".face"], svg[role="img"][data-anchor="0,0"]')).toHaveCount(7);
  await expect(page.locator('[data-asset-id^="body."], [data-asset-id^="site."]').first()).toBeAttached();
  await expect(page.getByText('결제 API는 이렇게 가요!')).toBeVisible();
  await page.getByRole('button', { name: '전체 보기' }).click();
});
