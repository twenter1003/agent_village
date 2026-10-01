// tokens.css + tokens-sea.css → packages/web/src/tokens.ts (바다만, 01 문서 D7)
import { readFileSync, writeFileSync } from 'node:fs';

export function parseTokens(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [, k = '', v = ''] of noComments.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) out[k] = v.trim();
  return out;
}

if (process.argv[1]?.endsWith('gen-tokens.ts')) {
  const read = (f: string) => parseTokens(readFileSync(new URL(`../design/${f}`, import.meta.url), 'utf8'));
  const tokens = { ...read('tokens.css'), ...read('tokens-sea.css') };
  writeFileSync(
    new URL('../packages/web/src/tokens.ts', import.meta.url),
    `// 생성됨: pnpm tokens. 직접 고치지 말 것.\nexport const tokens = ${JSON.stringify(tokens, null, 2)} as const;\n`,
  );
}
