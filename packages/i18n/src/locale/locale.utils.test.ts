import { describe, expect, it } from 'vitest'

import { resolveLocale } from './locale.utils'

describe('resolveLocale', () => {
  it('uses the first supported locale', () => {
    expect(resolveLocale(['ja-JP', 'en-US', 'zh-CN'])).toBe('en-US')
  })

  it('falls back to the default locale', () => {
    expect(resolveLocale(['ja-JP'])).toBe('zh-CN')
  })
})
