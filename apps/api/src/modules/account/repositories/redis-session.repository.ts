import { Injectable } from '@nestjs/common'
import { z } from 'zod'

import { RedisService } from '../../infrastructure/redis/redis.service.js'

const sessionSchema = z.object({
  userId: z.string().uuid(),
  csrfTokenHash: z.string().min(1),
})

export type StoredSession = z.infer<typeof sessionSchema>

@Injectable()
export class RedisSessionRepository {
  constructor(private readonly redis: RedisService) {}

  private key(tokenHash: string): string {
    return 'auth:session:' + tokenHash
  }

  async createSession(tokenHash: string, session: StoredSession, ttlMs: number): Promise<void> {
    const result = await this.redis.client.set(this.key(tokenHash), JSON.stringify(session), {
      PX: ttlMs,
      NX: true,
    })
    if (result !== 'OK') throw new Error('Session token collision')
  }

  async findByTokenHash(tokenHash: string): Promise<StoredSession | undefined> {
    const value = await this.redis.client.get(this.key(tokenHash))
    if (!value) return undefined
    try {
      const parsed = sessionSchema.safeParse(JSON.parse(value))
      return parsed.success ? parsed.data : undefined
    } catch {
      return undefined
    }
  }

  async revokeSession(tokenHash: string): Promise<void> {
    await this.redis.client.del(this.key(tokenHash))
  }
}
