import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseTokens } from './gen-tokens';

test('주석 무시, 한 줄 여러 토큰', () => {
  expect(parseTokens('/* --x: 1; */ a { --a: #fff;  --b-c: var(--a); }')).toEqual({ a: '#fff', 'b-c': 'var(--a)' });
});

test('바다가 cream을 덮어씀', () => {
  const read = (f: string) => parseTokens(readFileSync(`design/${f}`, 'utf8'));
  expect({ ...read('tokens.css'), ...read('tokens-sea.css') }.cream).toBe('#e6f3f1');
});
