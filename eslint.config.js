import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import svelteParser from 'svelte-eslint-parser';
import prettier from 'eslint-config-prettier';

/**
 * Flat ESLint config for the AgroBot 2.0 workspace.
 *
 * `legacy/` is AgroBot 1.0 and is excluded from every tool (ADR-0008).
 */
export default tseslint.config(
  {
    ignores: [
      'legacy/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.svelte-kit/**',
      'apps/server/src/db/migrations/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'error',
    },
  },

  // The domain layer must stay free of HTTP, Telegram and integration code (ARCH §2).
  {
    files: ['apps/server/src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/http/**', '**/bot/**', '**/integrations/**', 'hono*', 'grammy*'],
              message:
                'domain/ receives ports as parameters; it must not import HTTP, bot or integration code (ARCH §2).',
            },
          ],
        },
      ],
    },
  },

  // Scripts, seeds and config talk to the terminal on purpose.
  {
    files: [
      'scripts/**/*.{js,mjs,ts}',
      '*/*/scripts/**/*.{js,mjs,ts}',
      '**/*.config.{js,mjs,ts}',
      'apps/server/src/db/seed.ts',
      'apps/server/src/db/migrate.ts',
    ],
    rules: { 'no-console': 'off' },
  },

  ...svelte.configs.recommended,
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parser: svelteParser,
      parserOptions: { parser: tseslint.parser },
      globals: { ...globals.browser },
    },
  },
  {
    files: ['apps/miniapp/**/*.{ts,svelte}'],
    languageOptions: { globals: { ...globals.browser } },
  },

  prettier,
  ...svelte.configs.prettier,
);
