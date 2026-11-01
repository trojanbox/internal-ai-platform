import { Test } from '@nestjs/testing'
import { describe, expect, it, vi } from 'vitest'

import { ApplicationError } from '../../../errors/application-error.js'
import { ItemsRepository } from '../repositories/items.repository.js'
import { ItemsService } from './items.service.js'

describe('ItemsService', () => {
  it('maps repository dates and pagination into the API contract', async () => {
    const repository = {
      list: vi.fn().mockResolvedValue({
        list: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            title: 'One',
            summary: 'Summary',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
          },
        ],
        totalRows: 1,
      }),
    }

    const moduleRef = await Test.createTestingModule({
      providers: [ItemsService, { provide: ItemsRepository, useValue: repository }],
    }).compile()

    const service = moduleRef.get(ItemsService)
    expect(await service.list({ currentPage: 1, pageSize: 20 })).toEqual({
      list: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          title: 'One',
          summary: 'Summary',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      page: { totalRows: 1, currentPage: 1, pageSize: 20 },
    })

    await moduleRef.close()
  })

  it('returns a stable application error when an item is missing', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ItemsService,
        { provide: ItemsRepository, useValue: { findById: vi.fn().mockResolvedValue(undefined) } },
      ],
    }).compile()

    const service = moduleRef.get(ItemsService)
    await expect(service.detail('11111111-1111-4111-8111-111111111111')).rejects.toThrow(
      ApplicationError,
    )

    await moduleRef.close()
  })
})
