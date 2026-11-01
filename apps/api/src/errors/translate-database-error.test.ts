import { describe, expect, it } from 'vitest'
import { translateDatabaseError } from './translate-database-error.js'

describe('PostgreSQL error boundary', () => {
  it('translates unique and foreign key violations without leaking database details', () => {
    expect(
      translateDatabaseError({ code: '23505', constraint: 'users_email_unique' }),
    ).toMatchObject({
      category: 'conflict',
      code: 'EMAIL_ALREADY_EXISTS',
    })
    expect(
      translateDatabaseError({ cause: { code: '23503', detail: 'secret user id' } }),
    ).toMatchObject({
      category: 'conflict',
      code: 'DATABASE_CONFLICT',
    })
  })

  it('does not expose unexpected SQLSTATE errors as client conflicts', () => {
    expect(translateDatabaseError({ code: '42P01', detail: 'secret table name' })).toBeUndefined()
    expect(translateDatabaseError(new Error('random'))).toBeUndefined()
  })
})
