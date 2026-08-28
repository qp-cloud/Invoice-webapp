// @ts-check
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/build/**', '**/coverage/**', '**/node_modules/**', '**/*.config.*'],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // Money safety (spec §9, §19): no floating-point arithmetic outside the money module.
    // Enforced by review + this coarse guard; the real contract is the branded Satang type.
    files: ['packages/**/*.ts'],
    ignores: ['packages/shared/src/money/**', '**/*.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'warn',
        {
          selector: "BinaryExpression[operator=/^[*/]$/] > Identifier[name=/[Ss]atang/]",
          message: 'Do not do float arithmetic on satang values — use packages/shared/money helpers.',
        },
      ],
    },
  },
);
