import { expect, test } from '@playwright/test'

import { registerThroughUi } from '../fixtures/auth.fixture'

test('authenticated user can browse list and open detail', async ({ page }) => {
  await registerThroughUi(page)

  const itemLink = page.getByRole('link', { name: /Monorepo 的边界应该很清楚/ })
  await expect(itemLink).toBeVisible()
  await itemLink.click()

  await expect(page.getByRole('heading', { name: 'Monorepo 的边界应该很清楚' })).toBeVisible()
  await expect(page.getByRole('link', { name: '返回列表' })).toBeVisible()
})

test('template explanation opens through the Radix dialog wrapper', async ({ page }) => {
  await registerThroughUi(page)

  await page.getByRole('button', { name: '模板说明' }).click()
  await expect(page.getByRole('dialog', { name: '前端 UI 基线' })).toBeVisible()
  await page.getByRole('button', { name: '关闭' }).click()
  await expect(page.getByRole('dialog', { name: '前端 UI 基线' })).not.toBeVisible()
})
