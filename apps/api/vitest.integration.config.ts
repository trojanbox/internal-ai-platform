import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  test: {
    environment: 'node',
    include: ['tests/integration/api/**/*.test.ts'],
    globalSetup: ['./tests/support/api/global-setup.ts'],
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: './apps/api/coverage/integration',
      include: ['apps/api/src/**/*.ts'],
      exclude: ['apps/api/src/**/*.test.ts'],
    },
  },
})
