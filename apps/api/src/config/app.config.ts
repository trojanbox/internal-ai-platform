import 'dotenv/config'
import { isIP } from 'node:net'
import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z.string().url().optional(),
  TEST_DATABASE_URL: z.string().url().optional(),
  E2E_DATABASE_URL: z.string().url().optional(),
  DB_TEST_KIND: z.enum(['integration', 'e2e']).default('integration'),
  REDIS_URL: z.url().optional(),
  TEST_REDIS_URL: z.url().optional(),
  E2E_REDIS_URL: z.url().optional(),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DB_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(100).max(60000).default(5000),
  DB_IDLE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(100).max(120000).default(15000),
  TRUSTED_PROXY_IPS: z.string().default(''),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(168),
})

const env = envSchema.parse(process.env)
const trustedProxyIps = env.TRUSTED_PROXY_IPS.split(',')
  .map((ip) => ip.trim())
  .filter(Boolean)
if (trustedProxyIps.some((ip) => isIP(ip) === 0)) {
  throw new Error('TRUSTED_PROXY_IPS requires an IP allowlist, not arbitrary headers')
}
const redisUrl =
  env.NODE_ENV === 'test'
    ? env.DB_TEST_KIND === 'e2e'
      ? env.E2E_REDIS_URL
      : env.TEST_REDIS_URL
    : env.REDIS_URL

function redisIdentity(value: string): string {
  const url = new URL(value)
  if (!['redis:', 'rediss:'].includes(url.protocol)) throw new Error('Redis URL required')
  const db = url.pathname.slice(1) || '0'
  if (!/^(0|[1-9][0-9]*)$/.test(db) || Number(db) > 15)
    throw new Error('Redis database index must be between 0 and 15')
  return [url.protocol, url.hostname.toLowerCase(), url.port || '6379', Number(db)].join(':')
}
if (redisUrl) redisIdentity(redisUrl)
if (env.NODE_ENV === 'test' && redisUrl) {
  if (!env.REDIS_URL) throw new Error('REDIS_URL is required to guard test Redis isolation')
  if (redisIdentity(redisUrl) === redisIdentity(env.REDIS_URL)) {
    throw new Error('Test Redis must not match REDIS_URL')
  }
  const testDb = Number(new URL(redisUrl).pathname.slice(1) || '0')
  if (testDb === 0) throw new Error('Test Redis must select an explicit, nonzero DB index')
}

const databaseUrl =
  env.NODE_ENV === 'test'
    ? env.DB_TEST_KIND === 'e2e'
      ? env.E2E_DATABASE_URL
      : env.TEST_DATABASE_URL
    : env.DATABASE_URL

function databaseIdentity(value: string): string {
  const url = new URL(value)
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('Only PostgreSQL connection URLs are supported')
  }
  return [url.hostname.toLowerCase(), url.port || '5432', decodeURIComponent(url.pathname)].join(
    ':',
  )
}
if (env.NODE_ENV === 'test' && databaseUrl) {
  if (!/test/i.test(new URL(databaseUrl).pathname)) {
    throw new Error('Test database name must contain a test marker')
  }
  if (env.DATABASE_URL && databaseIdentity(databaseUrl) === databaseIdentity(env.DATABASE_URL)) {
    throw new Error('Test database must not match DATABASE_URL')
  }
}
if (databaseUrl) databaseIdentity(databaseUrl)

export const appConfig = {
  nodeEnv: env.NODE_ENV,
  port: env.PORT,
  databaseUrl,
  redisUrl,
  trustedProxyIps,
  dbPoolMax: env.DB_POOL_MAX,
  dbConnectionTimeoutMs: env.DB_CONNECTION_TIMEOUT_MS,
  dbIdleTimeoutMs: env.DB_IDLE_TIMEOUT_MS,
  dbStatementTimeoutMs: env.DB_STATEMENT_TIMEOUT_MS,
  sessionTtlMs: env.SESSION_TTL_HOURS * 60 * 60 * 1000,
  sessionCookieName: env.NODE_ENV === 'production' ? '__Host-session' : 'session',
  secureCookie: env.NODE_ENV === 'production',
} as const

export function requiredRedisUrl(): string {
  if (!appConfig.redisUrl) throw new Error('REDIS_URL or a dedicated test Redis URL is required')
  return appConfig.redisUrl
}

export function requiredDatabaseUrl(): string {
  if (!appConfig.databaseUrl) {
    throw new Error('DATABASE_URL or a dedicated test database URL is required')
  }
  return appConfig.databaseUrl
}
