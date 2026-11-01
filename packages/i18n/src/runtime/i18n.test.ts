import { describe, expect, it } from 'vitest'

import { i18n } from './i18n'

describe('i18n runtime', () => {
  it('ships both locales with domain namespaces', () => {
    expect(i18n.t('login.submit', { ns: 'authentication', lng: 'zh-CN' })).toBe('登录')
    expect(i18n.t('login.submit', { ns: 'authentication', lng: 'en-US' })).toBe('Sign in')
    expect(i18n.t('title', { ns: 'items', lng: 'zh-CN' })).toBe('内容列表')
  })

  it('keeps critical API error mappings observable', () => {
    expect(i18n.exists('errors.UNAUTHENTICATED', { ns: 'common', lng: 'zh-CN' })).toBe(true)
    expect(i18n.exists('errors.EMAIL_ALREADY_EXISTS', { ns: 'common', lng: 'en-US' })).toBe(true)
  })
})
