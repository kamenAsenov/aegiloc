import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'node_modules/',
      'dist/',
      'package-tests/',
      'playwright-report/',
      'test-results/',
      'blob-report/',
      'coverage/',
    ],
  },
  {
    files: ['*.ts', 'src/**/*.ts', 'tests/**/*.ts'],
    extends: [eslint.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['examples/basic-playwright/**/*.ts'],
    extends: [eslint.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        project: './examples/basic-playwright/tsconfig.eslint.json',
        projectService: false,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['**/*.mjs'],
    extends: [eslint.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['fixtures/**/*.js'],
    extends: [eslint.configs.recommended],
    languageOptions: {
      globals: globals.browser,
    },
  },
);
