import { Injectable } from '@nestjs/common'
import { and, count, desc, eq } from 'drizzle-orm'

import { AuditFields } from '../../infrastructure/database/audit-fields.js'
import { activeRecord } from '../../infrastructure/database/active-record.js'
import { DatabaseService } from '../../infrastructure/database/database.service.js'
import { items } from '../../infrastructure/database/schema/index.js'

@Injectable()
export class ItemsRepository {
  constructor(private readonly database: DatabaseService) {}

  async list(input: { currentPage: number; pageSize: number }) {
    const offset = (input.currentPage - 1) * input.pageSize
    const active = activeRecord(items)
    const list = await this.database.db
      .select({
        id: items.id,
        title: items.title,
        summary: items.summary,
        createdAt: items.createdAt,
      })
      .from(items)
      .where(active)
      .orderBy(desc(items.createdAt), desc(items.id))
      .limit(input.pageSize)
      .offset(offset)
    const [summary] = await this.database.db.select({ total: count() }).from(items).where(active)
    return { list, totalRows: summary?.total ?? 0 }
  }

  async findById(itemId: string) {
    const [item] = await this.database.db
      .select({
        id: items.id,
        title: items.title,
        summary: items.summary,
        content: items.content,
        createdAt: items.createdAt,
      })
      .from(items)
      .where(and(eq(items.id, itemId), activeRecord(items)))
      .limit(1)
    return item
  }

  async create(input: { id: string; title: string; summary: string; content: string }) {
    const [item] = await this.database.db
      .insert(items)
      .values({ ...input, ...AuditFields.onCreate() })
      .returning()
    return item
  }

  async update(id: string, input: { title: string }) {
    const [item] = await this.database.db
      .update(items)
      .set({ ...input, ...AuditFields.onUpdate() })
      .where(and(eq(items.id, id), activeRecord(items)))
      .returning()
    return item
  }

  async softDelete(id: string): Promise<boolean> {
    const [row] = await this.database.db
      .update(items)
      .set({ deletedAt: new Date(), ...AuditFields.onUpdate() })
      .where(and(eq(items.id, id), activeRecord(items)))
      .returning({ id: items.id })
    return Boolean(row)
  }
}
