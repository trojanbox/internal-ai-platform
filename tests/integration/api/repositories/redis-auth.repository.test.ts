import { randomUUID } from 'node:crypto'

import { Test, type TestingModule } from '@nestjs/testing'
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'

import { AuthRateLimitRepository } from '../../../../apps/api/src/modules/account/repositories/auth-rate-limit.repository.js'
import { RedisSessionRepository } from '../../../../apps/api/src/modules/account/repositories/redis-session.repository.js'
import { RedisService } from '../../../../apps/api/src/modules/infrastructure/redis/redis.service.js'
import { InfrastructureModule } from '../../../../apps/api/src/modules/infrastructure/infrastructure.module.js'

describe('Redis session and rate limits', () => {
  let moduleRef: TestingModule
  let redis: RedisService
  let sessions: RedisSessionRepository
  let limits: AuthRateLimitRepository

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [InfrastructureModule],
      providers: [RedisSessionRepository, AuthRateLimitRepository],
    }).compile()
    await moduleRef.init()
    redis = moduleRef.get(RedisService)
    sessions = moduleRef.get(RedisSessionRepository)
    limits = moduleRef.get(AuthRateLimitRepository)
  })

  afterAll(async () => {
    await moduleRef.close()
  })

  it('creates hashed-token sessions with Redis TTL and revokes immediately', async () => {
    const hash = randomUUID()
    const session = {
      userId: randomUUID(),
      csrfTokenHash: randomUUID(),
    }
    await sessions.createSession(hash, session, 30_000)
    expect(await sessions.findByTokenHash(hash)).toEqual(session)
    const ttl = await redis.client.pTTL('auth:session:' + hash)
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(30_000)
    await sessions.revokeSession(hash)
    expect(await sessions.findByTokenHash(hash)).toBeUndefined()
  })

  it('expires sessions without a cleanup job and refuses malformed sessions', async () => {
    const hash = randomUUID()
    await sessions.createSession(
      hash,
      {
        userId: randomUUID(),
        csrfTokenHash: randomUUID(),
      },
      20_000,
    )
    await redis.client.pExpire('auth:session:' + hash, 1)
    await vi.waitFor(async () => {
      expect(await sessions.findByTokenHash(hash)).toBeUndefined()
    })
    await redis.client.set('auth:session:' + hash, 'invalid-json', { PX: 10_000 })
    expect(await sessions.findByTokenHash(hash)).toBeUndefined()
    await redis.client.del('auth:session:' + hash)
  })

  it('counts parallel requests atomically and applies a fixed-window TTL', async () => {
    const hash = randomUUID()
    const results = await Promise.all(
      Array.from({ length: 20 }, () => limits.consume(hash, 60_000)),
    )
    expect(results.map((r) => r.attempts).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    )
    expect(await redis.client.pTTL('auth:limit:' + hash)).toBeGreaterThan(0)
    await redis.client.pExpire('auth:limit:' + hash, 1)
    await vi.waitFor(async () => {
      expect(await redis.client.exists('auth:limit:' + hash)).toBe(0)
    })
    expect((await limits.consume(hash, 60_000)).attempts).toBe(1)
    await redis.client.del('auth:limit:' + hash)
  })
})
