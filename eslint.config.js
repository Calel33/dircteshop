import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import nextPlugin from '@next/eslint-plugin-next';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      '@next/next': nextPlugin,
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
        ecmaVersion: 2020,
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        React: 'readonly',
      },
    },
    rules: {
      'complexity': ['warn', 10],
      'max-lines': ['warn', { max: 500, skipBlankLines: true, skipComments: true }],
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'default',
          format: ['camelCase'],
          leadingUnderscore: 'allow',
          trailingUnderscore: 'allow',
        },
        {
          selector: 'variable',
          format: ['camelCase', 'UPPER_CASE', 'PascalCase'],
          leadingUnderscore: 'allow',
          trailingUnderscore: 'allow',
        },
        {
          selector: 'typeLike',
          format: ['PascalCase'],
        },
        {
          selector: 'enumMember',
          format: ['UPPER_CASE'],
        },
        {
          selector: 'function',
          format: ['camelCase', 'PascalCase'],
        },
        {
          selector: 'parameter',
          format: ['camelCase'],
          leadingUnderscore: 'allow',
        },
        {
          selector: 'import',
          format: ['camelCase', 'PascalCase'],
        },
        {
          // Object keys are often external identifiers: Convex validator field
          // names (serialized format), webhook headers, CSS custom properties,
          // and ESLint plugin/rule ids.
          selector: 'objectLiteralProperty',
          format: null,
        },
      ],
    },
  },
  {
    // Starter-template demo surfaces (see screens/SPEC.md): kept close to the
    // starter's upstream code and not maintained as product code.
    files: [
      'app/(landing)/**/*.{ts,tsx}',
      'app/dashboard/**/*.{ts,tsx}',
      'components/kokonutui/**/*.{ts,tsx}',
      'components/ui/**/*.{ts,tsx}',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'complexity': 'off',
      'max-lines': 'off',
    },
  },
  {
    // React Bits components are vendored third-party code (upstream uses
    // UPPER_CASE configuration presets and dense canvas loops).
    files: ['components/react-bits/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/naming-convention': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      'complexity': 'off',
      'max-lines': 'off',
      'no-useless-assignment': 'off',
      'prefer-const': 'off',
    },
  },
  {
    // Node-run scripts (executed directly with `node`).
    files: ['scripts/**/*.js'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
      },
    },
  },
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'dist/**',
      'build/**',
      'convex/_generated/**',
      'dircteshop/**',
      '.archon/**',
      '.firecrawl/**',
    ],
  }
);
