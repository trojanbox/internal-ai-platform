import 'dotenv/config'

import { Pool } from 'pg'
import { createClient } from 'redis'

import { migrateDatabase, seedDemoData } from './database-tools.js'

const kind = process.env.DB_TEST_KIND === 'e2e' ? 'e2e' : 'integration'
const url = kind === 'e2e' ? process.env.E2E_DATABASE_URL : process.env.TEST_DATABASE_URL
const redisUrl = kind === 'e2e' ? process.env.E2E_REDIS_URL : process.env.TEST_REDIS_URL

function redisIdentity(value: string): string {
  const url = new URL(value)
  if (!['redis:', 'rediss:'].includes(url.protocol)) throw new Error('Redis URL required')
  const db = url.pathname.slice(1) || '0'
  if (!/^[0-9]+$/.test(db)) throw new Error('Invalid Redis database index')
  return [url.protocol, url.hostname.toLowerCase(), url.port || '6379', Number(db)].join(':')
}
function assertSafeTestRedis(redisUrl: string | undefined): asserts redisUrl is string {
  if (process.env.NODE_ENV !== 'test') throw new Error('Redis reset requires NODE_ENV=test')
  if (!redisUrl || !process.env.REDIS_URL) {
    throw new Error('Explicit test and development Redis URLs are required')
  }
  const db = Number(new URL(redisUrl).pathname.slice(1) || '0')
  const dedicatedDb = kind === 'e2e' ? 15 : 14
  const developmentDb = Number(new URL(process.env.REDIS_URL).pathname.slice(1) || '0')
  if ([14, 15].includes(developmentDb)) {
    throw new Error('Development Redis cannot use a reserved test database')
  }
  if (db !== dedicatedDb || redisIdentity(redisUrl) === redisIdentity(process.env.REDIS_URL)) {
    throw new Error('Refusing to reset Redis outside the dedicated test database ' + dedicatedDb)
  }
  if (
    kind === 'integration' &&
    process.env.E2E_REDIS_URL &&
    redisIdentity(redisUrl) === redisIdentity(process.env.E2E_REDIS_URL)
  ) {
    throw new Error('Integration and E2E Redis databases must differ')
  }
  if (
    kind === 'e2e' &&
    process.env.TEST_REDIS_URL &&
    redisIdentity(redisUrl) === redisIdentity(process.env.TEST_REDIS_URL)
  ) {
    throw new Error('Integration and E2E Redis databases must differ')
  }
}

function databaseIdentity(value: string): string {
  const parsed = new URL(value)
  if (!['postgresql:', 'postgres:'].includes(parsed.protocol))
    throw new Error('PostgreSQL URL required')
  return [
    parsed.hostname.toLowerCase(),
    parsed.port || '5432',
    decodeURIComponent(parsed.pathname),
  ].join(':')
}

function assertSafeTestDatabase(url: string | undefined): asserts url is string {
  if (process.env.NODE_ENV !== 'test')
    throw new Error('Refusing destructive reset unless NODE_ENV=test')
  if (!url) throw new Error('Dedicated test database URL is required')
  if (!process.env.DATABASE_URL)
    throw new Error('DATABASE_URL is required to guard the development database')
  if (databaseIdentity(url) === databaseIdentity(process.env.DATABASE_URL)) {
    throw new Error('Refusing to reset the development database')
  }
  const databaseName = new URL(url).pathname.slice(1).toLowerCase()
  if (!databaseName.includes('test') || !databaseName.includes(kind)) {
    throw new Error('Test database name must include both test and test kind markers')
  }
}

assertSafeTestDatabase(url)
assertSafeTestRedis(redisUrl)
// Check both services before performing destructive test-only resets.
const redis = createClient({
  url: redisUrl,
  socket: { connectTimeout: 3000, reconnectStrategy: false },
})
try {
  await redis.connect()
  const pool = new Pool({ connectionString: url })
  try {
    // Test databases have their own DB names and never share this schema with dev/prod.
    await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE')
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE')
    await pool.query('CREATE SCHEMA public')
  } finally {
    await pool.end()
  }
  await redis.flushDb()
  await migrateDatabase(url)
  if (process.argv.includes('--seed')) await seedDemoData(url)
} finally {
  if (redis.isOpen) redis.destroy()
}

console.log('Reset ' + kind + ' PostgreSQL and dedicated Redis test DB')
