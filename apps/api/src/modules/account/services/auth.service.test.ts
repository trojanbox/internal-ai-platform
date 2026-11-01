import { Test } from '@nestjs/testing'
import { describe, expect, it, vi } from 'vitest'

import { ApplicationError } from '../../../errors/application-error.js'
import { AuthRepository } from '../repositories/auth.repository.js'
import { RedisSessionRepository } from '../repositories/redis-session.repository.js'
import { hashOpaqueToken } from '../security/auth.crypto.js'
import { AuthService, type AuthPrincipal } from './auth.service.js'

describe('AuthService', () => {
  it('authenticates Redis session only when the PostgreSQL user is active', async () => {
    const stored = {
      userId: '22222222-2222-4222-8222-222222222222',
      csrfTokenHash: hashOpaqueToken('csrf-token'),
    }
    const users = {
      findActiveUserById: vi.fn().mockResolvedValue({
        id: stored.userId,
        email: 'user@example.com',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    }
    const sessions = { findByTokenHash: vi.fn().mockResolvedValue(stored) }

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: AuthRepository, useValue: users },
        { provide: RedisSessionRepository, useValue: sessions },
      ],
    }).compile()
    try {
      const principal = await moduleRef.get(AuthService).authenticate('session-token')
      expect(sessions.findByTokenHash).toHaveBeenCalledWith(hashOpaqueToken('session-token'))
      expect(users.findActiveUserById).toHaveBeenCalledWith(stored.userId)
      expect(principal.user).toEqual({
        id: stored.userId,
        email: 'user@example.com',
        createdAt: '2026-01-01T00:00:00.000Z',
      })
      users.findActiveUserById.mockResolvedValue(undefined)
      await expect(moduleRef.get(AuthService).authenticate('session-token')).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      })
    } finally {
      await moduleRef.close()
    }
  })

  it('rejects an invalid CSRF token', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: AuthRepository, useValue: {} },
        { provide: RedisSessionRepository, useValue: {} },
      ],
    }).compile()
    try {
      const principal: AuthPrincipal = {
        sessionTokenHash: hashOpaqueToken('token'),
        csrfTokenHash: hashOpaqueToken('expected'),
        user: {
          id: '22222222-2222-4222-8222-222222222222',
          email: 'user@example.com',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      }
      expect(() => moduleRef.get(AuthService).verifyCsrfToken(principal, 'wrong')).toThrow(
        ApplicationError,
      )
    } finally {
      await moduleRef.close()
    }
  })

  it('never inserts a PostgreSQL user if saving a Redis session fails', async () => {
    const users = { createUser: vi.fn() }
    const sessions = { createSession: vi.fn().mockRejectedValue(new Error('Redis unavailable')) }
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: AuthRepository, useValue: users },
        { provide: RedisSessionRepository, useValue: sessions },
      ],
    }).compile()
    try {
      await expect(
        moduleRef.get(AuthService).register({
          email: 'new@example.com',
          password: 'a-long-strong-password',
        }),
      ).rejects.toThrow('Redis unavailable')
      expect(users.createUser).not.toHaveBeenCalled()
    } finally {
      await moduleRef.close()
    }
  })
})
