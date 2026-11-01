import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'

type Context = { requestId: string; actorId?: string }
const storage = new AsyncLocalStorage<Context>()

export class RequestContext {
  static run<T>(context: Context, callback: () => T): T {
    return storage.run(context, callback)
  }

  static get requestId(): string | undefined {
    return storage.getStore()?.requestId
  }

  static setActor(actorId: string): void {
    const context = storage.getStore()
    if (!context) throw new Error('Request context is unavailable')
    context.actorId = actorId
  }

  static requireActorId(): string {
    const actorId = storage.getStore()?.actorId
    if (!actorId) throw new Error('Authenticated actor is required for audited write')
    return actorId
  }
}

export function requestContextMiddleware(request: Request, response: Response, next: NextFunction) {
  // Never let an untrusted caller choose our log correlation identity.
  const requestId = randomUUID()
  const startedAt = process.hrtime.bigint()
  response.setHeader('X-Request-Id', requestId)
  RequestContext.run({ requestId }, () => {
    response.once('finish', () => {
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000
      console.info(
        JSON.stringify({
          level: 'info',
          event: 'http_request',
          requestId,
          method: request.method,
          path:
            typeof request.route?.path === 'string'
              ? `${request.baseUrl}${request.route.path}`
              : '[unmatched]',
          status: response.statusCode,
          durationMs: Math.round(elapsedMs),
        }),
      )
    })
    next()
  })
}
