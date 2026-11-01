import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from './locale.constants'
import type { Locale } from './locale.types'

export function isSupportedLocale(value: string): value is Locale {
  return SUPPORTED_LOCALES.some((locale) => locale === value)
}

export function resolveLocale(candidates: readonly string[]): Locale {
  return candidates.find(isSupportedLocale) ?? DEFAULT_LOCALE
}
