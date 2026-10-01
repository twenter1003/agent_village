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
    ],
  },
  js.configs.recommended,
  ...ts.configs.strict,
  { rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } },
);
