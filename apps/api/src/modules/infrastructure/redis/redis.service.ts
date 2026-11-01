import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { createClient } from 'redis'

import { requiredRedisUrl } from '../../../config/app.config.js'

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name)
  readonly client = createClient({
    url: requiredRedisUrl(),
    socket: {
      connectTimeout: 3000,
      reconnectStrategy: (retries) => (retries >= 3 ? false : (retries + 1) * 100),
    },
  })

  constructor() {
    this.client.on('error', (error) => {
      // Redis error messages may include connection URLs: never log credentials.
      this.logger.error('Redis connection failed: ' + error.name)
    })
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect()
  }

  async ready(): Promise<boolean> {
    try {
      return this.client.isReady && (await this.client.ping()) === 'PONG'
    } catch {
      return false
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.isOpen) this.client.destroy()
  }
}
