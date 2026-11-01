import { Test } from '@nestjs/testing'
import { describe, expect, it } from 'vitest'

import { AppModule } from '../../../apps/api/src/app.module.js'
import { AuthService } from '../../../apps/api/src/modules/account/services/auth.service.js'
import { ItemsService } from '../../../apps/api/src/modules/catalog/services/items.service.js'
import { DatabaseService } from '../../../apps/api/src/modules/infrastructure/database/database.service.js'
import { RedisService } from '../../../apps/api/src/modules/infrastructure/redis/redis.service.js'

describe('AppModule wiring', () => {
  it('compiles the real module graph and resolves core providers', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()

    await moduleRef.init()
    try {
      expect(moduleRef.get(AuthService, { strict: false })).toBeInstanceOf(AuthService)
      expect(moduleRef.get(ItemsService, { strict: false })).toBeInstanceOf(ItemsService)
      expect(await moduleRef.get(DatabaseService, { strict: false }).ready()).toBe(true)
      expect(await moduleRef.get(RedisService, { strict: false }).ready()).toBe(true)
    } finally {
      await moduleRef.close()
    }
  })
})
