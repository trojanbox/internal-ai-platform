import { expect, test } from '@playwright/test'

import { createUserViaApi } from '../fixtures/auth.fixture'

test('duplicate registration shows the stable product error', async ({ page, request }) => {
  const { email, password } = await createUserViaApi(request)

  await page.goto('/register')
  await page.getByLabel('邮箱').fill(email)
  await page.getByLabel('密码').fill(password)
  await page.getByRole('button', { name: '注册' }).click()

  await expect(page.getByText('该邮箱已经注册')).toBeVisible()
  await expect(page).toHaveURL(/\/register$/)
})
