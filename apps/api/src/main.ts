import 'reflect-metadata'

import { NestFactory } from '@nestjs/core'

import { AppModule } from './app.module.js'
import { configureApp } from './bootstrap/configure-app.js'
import { appConfig } from './config/app.config.js'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  configureApp(app)
  app.enableShutdownHooks()
  await app.listen(appConfig.port, '0.0.0.0')
}

await bootstrap()
