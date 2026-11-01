import { z } from 'zod'

import type { ApiListData, ApiSuccess } from '../common/api.contract.js'

export const itemIdSchema = z.string().uuid()

export const itemListQuerySchema = z.object({
  currentPage: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export const itemListItemSchema = z.object({
  id: itemIdSchema,
  title: z.string(),
  summary: z.string(),
  createdAt: z.string().datetime(),
})

export const itemDetailSchema = itemListItemSchema.extend({
  content: z.string(),
})

export type ItemListQuery = z.infer<typeof itemListQuerySchema>
export type ItemListItemDto = z.infer<typeof itemListItemSchema>
export type ItemDetailDto = z.infer<typeof itemDetailSchema>
export type ItemListResponse = ApiSuccess<ApiListData<ItemListItemDto>>
export type ItemDetailResponse = ApiSuccess<ItemDetailDto>

export const createItemRequestSchema = z.object({
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(1000),
  content: z.string().trim().min(1).max(20000),
})
export type CreateItemRequest = z.infer<typeof createItemRequestSchema>
