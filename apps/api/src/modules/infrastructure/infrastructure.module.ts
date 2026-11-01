import { Module } from '@nestjs/common'

import { HealthController } from './controllers/health.controller.js'
import { DatabaseService } from './database/database.service.js'
import { RedisService } from './redis/redis.service.js'

@Module({
  controllers: [HealthController],
  providers: [DatabaseService, RedisService],
  exports: [DatabaseService, RedisService],
})
export class InfrastructureModule {}
