import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'

import { items } from '../src/modules/infrastructure/database/schema/item.schema.js'

const apiRoot = fileURLToPath(new URL('../', import.meta.url))

async function withDatabase<T>(url: string, fn: (pool: Pool) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: url })
  try {
    return await fn(pool)
  } finally {
    await pool.end()
  }
}

export async function migrateDatabase(url: string): Promise<void> {
  await withDatabase(url, async (pool) => {
    await migrate(drizzle(pool), { migrationsFolder: resolve(apiRoot, 'drizzle') })
  })
}

export async function seedDemoData(url: string): Promise<number> {
  return withDatabase(url, async (pool) => {
    const db = drizzle(pool)
    const now = Date.now()
    const demoItems = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        title: 'Monorepo 的边界应该很清楚',
        summary: '前端、后端和跨应用合同各自拥有明确职责。',
        content:
          '这个示例把浏览器应用放在 apps/web，把 API 放在 apps/api。\n\n真正跨应用传输的数据协议进入 packages/contracts，避免前后端各维护一份 DTO。',
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        title: 'Nest Module 保持粗粒度',
        summary: '复杂项目需要模块边界，模块数量也需要克制。',
        content:
          '当前按 Account、Catalog、Infrastructure 三个粗粒度边界组织。\n\nController 负责 HTTP，Service 负责用例，Repository 负责持久化查询。',
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        title: 'PostgreSQL 也走正式 Migration',
        summary: '数据库演进由独立步骤管理。',
        content:
          'Schema 通过 Drizzle 描述，Migration 用 drizzle-kit 显式生成并提交。\n\n测试库和开发库都从同一套 migration ledger 构建。',
      },
      {
        id: '44444444-4444-4444-8444-444444444444',
        title: '浏览器认证使用 Session Cookie',
        summary: '会话凭据留在 HttpOnly Cookie，前端不保存 token。',
        content:
          '登录和注册创建随机 Session Token，Redis 通过 Token 摘要保存有 TTL 的会话，PostgreSQL 不存 Session。\n\n受保护的写请求额外验证 CSRF Token。',
      },
      {
        id: '55555555-5555-4555-8555-555555555555',
        title: '测试分层是脚手架的一部分',
        summary: 'Unit、Integration、HTTP、E2E 都有明确入口。',
        content:
          '模板已经准备了前端 Component Test、后端 Unit/Repository/HTTP Integration，以及 Playwright 全链路测试。',
      },
    ].map((item, index) => {
      const timestamp = new Date(now - index * 60_000)
      return { ...item, createdAt: timestamp, updatedAt: timestamp }
    })

    await db.insert(items).values(demoItems).onConflictDoNothing({ target: items.id })
    return demoItems.length
  })
}
