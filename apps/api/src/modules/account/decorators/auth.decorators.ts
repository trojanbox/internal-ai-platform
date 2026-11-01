import { createParamDecorator, type ExecutionContext } from '@nestjs/common'
import type { Request } from 'express'

import type { AuthPrincipal } from '../services/auth.service.js'

export type AuthenticatedRequest = Request & { auth?: AuthPrincipal }

export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthPrincipal => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    if (!request.auth) throw new Error('Authentication principal is missing')
    return request.auth
  },
)
