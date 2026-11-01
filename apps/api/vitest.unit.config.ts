import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  test: {
    environment: 'node',
    include: ['apps/api/src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: './apps/api/coverage/unit',
      include: ['apps/api/src/**/*.ts'],
      exclude: ['apps/api/src/**/*.test.ts'],
    },
  },
})
