import { createRequire } from 'module'
import importPlugin from 'eslint-plugin-import-x'

const require = createRequire(import.meta.url)

const coreWebVitals = require('eslint-config-next/core-web-vitals')
const typescript = require('eslint-config-next/typescript')
const reactHooks = require('eslint-plugin-react-hooks')

const eslintConfig = [
  ...coreWebVitals,
  ...typescript,
  {
    ignores: [
      '.claude/**',
      '.next/**',
      'coverage/**',
      'dist/**',
      'docs/**',
      'node_modules/**',
      'out/**',
      'public/**',
      'scripts/**',
      'tmp/**',
    ],
  },
  {
    plugins: {
      'react-hooks': reactHooks,
      'import-x': importPlugin,
    },
    rules: {
      'no-console': 'warn',
      'prefer-const': 'error',
      '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports' }],
      '@typescript-eslint/no-explicit-any': 'error',
      // Circular dependency detection — catches import cycles before they ship.
      // maxDepth: 3 limits traversal depth to keep lint fast (~2s overhead).
      'import-x/no-cycle': ['error', { maxDepth: 3 }],
      // React 19 experimental rules — downgrade from error (eslint-config-next default)
      // to warn. These flag legitimate patterns: setState in effects for browser-API
      // synchronization, "latest ref" pattern, and Date.now() in render paths.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/purity': 'warn',
    },
  },
]

export default eslintConfig
