import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common'
import {
  loginRequestSchema,
  registerRequestSchema,
  type AuthResponse,
  type LoginRequest,
  type RegisterRequest,
} from '@repo/contracts'
import type { Request, Response } from 'express'

import { appConfig } from '../../../config/app.config.js'
import { success } from '../../../http/api-response.js'
import { Public } from '../../../http/public.decorator.js'
import { CurrentAuth } from '../decorators/auth.decorators.js'
import { AuthService, type AuthPrincipal, type CreatedSession } from '../services/auth.service.js'
import { AuthRateLimitService } from '../services/auth-rate-limit.service.js'

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly rateLimit: AuthRateLimitService,
  ) {}

  @Public()
  @Post('register')
  async register(
    @Body({ schema: registerRequestSchema }) input: RegisterRequest,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    await this.rateLimit.assertAllowed('register', request.ip)
    const session = await this.authService.register(input)
    this.writeSessionCookies(response, session)
    return success({ user: session.user })
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(
    @Body({ schema: loginRequestSchema }) input: LoginRequest,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    await this.rateLimit.assertAllowed('login', request.ip)
    const session = await this.authService.login(input)
    this.writeSessionCookies(response, session)
    return success({ user: session.user })
  }

  @Get('session')
  session(@CurrentAuth() auth: AuthPrincipal): AuthResponse {
    return success({ user: auth.user })
  }

  @HttpCode(HttpStatus.OK)
  @Post('logout')
  async logout(@CurrentAuth() auth: AuthPrincipal, @Res({ passthrough: true }) response: Response) {
    await this.authService.logout(auth.sessionTokenHash)
    response.clearCookie(appConfig.sessionCookieName, { path: '/' })
    response.clearCookie('csrf_token', { path: '/' })
    return success({})
  }

  private writeSessionCookies(response: Response, session: CreatedSession): void {
    const common = {
      secure: appConfig.secureCookie,
      sameSite: 'lax' as const,
      path: '/',
      maxAge: appConfig.sessionTtlMs,
    }
    response.cookie(appConfig.sessionCookieName, session.sessionToken, {
      ...common,
      httpOnly: true,
    })
    response.cookie('csrf_token', session.csrfToken, { ...common, httpOnly: false })
  }
}
