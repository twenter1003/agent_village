import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, test } from 'vitest';
import { tokens } from './tokens';

// CLAUDE.md: 색은 토큰만. 새 색은 design/tokens*.css에 먼저. 생성 파일(tokens.ts, assets/sea/data·critter)은 뺀다
const GENERATED = new Set(['tokens.ts', 'assets/sea/data.ts', 'assets/sea/critter.ts']);

test('손으로 쓴 web 코드에 16진 색이 없다', () => {
  const dir = import.meta.dirname;
  const files = (readdirSync(dir, { recursive: true }) as string[])
    .map((f) => relative(dir, join(dir, f)))
    .filter((f) => /\.(tsx?|css)$/.test(f) && !f.endsWith('.test.ts') && !GENERATED.has(f));
  expect(files.length).toBeGreaterThan(20);
  const hits = files.flatMap((f) =>
    [...readFileSync(join(dir, f), 'utf8').matchAll(/#[0-9a-f]{3,8}\b/gi)].map((m) => `${f}: ${m[0]}`),
  );
  expect(hits).toEqual([]);
});

test('흰 반사 토큰 --sheen (물결·빛줄기·거품·진주 반사점)', () => {
  expect(tokens.sheen).toBe('#ffffff');
});
