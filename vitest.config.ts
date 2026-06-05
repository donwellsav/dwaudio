import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
    },
  },
  test: {
    include: [
      'lib/**/__tests__/**/*.test.ts',
      'tests/**/*.test.ts',
      'hooks/__tests__/**/*.test.ts',
      'contexts/__tests__/**/*.test.ts',
      'app/**/__tests__/**/*.test.ts',
      'components/**/__tests__/**/*.test.{ts,tsx}',
    ],
    environment: 'node',
    environmentOptions: {
      jsdom: {
        url: 'http://localhost/',
      },
    },
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'lib/dsp/**/*.ts',
        'lib/canvas/**/*.ts',
        'lib/storage/**/*.ts',
        'hooks/**/*.ts',
        'contexts/**/*.ts',
      ],
      exclude: [
        '**/__tests__/**',
        'lib/dsp/dspWorker.ts',
        'contexts/PortalContainerContext.tsx',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
      },
    },
  },
})
