import { expect, test } from '@playwright/test'

import { registerThroughUi } from '../fixtures/auth.fixture'

test('register creates an authenticated browser session', async ({ page }) => {
  const { email } = await registerThroughUi(page)

  await expect(page).toHaveURL(/\/items$/)
  await expect(page.getByRole('heading', { name: '内容列表' })).toBeVisible()
  await expect(page.getByRole('button', { name: '打开账户菜单' })).toBeVisible()

  await page.getByRole('button', { name: '打开账户菜单' }).click()
  await expect(page.getByText(email)).toBeVisible()
})
