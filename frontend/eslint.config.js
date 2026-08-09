import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import react from 'eslint-plugin-react'
import tseslint from 'typescript-eslint'
import { globalIgnores } from 'eslint/config'

// Unused values prefixed with _ are intentional (e.g. destructuring a field out
// of an object). Unused catch bindings are allowed the same way.
const unusedVarsRule = [
  'error',
  {
    argsIgnorePattern: '^_',
    varsIgnorePattern: '^_',
    caughtErrorsIgnorePattern: '^_|^err(or)?$',
    destructuredArrayIgnorePattern: '^_',
  },
]

export default tseslint.config([
  globalIgnores(['dist', 'dev-dist', 'coverage']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': unusedVarsRule,
    },
  },
  {
    // The .jsx pages were previously excluded from linting entirely.
    files: ['**/*.{js,jsx}'],
    extends: [js.configs.recommended, reactHooks.configs['recommended-latest']],
    plugins: { react },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': unusedVarsRule,
      // Without these, identifiers used only inside JSX read as unused.
      'react/jsx-uses-react': 'error',
      'react/jsx-uses-vars': 'error',
    },
  },
  {
    files: ['**/*.test.{ts,tsx,js,jsx}', 'src/setupTests.ts'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    files: ['eslint.config.js', 'vite.config.ts'],
    languageOptions: { globals: globals.node },
  },
])
