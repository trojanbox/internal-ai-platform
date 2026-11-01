import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export default function globalSetup() {
  const apiRoot = fileURLToPath(new URL('../../../apps/api/', import.meta.url))
  execFileSync('pnpm', ['db:test:reset'], {
    cwd: apiRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DB_TEST_KIND: 'integration',
    },
    stdio: 'inherit',
  })
}
