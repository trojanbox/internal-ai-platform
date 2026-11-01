import { AsyncLocalStorage } from 'node:async_hooks'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common'
import { drizzle } from 'drizzle-orm/node-postgres'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { Pool } from 'pg'

import { appConfig, requiredDatabaseUrl } from '../../../config/app.config.js'
import * as schema from './schema/index.js'

function createDatabase(pool: Pool) {
  return drizzle(pool, { schema })
}
type DatabaseClient = ReturnType<typeof createDatabase>
type TransactionClient = Parameters<Parameters<DatabaseClient['transaction']>[0]>[0]
const migrationFolder = resolve(fileURLToPath(new URL('../../../../drizzle/', import.meta.url)))

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name)
  private readonly pool: Pool
  private readonly client: DatabaseClient
  private readonly transactionScope = new AsyncLocalStorage<TransactionClient>()

  constructor() {
    this.pool = new Pool({
      connectionString: requiredDatabaseUrl(),
      max: appConfig.dbPoolMax,
      connectionTimeoutMillis: appConfig.dbConnectionTimeoutMs,
      idleTimeoutMillis: appConfig.dbIdleTimeoutMs,
      statement_timeout: appConfig.dbStatementTimeoutMs,
    })
    this.pool.on('error', (error) =>
      this.logger.error('Idle PostgreSQL connection error', error.stack),
    )
    this.client = createDatabase(this.pool)
  }

  get db(): DatabaseClient {
    // A Drizzle transaction provides the same query-builder interface as the root client.
    return (
      (this.transactionScope.getStore() as unknown as DatabaseClient | undefined) ?? this.client
    )
  }

  async transaction<T>(work: () => Promise<T>): Promise<T> {
    if (this.transactionScope.getStore()) return work()
    return this.client.transaction((transaction) => this.transactionScope.run(transaction, work))
  }

  async ready(): Promise<boolean> {
    try {
      const expected = readMigrationFiles({ migrationsFolder: migrationFolder })
      if (expected.length === 0) return false
      const result = await this.pool.query<{ hash: string; created_at: string }>(
        'SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at',
      )
      return expected.every((migration) =>
        result.rows.some(
          (row) => Number(row.created_at) === migration.folderMillis && row.hash === migration.hash,
        ),
      )
    } catch {
      return false
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end()
  }
}
