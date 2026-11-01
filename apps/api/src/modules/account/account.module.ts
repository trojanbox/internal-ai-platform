import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'

import { InfrastructureModule } from '../infrastructure/infrastructure.module.js'
import { AuthController } from './controllers/auth.controller.js'
import { SessionAuthGuard } from './guards/session-auth.guard.js'
import { AuthRepository } from './repositories/auth.repository.js'
import { RedisSessionRepository } from './repositories/redis-session.repository.js'
import { AuthRateLimitRepository } from './repositories/auth-rate-limit.repository.js'
import { AuthRateLimitService } from './services/auth-rate-limit.service.js'
import { AuthService } from './services/auth.service.js'

@Module({
  imports: [InfrastructureModule],
  controllers: [AuthController],
  providers: [
    AuthRepository,
    RedisSessionRepository,
    AuthService,
    AuthRateLimitRepository,
    AuthRateLimitService,
    { provide: APP_GUARD, useClass: SessionAuthGuard },
  ],
})
export class AccountModule {}
