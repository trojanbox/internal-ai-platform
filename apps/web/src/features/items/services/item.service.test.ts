import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiClient } from '../../../infrastructure/http/api.client'
import { ItemService } from './item.service'

afterEach(() => vi.restoreAllMocks())

describe('ItemService pagination', () => {
  it('forwards pagination and returns the server page metadata', async () => {
    const data = { list: [], page: { currentPage: 2, pageSize: 25, totalRows: 39 } }
    const get = vi.spyOn(ApiClient, 'get').mockResolvedValue({ code: 0, message: '', data })
    expect(await ItemService.list({ currentPage: 2, pageSize: 25 })).toEqual(data)
    expect(get).toHaveBeenCalledWith('/items?currentPage=2&pageSize=25', undefined)
  })
})
