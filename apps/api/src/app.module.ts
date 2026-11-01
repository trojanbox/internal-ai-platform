import { Module } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'

import { ApiExceptionFilter } from './http/api-exception.filter.js'
import { AccountModule } from './modules/account/account.module.js'
import { CatalogModule } from './modules/catalog/catalog.module.js'
import { InfrastructureModule } from './modules/infrastructure/infrastructure.module.js'

@Module({
  imports: [InfrastructureModule, AccountModule, CatalogModule],
  providers: [{ provide: APP_FILTER, useClass: ApiExceptionFilter }],
})
export class AppModule {}
