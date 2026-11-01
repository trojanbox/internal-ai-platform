import { Controller, Get, ServiceUnavailableException } from '@nestjs/common'

import { success } from '../../../http/api-response.js'
import { Public } from '../../../http/public.decorator.js'
import { DatabaseService } from '../database/database.service.js'
import { RedisService } from '../redis/redis.service.js'

@Controller()
export class HealthController {
  constructor(
    private readonly database: DatabaseService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get('health')
  health() {
    return success({ status: 'ok' })
  }

  @Public()
  @Get('ready')
  async ready() {
    if (!(await this.database.ready()) || !(await this.redis.ready())) {
      throw new ServiceUnavailableException('Persistence services are not ready')
    }
    return success({ status: 'ready' })
  }
}
