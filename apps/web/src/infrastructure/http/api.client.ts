import type { ApiFailure } from '@repo/contracts'

type ApiOptions = Omit<RequestInit, 'body'> & { body?: unknown }

function isFailure(value: unknown): value is ApiFailure {
  if (!value || typeof value !== 'object') return false
  const payload = value as Partial<ApiFailure>
  return typeof payload.error?.code === 'string'
}

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly failure?: ApiFailure,
    readonly fallbackCode = 'HTTP_' + status,
  ) {
    super(failure?.error.code ?? fallbackCode)
  }

  get errorCode(): string {
    return this.failure?.error.code ?? this.fallbackCode
  }
}

export class ApiTransportError extends Error {
  constructor() {
    super('NETWORK_ERROR')
  }
}

export class ApiClient {
  protected constructor() {}
  protected static basePath = '/api/v1'

  protected static readCookie(name: string): string | undefined {
    const prefix = encodeURIComponent(name) + '='
    return document.cookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(prefix))
      ?.slice(prefix.length)
  }

  protected static isMutation(method: string): boolean {
    return !['GET', 'HEAD', 'OPTIONS'].includes(method)
  }

  protected static async request<T>(path: string, options: ApiOptions = {}): Promise<T> {
    const { body: requestBody, ...requestInit } = options
    const method = requestInit.method?.toUpperCase() ?? 'GET'
    const headers = new Headers(requestInit.headers)
    headers.set('Accept', 'application/json')
    let body: BodyInit | undefined
    if (requestBody !== undefined) {
      if (requestBody instanceof FormData) {
        body = requestBody
      } else {
        body = JSON.stringify(requestBody)
        headers.set('Content-Type', 'application/json')
      }
    }
    if (this.isMutation(method)) {
      const csrfToken = this.readCookie('csrf_token')
      if (csrfToken) headers.set('X-CSRF-Token', decodeURIComponent(csrfToken))
    }

    let response: Response
    try {
      response = await fetch(this.basePath + path, {
        ...requestInit,
        method,
        headers,
        ...(body !== undefined ? { body } : {}),
        credentials: 'include',
      })
    } catch (error) {
      if (
        requestInit.signal?.aborted ||
        (error instanceof DOMException && error.name === 'AbortError')
      ) {
        throw error
      }
      throw new ApiTransportError()
    }

    if (response.status === 204 || response.status === 205) {
      if (!response.ok) throw new ApiClientError(response.status)
      return undefined as T
    }
    const contentType = response.headers.get('Content-Type') ?? ''
    const isJson = /(^|\/)json(\s*;|$)|\+json/i.test(contentType)
    let payload: unknown
    if (isJson) {
      try {
        payload = await response.json()
      } catch {
        payload = undefined
      }
    }

    if (!response.ok) {
      throw new ApiClientError(response.status, isFailure(payload) ? payload : undefined)
    }
    if (payload === undefined) {
      throw new ApiClientError(response.status, undefined, 'INVALID_RESPONSE')
    }
    return payload as T
  }

  static get<T>(path: string, options?: ApiOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: 'GET' })
  }
  static post<T>(path: string, body?: unknown, options?: ApiOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: 'POST', body })
  }
  static put<T>(path: string, body?: unknown, options?: ApiOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: 'PUT', body })
  }
  static patch<T>(path: string, body?: unknown, options?: ApiOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: 'PATCH', body })
  }
  static delete<T = void>(path: string, options?: ApiOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: 'DELETE' })
  }
}
