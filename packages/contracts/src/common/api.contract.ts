export type ApiSuccess<T extends object> = {
  code: 0
  message: string
  data: T
}

export type ApiFailure = {
  code: number
  message: string
  data: Record<string, never>
  error: {
    code: string
    details?: Record<string, unknown>
    retryable: boolean
  }
}

export type ApiListData<T extends object> = {
  list: T[]
  page: {
    totalRows: number
    currentPage: number
    pageSize: number
  }
}

export const API_ERROR_CODE = {
  Validation: 'VALIDATION_ERROR',
  InvalidCredentials: 'INVALID_CREDENTIALS',
  EmailAlreadyExists: 'EMAIL_ALREADY_EXISTS',
  Unauthenticated: 'UNAUTHENTICATED',
  InvalidCsrfToken: 'INVALID_CSRF_TOKEN',
  ItemNotFound: 'ITEM_NOT_FOUND',
  Internal: 'INTERNAL_ERROR',
  RateLimited: 'RATE_LIMITED',
  DatabaseConflict: 'DATABASE_CONFLICT',
} as const

export type ApiErrorCode = (typeof API_ERROR_CODE)[keyof typeof API_ERROR_CODE]
