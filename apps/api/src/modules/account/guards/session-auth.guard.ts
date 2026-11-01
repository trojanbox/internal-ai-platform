import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { appConfig } from '../../../config/app.config.js'
import { IS_PUBLIC_KEY } from '../../../http/public.decorator.js'
import { RequestContext } from '../../../http/request-context.js'
import { AuthService } from '../services/auth.service.js'
import type { AuthenticatedRequest } from '../decorators/auth.decorators.js'

function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined
  const prefix = `${name}=`
  return header
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length)
}

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) return true

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const rawToken = parseCookie(request.headers.cookie, appConfig.sessionCookieName)
    const principal = await this.authService.authenticate(
      rawToken ? decodeURIComponent(rawToken) : '',
    )
    request.auth = principal
    RequestContext.setActor(principal.user.id)

    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) {
      const csrfHeader = request.headers['x-csrf-token']
      this.authService.verifyCsrfToken(
        principal,
        typeof csrfHeader === 'string' ? csrfHeader : csrfHeader?.[0],
      )
    }
    return true
  }
}
