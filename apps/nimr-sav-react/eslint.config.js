import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'

/**
 * ESLint flat config (ESLint 9+)
 * Replaces legacy .eslintrc.cjs
 *
 * NIMR SAV v24 — React TypeScript
 */
export default tseslint.config(
  // Ignore build output and node_modules
  { ignores: ['dist', 'node_modules'] },

  // JS recommended base
  js.configs.recommended,

  // TypeScript strict rules
  ...tseslint.configs.recommended,

  // React + browser globals
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // React hooks
      ...reactHooks.configs.recommended.rules,

      // React refresh — allow constant exports in addition to components
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],

      // TypeScript strict
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],

      // Console discipline
      'no-console': ['warn', { allow: ['error', 'warn'] }],
    },
  }
)
