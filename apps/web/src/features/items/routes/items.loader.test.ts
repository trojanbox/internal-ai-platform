import { afterEach, describe, expect, it, vi } from 'vitest'

import { ItemService } from '../services/item.service'
import { itemsLoader } from './items.loader'

afterEach(() => vi.restoreAllMocks())

describe('Items pagination loader', () => {
  it('passes URL search parameters to the service with cancellation', async () => {
    const page = { list: [], page: { totalRows: 51, currentPage: 3, pageSize: 10 } }
    const spy = vi.spyOn(ItemService, 'list').mockResolvedValue(page)
    const request = new Request('http://localhost/items?currentPage=3&pageSize=10')
    expect(await itemsLoader({ request } as Parameters<typeof itemsLoader>[0])).toEqual({
      items: page,
    })
    expect(spy).toHaveBeenCalledWith({ currentPage: 3, pageSize: 10 }, { signal: request.signal })
  })
  it('rejects invalid page parameters', async () => {
    const spy = vi.spyOn(ItemService, 'list')
    const request = new Request('http://localhost/items?currentPage=-1&pageSize=10000')
    await expect(
      itemsLoader({ request } as Parameters<typeof itemsLoader>[0]),
    ).rejects.toMatchObject({ status: 400 })
    expect(spy).not.toHaveBeenCalled()
  })
})
