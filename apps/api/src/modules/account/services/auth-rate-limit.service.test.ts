import { Test } from '@nestjs/testing'
import { describe, expect, it, vi } from 'vitest'

import { AuthRateLimitRepository } from '../repositories/auth-rate-limit.repository.js'
import { AuthRateLimitService } from './auth-rate-limit.service.js'

describe('AuthRateLimitService', () => {
  it('rejects excessive requests with retry time while hashing the IP', async () => {
    const consume = vi.fn().mockResolvedValue({
      attempts: 7,
      retryAfterMs: 30_000,
    })
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthRateLimitService,
        { provide: AuthRateLimitRepository, useValue: { consume } },
      ],
    }).compile()
    try {
      const service = moduleRef.get(AuthRateLimitService)
      await expect(service.assertAllowed('register', '192.0.2.1')).rejects.toMatchObject({
        category: 'rate_limited',
        options: { retryAfterSeconds: expect.any(Number) },
      })
      const key = consume.mock.calls[0]?.[0] as string
      expect(key).toMatch(/^[a-f0-9]{64}$/)
      expect(key).not.toContain('192.0.2.1')
    } finally {
      await moduleRef.close()
    }
  })
})
