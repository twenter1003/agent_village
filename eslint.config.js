import js from '@eslint/js';
import ts from 'typescript-eslint';

export default ts.config(
  {
    ignores: [
      '**/dist/**',
      'design/**',
      'packages/web/src/tokens.ts',
      'packages/web/src/assets/sea/data.ts',
      'packages/web/src/assets/sea/critter.ts',
      'playwright-report/**',
      'test-results/**',
      // 디자인 동기화 도구가 만드는 폴더 (.gitignore와 같음)
      '.ds-sync/**',
      '.design-sync/**',
      'ds-bundle/**',
    ],
  },
  js.configs.recommended,
  ...ts.configs.strict,
  { rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } },
);
