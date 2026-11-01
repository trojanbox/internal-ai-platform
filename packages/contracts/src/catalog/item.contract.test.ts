import { describe, expect, it } from 'vitest'

import { itemListQuerySchema } from './item.contract.js'

describe('item contract', () => {
  it('coerces list pagination from URL query strings', () => {
    expect(itemListQuerySchema.parse({ currentPage: '2', pageSize: '10' })).toEqual({
      currentPage: 2,
      pageSize: 10,
    })
  })

  it('rejects unsafe page sizes', () => {
    expect(() => itemListQuerySchema.parse({ currentPage: '1', pageSize: '1000' })).toThrow()
  })
})
