import {
  createItemRequestSchema,
  type CreateItemRequest,
  itemIdSchema,
  itemListQuerySchema,
  type ItemDetailResponse,
  type ItemListQuery,
  type ItemListResponse,
} from '@repo/contracts'
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'

import { success } from '../../../http/api-response.js'
import { ItemsService } from '../services/items.service.js'

@Controller('items')
export class ItemsController {
  constructor(private readonly itemsService: ItemsService) {}

  @Post()
  async create(
    @Body({ schema: createItemRequestSchema }) input: CreateItemRequest,
  ): Promise<ItemDetailResponse> {
    return success(await this.itemsService.create(input))
  }

  @Get()
  async list(
    @Query({ schema: itemListQuerySchema }) query: ItemListQuery,
  ): Promise<ItemListResponse> {
    return success(await this.itemsService.list(query))
  }

  @Get(':itemId')
  async detail(
    @Param('itemId', { schema: itemIdSchema }) itemId: string,
  ): Promise<ItemDetailResponse> {
    return success(await this.itemsService.detail(itemId))
  }
}
