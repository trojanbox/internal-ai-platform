import { describe, expect, it } from 'vitest'

import { registerRequestSchema } from './authentication.contract.js'

describe('authentication contract', () => {
  it('normalizes register email at the serialized boundary', () => {
    expect(
      registerRequestSchema.parse({
        email: '  USER@Example.COM ',
        password: 'a-strong-password',
      }),
    ).toEqual({
      email: 'user@example.com',
      password: 'a-strong-password',
    })
  })
})
