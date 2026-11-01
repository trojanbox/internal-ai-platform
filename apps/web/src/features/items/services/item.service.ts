import type {
  ApiListData,
  ItemDetailDto,
  ItemDetailResponse,
  ItemListItemDto,
  ItemListResponse,
  ItemListQuery,
} from '@repo/contracts'
import { ApiClient } from '../../../infrastructure/http/api.client'

export class ItemService {
  protected constructor() {}

  static async list(
    input: ItemListQuery = { currentPage: 1, pageSize: 20 },
    options?: { signal?: AbortSignal },
  ): Promise<ApiListData<ItemListItemDto>> {
    const query = new URLSearchParams({
      currentPage: String(input.currentPage),
      pageSize: String(input.pageSize),
    })
    const response = await ApiClient.get<ItemListResponse>('/items?' + query, options)
    return response.data
  }

  static async detail(itemId: string, options?: { signal?: AbortSignal }): Promise<ItemDetailDto> {
    const response = await ApiClient.get<ItemDetailResponse>(
      '/items/' + encodeURIComponent(itemId),
      options,
    )
    return response.data
  }
}
