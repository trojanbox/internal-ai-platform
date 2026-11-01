export type ErrorCategory =
  | 'validation'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'internal'

export class ApplicationError extends Error {
  constructor(
    readonly category: ErrorCategory,
    readonly code: string,
    message: string,
    readonly options: {
      details?: Record<string, unknown>
      retryable?: boolean
      numericCode?: number
      retryAfterSeconds?: number
    } = {},
  ) {
    super(message)
  }
}
