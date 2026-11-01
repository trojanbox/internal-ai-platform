import type { Locale } from './locale.types'

export const SUPPORTED_LOCALES = ['zh-CN', 'en-US'] as const satisfies readonly Locale[]
export const DEFAULT_LOCALE: Locale = 'zh-CN'
