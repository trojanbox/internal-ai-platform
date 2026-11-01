import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const items = pgTable('items', {
  id: uuid('id').primaryKey(),
  title: text('title').notNull(),
  summary: text('summary').notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true, precision: 3 }),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
})
