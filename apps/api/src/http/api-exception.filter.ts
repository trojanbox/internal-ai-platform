import { API_ERROR_CODE, type ApiFailure } from '@repo/contracts'
import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common'
import type { Response } from 'express'

import { ApplicationError, type ErrorCategory } from '../errors/application-error.js'
import { translateDatabaseError } from '../errors/translate-database-error.js'
import { RequestContext } from './request-context.js'

const categoryStatus: Record<ErrorCategory, number> = {
  validation: HttpStatus.BAD_REQUEST,
  unauthenticated: HttpStatus.UNAUTHORIZED,
  forbidden: HttpStatus.FORBIDDEN,
  not_found: HttpStatus.NOT_FOUND,
  conflict: HttpStatus.CONFLICT,
  rate_limited: HttpStatus.TOO_MANY_REQUESTS,
  internal: HttpStatus.INTERNAL_SERVER_ERROR,
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name)

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>()
    const applicationError =
      exception instanceof ApplicationError ? exception : translateDatabaseError(exception)

    if (applicationError) {
      const status = categoryStatus[applicationError.category]
      if (applicationError.options.retryAfterSeconds) {
        response.setHeader('Retry-After', String(applicationError.options.retryAfterSeconds))
      }
      const payload: ApiFailure = {
        code: applicationError.options.numericCode ?? status,
        message: status >= 500 ? 'Internal server error' : applicationError.message,
        data: {},
        error: {
          code: status >= 500 ? API_ERROR_CODE.Internal : applicationError.code,
          retryable: applicationError.options.retryable ?? false,
          ...(applicationError.options.details
            ? { details: applicationError.options.details }
            : {}),
        },
      }
      if (status >= 500)
        this.logger.error(
          JSON.stringify({ event: 'application_error', requestId: RequestContext.requestId }),
        )
      response.status(status).json(payload)
      return
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus()
      const code = status === HttpStatus.BAD_REQUEST ? API_ERROR_CODE.Validation : 'HTTP_' + status
      const payload: ApiFailure = {
        code: status,
        message:
          status >= 500
            ? 'Internal server error'
            : status === HttpStatus.BAD_REQUEST
              ? 'Request validation failed'
              : exception.message,
        data: {},
        error: { code: status >= 500 ? API_ERROR_CODE.Internal : code, retryable: false },
      }
      if (status >= 500)
        this.logger.error(
          JSON.stringify({ event: 'http_error', requestId: RequestContext.requestId }),
        )
      response.status(status).json(payload)
      return
    }

    this.logger.error(
      JSON.stringify({
        event: 'unhandled_error',
        requestId: RequestContext.requestId,
        error: exception instanceof Error ? exception.message : 'Unknown',
      }),
      exception instanceof Error ? exception.stack : undefined,
    )
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      data: {},
      error: { code: API_ERROR_CODE.Internal, retryable: false },
    } satisfies ApiFailure)
  }
}
