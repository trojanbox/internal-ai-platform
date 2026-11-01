import { randomUUID } from 'node:crypto'

export function uniqueEmail(prefix = 'e2e'): string {
  return `${prefix}-${randomUUID()}@example.com`
}

export const strongPassword = 'a-strong-e2e-password'
