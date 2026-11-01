import { isNull, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

export function activeRecord<T extends { deletedAt: AnyPgColumn }>(table: T): SQL {
  return isNull(table.deletedAt)
}
