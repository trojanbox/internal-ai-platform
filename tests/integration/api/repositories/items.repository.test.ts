import { randomUUID } from 'node:crypto'

import { Test } from '@nestjs/testing'
import { RequestContext } from '../../../../apps/api/src/http/request-context.js'
import { eq, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { ItemsRepository } from '../../../../apps/api/src/modules/catalog/repositories/items.repository.js'
import { DatabaseService } from '../../../../apps/api/src/modules/infrastructure/database/database.service.js'
import { items } from '../../../../apps/api/src/modules/infrastructure/database/schema/item.schema.js'
import { InfrastructureModule } from '../../../../apps/api/src/modules/infrastructure/infrastructure.module.js'

describe('ItemsRepository', () => {
  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [InfrastructureModule] }).compile()
    const database = moduleRef.get(DatabaseService)
    await database.db.delete(items)
    await moduleRef.close()
  })

  it('reads list and detail from real PostgreSQL + Drizzle schema', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [InfrastructureModule],
      providers: [ItemsRepository],
    }).compile()

    const database = moduleRef.get(DatabaseService)
    const repository = moduleRef.get(ItemsRepository)

    await database.db.insert(items).values([
      {
        id: '11111111-1111-4111-8111-111111111111',
        title: 'Newest',
        summary: 'A',
        content: 'A content',
        createdAt: new Date('2026-02-01T00:00:00.000Z'),
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        title: 'Older',
        summary: 'B',
        content: 'B content',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ])

    const page = await repository.list({ currentPage: 1, pageSize: 1 })
    expect(page.totalRows).toBe(2)
    expect(page.list[0]?.title).toBe('Newest')
    expect((await repository.findById('22222222-2222-4222-8222-222222222222'))?.content).toBe(
      'B content',
    )

    await moduleRef.close()
  })

  it('has millisecond UTC timestamps, SQL update triggers and soft-delete filtering', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [InfrastructureModule],
      providers: [ItemsRepository],
    }).compile()
    try {
      const database = moduleRef.get(DatabaseService)
      const repository = moduleRef.get(ItemsRepository)
      const id = randomUUID()
      const initialTime = new Date('2020-01-01T00:00:00.123Z')
      const [created] = await database.db
        .insert(items)
        .values({
          id,
          title: 'Before',
          summary: 'Summary',
          content: 'Detail',
          createdAt: initialTime,
          updatedAt: initialTime,
        })
        .returning()

      expect(created?.createdAt.toISOString()).toBe('2020-01-01T00:00:00.123Z')
      expect(created?.updatedAt.toISOString()).toBe('2020-01-01T00:00:00.123Z')
      expect(created?.deletedAt).toBeNull()

      // This raw SQL update must refresh updated_at independently of any ORM hook.
      await database.db.execute(sql`UPDATE ${items} SET title = 'After' WHERE ${items.id} = ${id}`)
      const [afterUpdate] = await database.db.select().from(items).where(eq(items.id, id))
      expect(afterUpdate?.createdAt.toISOString()).toBe('2020-01-01T00:00:00.123Z')
      expect(afterUpdate?.updatedAt.getTime()).toBeGreaterThan(initialTime.getTime())

      await database.db.update(items).set({ deletedAt: new Date() }).where(eq(items.id, id))
      const page = await repository.list({ currentPage: 1, pageSize: 20 })
      expect(page.list).toHaveLength(0)
      expect(page.totalRows).toBe(0)
      expect(await repository.findById(id)).toBeUndefined()
      const [afterDelete] = await database.db.select().from(items).where(eq(items.id, id))
      expect(afterDelete?.deletedAt).toBeInstanceOf(Date)
    } finally {
      await moduleRef.close()
    }
  })
  it('stamps the authenticated actor on writes and hides deleted records', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [InfrastructureModule],
      providers: [ItemsRepository],
    }).compile()
    try {
      const repository = moduleRef.get(ItemsRepository)
      const database = moduleRef.get(DatabaseService)
      const actorId = randomUUID()
      const itemId = randomUUID()
      await RequestContext.run({ requestId: 'audit-integration' }, async () => {
        RequestContext.setActor(actorId)
        const created = await repository.create({
          id: itemId,
          title: 'Write',
          summary: 'Summary',
          content: 'Content',
        })
        expect(created?.createdBy).toBe(actorId)
        expect(created?.updatedBy).toBe(actorId)
        const updated = await repository.update(itemId, { title: 'Changed' })
        expect(updated?.updatedBy).toBe(actorId)
        expect(await repository.softDelete(itemId)).toBe(true)
        expect(await repository.findById(itemId)).toBeUndefined()
        const [row] = await database.db.select().from(items).where(eq(items.id, itemId))
        expect(row?.deletedAt).toBeInstanceOf(Date)
        expect(row?.updatedBy).toBe(actorId)
      })
    } finally {
      await moduleRef.close()
    }
  })
  it('isolates overlapping transactions and rolls back only the failed request', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [InfrastructureModule] }).compile()
    try {
      const database = moduleRef.get(DatabaseService)
      const rolledBackId = randomUUID()
      const committedId = randomUUID()
      let notifyStarted!: () => void
      let allowRollback!: () => void
      const started = new Promise<void>((resolve) => {
        notifyStarted = resolve
      })
      const release = new Promise<void>((resolve) => {
        allowRollback = resolve
      })
      const failed = database.transaction(async () => {
        await database.db.insert(items).values({
          id: rolledBackId,
          title: 'Rollback',
          summary: 'Test',
          content: 'Test',
        })
        notifyStarted()
        await release
        throw new Error('rollback transaction')
      })
      await started
      const succeeded = database.transaction(async () => {
        await database.db.insert(items).values({
          id: committedId,
          title: 'Commit',
          summary: 'Test',
          content: 'Test',
        })
      })
      allowRollback()
      const results = await Promise.allSettled([failed, succeeded])
      expect(results.map((result) => result.status)).toEqual(['rejected', 'fulfilled'])
      const selected = await database.db.select({ id: items.id }).from(items)
      expect(selected.map((item) => item.id)).toEqual([committedId])
    } finally {
      await moduleRef.close()
    }
  })
})
