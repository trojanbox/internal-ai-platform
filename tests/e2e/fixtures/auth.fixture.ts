import type { APIRequestContext, Page } from '@playwright/test'

import { strongPassword, uniqueEmail } from '../helpers/test-data'

export async function createUserViaApi(request: APIRequestContext) {
  const email = uniqueEmail('fixture')
  const response = await request.post('/api/v1/auth/register', {
    data: { email, password: strongPassword },
  })
  if (!response.ok()) {
    throw new Error(`Failed to create fixture user: ${response.status()} ${await response.text()}`)
  }
  return { email, password: strongPassword }
}

export async function registerThroughUi(page: Page) {
  const email = uniqueEmail('browser')
  await page.goto('/register')
  await page.getByLabel('邮箱').fill(email)
  await page.getByLabel('密码').fill(strongPassword)
  await page.getByRole('button', { name: '注册' }).click()
  return { email, password: strongPassword }
}
