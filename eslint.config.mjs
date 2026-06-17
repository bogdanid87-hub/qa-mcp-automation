// @ts-check
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Lint only the server source and scripts — Playwright test/page/fixture
  // files use framework-specific patterns (fixture destructuring, page.* chaining)
  // that would require per-file overrides without adding meaningful signal.
  { files: ['src/**/*.ts', 'scripts/**/*.ts'] },

  // Ignore build output
  { ignores: ['dist/**'] },

  // TypeScript-ESLint recommended: covers type safety + common TS pitfalls
  ...tseslint.configs.recommended,

  {
    rules: {
      // Intentional `any` casts exist in handler dispatch (tool-manifest → index.ts)
      // and Claude API response handling — warn instead of blocking.
      '@typescript-eslint/no-explicit-any': 'warn',

      // Unused variables are a real signal; allow leading-underscore for
      // intentionally ignored params (e.g. catch bindings).
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],

      // require() is used by tsx in a CommonJS project — not a problem.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
