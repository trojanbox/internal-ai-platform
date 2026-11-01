import { StandardSchemaValidationPipe, type INestApplication } from '@nestjs/common'
import helmet from 'helmet'
import type { Express } from 'express'

import { appConfig } from '../config/app.config.js'

import { requestContextMiddleware } from '../http/request-context.js'

export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api/v1')
  const express = app.getHttpAdapter().getInstance() as Express
  const trusted = new Set(appConfig.trustedProxyIps)
  // Only a configured, actually connected reverse proxy can supply a forwarded client IP.
  express.set('trust proxy', (ip: string) => trusted.has(ip))
  app.use(helmet())
  app.use(requestContextMiddleware)
  app.useGlobalPipes(new StandardSchemaValidationPipe({ transform: true }))
}
