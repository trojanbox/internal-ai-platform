import { API_ERROR_CODE } from '@repo/contracts'
import { ApplicationError } from './application-error.js'

type PgError = { code?: unknown; constraint?: unknown; cause?: unknown }
export function translateDatabaseError(error: unknown): ApplicationError | undefined {
  // DrizzleQueryError wraps the driver error in .cause. SQLSTATE is on that cause.
  let pg: PgError | undefined
  let current: unknown = error
  for (let depth = 0; depth < 3; depth++) {
    if (!current || typeof current !== 'object') return undefined
    const candidate = current as PgError
    if (typeof candidate.code === 'string') {
      pg = candidate
      break
    }
    current = candidate.cause
  }
  if (!pg) return undefined
  if (pg.code === '23505') {
    if (pg.constraint === 'users_email_unique') {
      return new ApplicationError(
        'conflict',
        API_ERROR_CODE.EmailAlreadyExists,
        'Email already exists',
      )
    }
    return new ApplicationError(
      'conflict',
      API_ERROR_CODE.DatabaseConflict,
      'Resource already exists',
    )
  }
  if (pg.code === '23503') {
    return new ApplicationError(
      'conflict',
      API_ERROR_CODE.DatabaseConflict,
      'Related resource constraint violated',
    )
  }
  // Other SQLSTATE errors remain internal; never expose the database driver message.
  return undefined
}
