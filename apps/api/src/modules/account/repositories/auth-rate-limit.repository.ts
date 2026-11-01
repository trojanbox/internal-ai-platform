import { Injectable } from '@nestjs/common'

import { RedisService } from '../../infrastructure/redis/redis.service.js'

// Redis executes the complete counter+expiration transition atomically across API replicas.
const WINDOW_COUNTER = [
  "local count = redis.call('INCR', KEYS[1])",
  "if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end",
  "local ttl = redis.call('PTTL', KEYS[1])",
  "if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end",
  'return {count, ttl}',
].join('\n')

@Injectable()
export class AuthRateLimitRepository {
  constructor(private readonly redis: RedisService) {}

  async consume(
    key: string,
    windowMs: number,
  ): Promise<{ attempts: number; retryAfterMs: number }> {
    const result = await this.redis.client.eval(WINDOW_COUNTER, {
      keys: ['auth:limit:' + key],
      arguments: [String(windowMs)],
    })
    if (!Array.isArray(result) || result.length !== 2) {
      throw new Error('Unexpected Redis rate-limit response')
    }
    const attempts = Number(result[0])
    const retryAfterMs = Number(result[1])
    if (
      !Number.isSafeInteger(attempts) ||
      !Number.isSafeInteger(retryAfterMs) ||
      retryAfterMs < 0
    ) {
      throw new Error('Invalid Redis rate-limit counter')
    }
    return { attempts, retryAfterMs }
  }
}
