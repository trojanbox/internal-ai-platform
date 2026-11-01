import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { AppModule } from '../../../apps/api/src/app.module.js'
import { configureApp } from '../../../apps/api/src/bootstrap/configure-app.js'

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile()
  const app = moduleRef.createNestApplication()
  configureApp(app)
  await app.init()
  return app
}
