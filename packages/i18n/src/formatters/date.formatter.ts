import { DEFAULT_LOCALE } from '../locale/locale.constants'
import { resolveLocale } from '../locale/locale.utils'

export function formatDate(value: Date | string, locale?: string): string {
  const resolvedLocale = resolveLocale(locale ? [locale] : [DEFAULT_LOCALE])
  const date = value instanceof Date ? value : new Date(value)
  return new Intl.DateTimeFormat(resolvedLocale, { dateStyle: 'medium' }).format(date)
}
