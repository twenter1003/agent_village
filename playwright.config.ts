import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

// e2e는 전용 포트만 쓴다 (5173은 다른 앱, 4777은 개발용 수집기가 돌고 있을 수 있음).
// 수집기 :4798 + 빈 임시 DB(실행마다 새로), 웹 :5174는 그 수집기로 프록시.
const E2E_COLLECTOR = 'http://127.0.0.1:4798';
// ponytail: 임시 DB 폴더는 지우지 않는다(OS 임시 폴더가 치움). 쌓이면 globalTeardown
const db = join(tmpdir(), `tycoon-e2e-${Date.now()}`, 'tycoon.db');

export default defineConfig({
  testDir: 'e2e',
  // 수집기 하나를 모든 파일이 같이 쓴다 (live.spec은 '/'가 가장 최근 마을을 고르는지 본다) → 한 번에 한 파일
  workers: 1,
  use: { baseURL: 'http://localhost:5174' },
  webServer: [
    {
      command: 'pnpm exec tsx packages/server/src/index.ts',
      url: `${E2E_COLLECTOR}/health`,
      // 일하는 마을의 시계 줄 250ms: economy·personality spec이 tycoon.json overrides.time.gameDayMs를 2초로 줄이고
      // 실행 하나를 열어 둔 동안만 날이 간다 (01 문서 6.2 활동 시간)
      env: { TYCOON_PORT: '4798', TYCOON_DB: db, TYCOON_CLOCK_MS: '250' },
      reuseExistingServer: false,
    },
    {
      command: 'pnpm tokens && pnpm assets && pnpm --filter @tycoon/web exec vite --port 5174 --strictPort',
      port: 5174,
      env: { TYCOON_COLLECTOR: E2E_COLLECTOR },
      reuseExistingServer: false,
    },
  ],
});
