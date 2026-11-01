import { Module } from '@nestjs/common'

import { InfrastructureModule } from '../infrastructure/infrastructure.module.js'
import { ItemsController } from './controllers/items.controller.js'
import { ItemsRepository } from './repositories/items.repository.js'
import { ItemsService } from './services/items.service.js'

@Module({
  imports: [InfrastructureModule],
  controllers: [ItemsController],
  providers: [ItemsRepository, ItemsService],
})
export class CatalogModule {}
