// M10 성능 측정 (02 문서 8.3: 캐릭터 20, 건물 40, 소품 150에서 60fps). PERF=1일 때만 돈다 — 시간 재기는 기계마다 달라 기본 e2e에 넣지 않는다.
// 결과(평균 fps, 느린 프레임 p95)는 콘솔과 테스트 주석에. 기준은 평균 55fps 이상
import { expect, test, type Page } from '@playwright/test';

test.skip(!process.env.PERF, 'PERF=1 pnpm e2e e2e/perf.spec.ts');

/** rAF 간격을 ms 동안 모은다 */
const frames = (page: Page, ms: number) =>
  page.evaluate(
    (ms) =>
      new Promise<{ fps: number; p95: number; worst: number }>((done) => {
        const gaps: number[] = [];
        let last = performance.now();
        const end = last + ms;
        const tick = (t: number) => {
          gaps.push(t - last);
          last = t;
          if (t < end) return void requestAnimationFrame(tick);
          gaps.sort((a, b) => a - b);
          const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
          done({
            fps: Math.round(1000 / avg),
            p95: Math.round(gaps[Math.floor(gaps.length * 0.95)] ?? 0),
            worst: Math.round(gaps.at(-1) ?? 0),
          });
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );

for (const [name, url] of [
  ['목표 부하 (캐릭터 20, 건물 40, 소품 150)', '/dev/village?load=target'],
  ['마을 스트레스 (팀원 20 + 외부인 3, 걸어 다님)', '/dev/village?live=stress'],
  ['캐릭터 50명 + 거품', '/dev/characters?stress=50'],
  ['수도 (Lv.10, 80×80, 공공시설·팀원 20)', '/dev/village?live=capital'],
] as const)
  test(`성능: ${name}`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url);
    await page.waitForTimeout(1500); // 첫 그리기·에셋
    // 캐릭터 = Critter svg(얼굴 빼고), 건물 = 몸·현장 층, 소품 = prop 에셋
    const counts = await page.evaluate(() => ({
      characters: [...document.querySelectorAll('svg[data-asset-id]')].filter(
        (e) => !e.getAttribute('data-asset-id')?.endsWith('.face') && e.getAttribute('role') === 'img',
      ).length,
      buildings: document.querySelectorAll(
        '[data-asset-id^="body."], [data-asset-id^="site.planned"], [data-asset-id^="site.foundation"]',
      ).length,
      props: document.querySelectorAll('[data-asset-id^="prop."]').length,
    }));
    const r = await frames(page, 5000);
    const line = `${name}: ${JSON.stringify(counts)} → 평균 ${r.fps}fps, p95 ${r.p95}ms, 가장 느린 ${r.worst}ms`;
    console.log(line);
    info.annotations.push({ type: 'perf', description: line });
    expect(r.fps).toBeGreaterThanOrEqual(55);
  });
