import type { ApiSuccess } from '@repo/contracts'

export function success<T extends object>(data: T): ApiSuccess<T> {
  return { code: 0, message: '', data }
}
