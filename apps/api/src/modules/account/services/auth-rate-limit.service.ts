import { createHash } from 'node:crypto'

import { Injectable } from '@nestjs/common'
import { API_ERROR_CODE } from '@repo/contracts'

import { ApplicationError } from '../../../errors/application-error.js'
import { AuthRateLimitRepository } from '../repositories/auth-rate-limit.repository.js'

const limits = {
  login: { attempts: 12, windowMs: 60_000 },
  register: { attempts: 6, windowMs: 60_000 },
} as const

@Injectable()
export class AuthRateLimitService {
  constructor(private readonly repository: AuthRateLimitRepository) {}

  async assertAllowed(action: keyof typeof limits, ip: string | undefined): Promise<void> {
    // Never accept X-Forwarded-For from the caller. Configure trusted proxies at the edge.
    const key = createHash('sha256')
      .update(action + ':' + (ip || 'unknown'))
      .digest('hex')
    const { attempts, retryAfterMs } = await this.repository.consume(key, limits[action].windowMs)
    if (attempts > limits[action].attempts) {
      throw new ApplicationError('rate_limited', API_ERROR_CODE.RateLimited, 'Too many requests', {
        numericCode: 429,
        retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
      })
    }
  }
}
