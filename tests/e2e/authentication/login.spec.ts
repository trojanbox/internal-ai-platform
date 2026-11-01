import { expect, test } from '@playwright/test'

import { createUserViaApi } from '../fixtures/auth.fixture'

test('existing user can log in and log out', async ({ page, request }) => {
  const { email, password } = await createUserViaApi(request)

  await page.goto('/login')
  await page.getByLabel('邮箱').fill(email)
  await page.getByLabel('密码').fill(password)
  await page.getByRole('button', { name: '登录' }).click()

  await expect(page).toHaveURL(/\/items$/)

  await page.getByRole('button', { name: '打开账户菜单' }).click()
  await page.getByRole('menuitem', { name: '退出登录' }).click()

  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible()
})
