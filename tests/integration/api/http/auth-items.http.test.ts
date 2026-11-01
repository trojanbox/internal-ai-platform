import { randomUUID } from 'node:crypto'

import { type INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DatabaseService } from '../../../../apps/api/src/modules/infrastructure/database/database.service.js'
import { eq, sql } from 'drizzle-orm'
import { vi } from 'vitest'
import { AuthRepository } from '../../../../apps/api/src/modules/account/repositories/auth.repository.js'
import { AuthService } from '../../../../apps/api/src/modules/account/services/auth.service.js'
import { RedisSessionRepository } from '../../../../apps/api/src/modules/account/repositories/redis-session.repository.js'
import { AuthRateLimitRepository } from '../../../../apps/api/src/modules/account/repositories/auth-rate-limit.repository.js'
import { RedisService } from '../../../../apps/api/src/modules/infrastructure/redis/redis.service.js'
import { users } from '../../../../apps/api/src/modules/infrastructure/database/schema/auth.schema.js'
import { items } from '../../../../apps/api/src/modules/infrastructure/database/schema/item.schema.js'
import { cookieValue } from '../../../support/api/cookies.js'
import { createTestApp } from '../../../support/api/test-app.js'

describe('HTTP integration', () => {
  let app: INestApplication

  beforeEach(async () => {
    app = await createTestApp()
    const database = app.get(DatabaseService)
    await app.get(RedisService).client.flushDb()
    await database.db.delete(items)
    await database.db.insert(items).values({
      id: '11111111-1111-4111-8111-111111111111',
      title: 'HTTP integration item',
      summary: 'Summary',
      content: 'Content',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })
  })

  afterEach(async () => {
    await app.close()
  })

  it('covers register → session → list → detail → logout with real HTTP pipeline', async () => {
    const agent = request.agent(app.getHttpServer())
    const email = `integration-${randomUUID()}@example.com`

    const register = await agent
      .post('/api/v1/auth/register')
      .send({ email, password: 'a-strong-integration-password' })
      .expect(201)

    expect(register.body.code).toBe(0)
    const csrf = cookieValue(register.headers['set-cookie'], 'csrf_token')
    if (!csrf) {
      throw new Error('CSRF cookie missing after registration')
    }

    await agent
      .get('/api/v1/auth/session')
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.user.email).toBe(email)
      })

    await agent
      .get('/api/v1/items')
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.list).toHaveLength(1)
        expect(body.data.page.totalRows).toBe(1)
      })

    await agent
      .get('/api/v1/items/11111111-1111-4111-8111-111111111111')
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.title).toBe('HTTP integration item')
      })

    await agent.post('/api/v1/auth/logout').set('X-CSRF-Token', csrf).expect(200)

    await agent.get('/api/v1/auth/session').expect(401)
  })

  it('keeps health public while protected resources default to authenticated', async () => {
    await request(app.getHttpServer()).get('/api/v1/health').expect(200)
    await request(app.getHttpServer()).get('/api/v1/ready').expect(200)
    await request(app.getHttpServer()).get('/api/v1/items').expect(401)
  })

  it('returns the shared validation envelope for invalid input', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: 'invalid', password: 'short' })
      .expect(400)
      .expect(({ body }) => {
        expect(body.error.code).toBe('VALIDATION_ERROR')
      })
  })

  it('rejects sessions and sign-in for a soft-deleted account', async () => {
    const agent = request.agent(app.getHttpServer())
    const email = 'deleted-' + randomUUID() + '@example.com'
    await agent
      .post('/api/v1/auth/register')
      .send({ email, password: 'a-strong-integration-password' })
      .expect(201)

    const database = app.get(DatabaseService)
    await database.db.update(users).set({ deletedAt: new Date() }).where(eq(users.email, email))
    await agent.get('/api/v1/auth/session').expect(401)
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'a-strong-integration-password' })
      .expect(401)
  })
  it('does not create a user if Redis session creation fails', async () => {
    const sessions = app.get(RedisSessionRepository)
    const auth = app.get(AuthService)
    const email = 'atomic-' + randomUUID() + '@example.com'
    const spy = vi
      .spyOn(sessions, 'createSession')
      .mockRejectedValueOnce(new Error('Redis unavailable'))
    try {
      await expect(
        auth.register({ email, password: 'a-strong-integration-password' }),
      ).rejects.toThrow('Redis unavailable')
      expect(await app.get(AuthRepository).findUserByEmail(email)).toBeUndefined()
    } finally {
      spy.mockRestore()
    }
  })

  it('cleans up undisclosed Redis session if PostgreSQL rejects registration', async () => {
    const sessions = app.get(RedisSessionRepository)
    const users = app.get(AuthRepository)
    const auth = app.get(AuthService)
    const email = 'duplicate-' + randomUUID() + '@example.com'
    await auth.register({ email, password: 'a-strong-integration-password' })
    const createSpy = vi.spyOn(sessions, 'createSession')
    const deleteSpy = vi.spyOn(sessions, 'revokeSession')
    try {
      await expect(
        auth.register({ email, password: 'a-strong-integration-password' }),
      ).rejects.toMatchObject({ code: 'EMAIL_ALREADY_EXISTS' })
      expect(createSpy).toHaveBeenCalledOnce()
      expect(deleteSpy).toHaveBeenCalledOnce()
      const tokenHash = deleteSpy.mock.calls[0]![0]
      expect(await sessions.findByTokenHash(tokenHash)).toBeUndefined()
      expect(await users.findUserByEmail(email)).toBeDefined()
    } finally {
      createSpy.mockRestore()
      deleteSpy.mockRestore()
    }
  })

  it('limits excessive registration attempts using a shared Redis window', async () => {
    const agent = request.agent(app.getHttpServer())
    for (let i = 0; i < 6; i++) {
      await agent
        .post('/api/v1/auth/register')
        .send({
          email: 'throttle-' + randomUUID() + '@example.com',
          password: 'a-strong-integration-password',
        })
        .expect(201)
    }
    await agent
      .post('/api/v1/auth/register')
      .send({
        email: 'blocked-' + randomUUID() + '@example.com',
        password: 'a-strong-integration-password',
      })
      .expect(429)
      .expect(({ body, headers }) => {
        expect(body.error.code).toBe('RATE_LIMITED')
        expect(Number(headers['retry-after'])).toBeGreaterThan(0)
      })
  })

  it('returns a request ID on both success and known error responses', async () => {
    const ok = await request(app.getHttpServer()).get('/api/v1/health').expect(200)
    const bad = await request(app.getHttpServer()).get('/api/v1/items').expect(401)
    expect(ok.headers['x-request-id']).toMatch(/^[a-zA-Z0-9_-]{8,64}$/)
    expect(bad.headers['x-request-id']).toMatch(/^[a-zA-Z0-9_-]{8,64}$/)
    const spoofed = await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('X-Request-Id', 'attacker-chosen-request-id')
      .expect(200)
    expect(spoofed.headers['x-request-id']).not.toBe('attacker-chosen-request-id')
  })
  it('automatically records the trusted user on an authenticated item write', async () => {
    const agent = request.agent(app.getHttpServer())
    const register = await agent
      .post('/api/v1/auth/register')
      .send({
        email: 'owner-' + randomUUID() + '@example.com',
        password: 'a-strong-integration-password',
      })
      .expect(201)
    const csrf = cookieValue(register.headers['set-cookie'], 'csrf_token')
    expect(csrf).toBeTruthy()
    const created = await agent
      .post('/api/v1/items')
      .set('X-CSRF-Token', csrf!)
      .send({ title: 'Audit item', summary: 'Owner', content: 'Content' })
      .expect(201)
    const database = app.get(DatabaseService)
    const [persisted] = await database.db
      .select()
      .from(items)
      .where(eq(items.id, created.body.data.id as string))
    expect(persisted?.createdBy).toBe(register.body.data.user.id)
    expect(persisted?.updatedBy).toBe(register.body.data.user.id)
    await agent
      .post('/api/v1/items')
      .send({ title: 'Forgery', summary: 'No CSRF', content: 'Blocked' })
      .expect(403)
  })
  it('reports not-ready when the applied migration checksum diverges', async () => {
    const database = app.get(DatabaseService)
    const migration = await database.db.execute(
      sql.raw(
        'SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at LIMIT 1',
      ),
    )
    const row = migration.rows[0] as { hash: string; created_at: string } | undefined
    if (!row) throw new Error('Expected migration ledger is missing')
    try {
      await database.db.execute(
        sql`UPDATE drizzle.__drizzle_migrations SET hash = 'invalid' WHERE created_at = ${row.created_at}`,
      )
      await request(app.getHttpServer()).get('/api/v1/ready').expect(503)
    } finally {
      await database.db.execute(
        sql`UPDATE drizzle.__drizzle_migrations SET hash = ${row.hash} WHERE created_at = ${row.created_at}`,
      )
    }
    await request(app.getHttpServer()).get('/api/v1/ready').expect(200)
  })
  it('fails readiness when Redis is unavailable', async () => {
    const redis = app.get(RedisService)
    const spy = vi.spyOn(redis, 'ready').mockResolvedValueOnce(false)
    try {
      await request(app.getHttpServer()).get('/api/v1/ready').expect(503)
      await request(app.getHttpServer()).get('/api/v1/health').expect(200)
    } finally {
      spy.mockRestore()
    }
  })

  it('does not retain Session and Rate Limit tables in PostgreSQL', async () => {
    const database = app.get(DatabaseService)
    const result = await database.db.execute(
      sql.raw(
        "SELECT to_regclass('public.auth_sessions') AS session_table, " +
          "to_regclass('public.auth_rate_limits') AS limits_table",
      ),
    )
    expect(result.rows[0]).toMatchObject({ session_table: null, limits_table: null })
  })

  it('fails closed when Redis rate limiting cannot run', async () => {
    const rateLimits = app.get(AuthRateLimitRepository)
    const users = app.get(AuthRepository)
    const email = 'denied-' + randomUUID() + '@example.com'
    const spy = vi
      .spyOn(rateLimits, 'consume')
      .mockRejectedValueOnce(new Error('Redis unavailable'))
    try {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: 'a-strong-integration-password' })
        .expect(500)
      expect(await users.findUserByEmail(email)).toBeUndefined()
    } finally {
      spy.mockRestore()
    }
  })
})
