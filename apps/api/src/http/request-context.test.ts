import { describe, expect, it } from 'vitest'
import { AuditFields } from '../modules/infrastructure/database/audit-fields.js'
import { RequestContext } from './request-context.js'

describe('RequestContext + AuditFields', () => {
  it('isolates parallel requests and requires a trusted actor', async () => {
    const run = (requestId: string, actor: string) =>
      RequestContext.run({ requestId }, async () => {
        RequestContext.setActor(actor)
        await Promise.resolve()
        return { requestId: RequestContext.requestId, stamp: AuditFields.onCreate() }
      })
    const [a, b] = await Promise.all([
      run('request-a', '11111111-1111-4111-8111-111111111111'),
      run('request-b', '22222222-2222-4222-8222-222222222222'),
    ])
    expect(a.requestId).toBe('request-a')
    expect(a.stamp.createdBy).toBe('11111111-1111-4111-8111-111111111111')
    expect(b.stamp.updatedBy).toBe('22222222-2222-4222-8222-222222222222')
    expect(RequestContext.requestId).toBeUndefined()
  })

  it('refuses audited writes without an authenticated actor', () => {
    expect(() => AuditFields.onCreate()).toThrow(/actor is required/)
    expect(() => RequestContext.run({ requestId: 'anon' }, () => AuditFields.onUpdate())).toThrow()
  })
})
