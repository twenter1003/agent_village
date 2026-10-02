// 사용 설명서 PDF (docs/guide.pdf). 원본 = docs/guide/src/*.html (장마다 한 조각, 파일 이름 순) + guide.css + img/
//   pnpm guide        → 표지 + 차례(h1·h2에서) + 본문을 Chromium으로 A4 PDF, 아래 가운데 "n / N"
//   pnpm guide 03     → 이름에 "03"이 든 조각만 docs/guide/.preview-03.pdf로 (장 하나 미리 보기, 표지·차례 없음)
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const dir = join(import.meta.dirname, '../docs/guide');
const only = process.argv[2];
const body = readdirSync(join(dir, 'src'))
  .filter((f) => f.endsWith('.html') && (!only || f.includes(only)))
  .sort()
  .map((f) => readFileSync(join(dir, 'src', f), 'utf8'))
  .join('\n');

// 차례: 장(h1)과 절(h2) 글자 그대로. 쪽 번호는 넣지 않는다 (옛 판과 같음)
const strip = (s: string) => s.replace(/<[^>]+>/g, '').trim();
const toc = [...body.matchAll(/<h([12])[^>]*>([\s\S]*?)<\/h\1>/g)]
  .map(([, lv, text]) => `<li class="toc-h${lv}">${strip(text ?? '')}</li>`)
  .join('\n');

const front = `<section class="cover">
  <p class="cover-title">서브에이전트 타이쿤</p>
  <p class="cover-sub">사용 설명서</p>
  <p class="cover-lead">Claude Code 서브에이전트 팀을 바닷속 동물 마을로 보는 로컬 모니터링 웹앱</p>
  <img src="img/cover.jpg" alt="">
  <p class="cover-date">${new Date().toLocaleDateString('sv-SE')} 판</p>
</section>
<section class="toc"><h2 class="toc-title">차례</h2><ul>${toc}</ul></section>`;
const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>서브에이전트 타이쿤 사용 설명서</title>
<link rel="stylesheet" href="guide.css"></head><body>
${only ? '' : front}
${body}
</body></html>`;

const page = join(dir, only ? `.guide-${only}.html` : '.guide.html'); // 같은 폴더라 guide.css·img/가 그대로 풀린다
const out = only ? join(dir, `.preview-${only}.pdf`) : join(dir, '../guide.pdf');
writeFileSync(page, html);
const browser = await chromium.launch();
const tab = await browser.newPage();
await tab.goto(`file://${page}`);
await tab.evaluate(() => document.fonts.ready);
await tab.pdf({
  path: out,
  format: 'A4',
  margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' },
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: '<span></span>',
  footerTemplate:
    '<div style="width:100%;text-align:center;font-size:8px;color:#666"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
});
await browser.close();
console.log(out);
