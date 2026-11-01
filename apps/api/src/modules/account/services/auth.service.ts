import { randomUUID } from 'node:crypto'

import {
  API_ERROR_CODE,
  type LoginRequest,
  type RegisterRequest,
  type UserDto,
} from '@repo/contracts'
import { Injectable, Logger } from '@nestjs/common'

import { appConfig } from '../../../config/app.config.js'
import { ApplicationError } from '../../../errors/application-error.js'
import {
  hashOpaqueToken,
  hashPassword,
  randomOpaqueToken,
  runDummyPasswordDerivation,
  verifyPassword,
} from '../security/auth.crypto.js'
import { AuthRepository } from '../repositories/auth.repository.js'
import { RedisSessionRepository } from '../repositories/redis-session.repository.js'

export type AuthPrincipal = {
  sessionTokenHash: string
  csrfTokenHash: string
  user: UserDto
}

export type CreatedSession = AuthPrincipal & {
  sessionToken: string
  csrfToken: string
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name)

  constructor(
    private readonly repository: AuthRepository,
    private readonly sessions: RedisSessionRepository,
  ) {}

  async register(input: RegisterRequest): Promise<CreatedSession> {
    const now = new Date()
    const user = {
      id: randomUUID(),
      email: input.email,
      passwordHash: await hashPassword(input.password),
      createdAt: now,
    }
    // Create the inaccessible session *before* the PG insert: if Redis is down,
    // no account is committed. Session cookie is only issued after PG succeeds.
    const session = await this.createSession(user)
    try {
      const created = await this.repository.createUser(user)
      if (!created) {
        throw new ApplicationError(
          'conflict',
          API_ERROR_CODE.EmailAlreadyExists,
          'Email already exists',
          { numericCode: 10002 },
        )
      }
      return { ...session, user: this.userDto(created) }
    } catch (error) {
      // A failed PG insert may leave an undisclosed, short-lived Redis key.
      // It is unusable because every request checks the user in PostgreSQL.
      try {
        await this.sessions.revokeSession(session.sessionTokenHash)
      } catch (cleanupError) {
        this.logger.warn(
          'Could not clean up a registration session after user creation failed: ' +
            (cleanupError instanceof Error ? cleanupError.name : 'unknown'),
        )
      }
      throw error
    }
  }

  async login(input: LoginRequest): Promise<CreatedSession> {
    const user = await this.repository.findUserByEmail(input.email)
    if (!user) {
      await runDummyPasswordDerivation(input.password)
      throw this.invalidCredentials()
    }
    const valid = await verifyPassword(input.password, user.passwordHash)
    if (!valid || !user.isActive) throw this.invalidCredentials()
    return this.createSession(user)
  }

  async authenticate(sessionToken: string): Promise<AuthPrincipal> {
    const tokenHash = hashOpaqueToken(sessionToken)
    const session = await this.sessions.findByTokenHash(tokenHash)
    if (!session) throw this.unauthenticated()
    const user = await this.repository.findActiveUserById(session.userId)
    if (!user) throw this.unauthenticated()
    return {
      sessionTokenHash: tokenHash,
      csrfTokenHash: session.csrfTokenHash,
      user: this.userDto(user),
    }
  }

  verifyCsrfToken(principal: AuthPrincipal, csrfToken: string | undefined): void {
    if (!csrfToken || hashOpaqueToken(csrfToken) !== principal.csrfTokenHash) {
      throw new ApplicationError(
        'forbidden',
        API_ERROR_CODE.InvalidCsrfToken,
        'Invalid CSRF token',
        { numericCode: 10004 },
      )
    }
  }

  async logout(tokenHash: string): Promise<void> {
    await this.sessions.revokeSession(tokenHash)
  }

  private async createSession(user: {
    id: string
    email: string
    createdAt: Date
  }): Promise<CreatedSession> {
    const sessionToken = randomOpaqueToken()
    const csrfToken = randomOpaqueToken()
    const sessionTokenHash = hashOpaqueToken(sessionToken)
    const csrfTokenHash = hashOpaqueToken(csrfToken)
    await this.sessions.createSession(
      sessionTokenHash,
      {
        userId: user.id,
        csrfTokenHash,
      },
      appConfig.sessionTtlMs,
    )

    return {
      sessionTokenHash,
      sessionToken,
      csrfToken,
      csrfTokenHash,
      user: this.userDto(user),
    }
  }

  private userDto(user: { id: string; email: string; createdAt: Date }): UserDto {
    return { id: user.id, email: user.email, createdAt: user.createdAt.toISOString() }
  }

  private unauthenticated(): ApplicationError {
    return new ApplicationError(
      'unauthenticated',
      API_ERROR_CODE.Unauthenticated,
      'Authentication required',
      { numericCode: 10003 },
    )
  }

  private invalidCredentials(): ApplicationError {
    return new ApplicationError(
      'unauthenticated',
      API_ERROR_CODE.InvalidCredentials,
      'Email or password is invalid',
      { numericCode: 10001 },
    )
  }
}
