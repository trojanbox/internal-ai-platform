import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiClient } from './api.client'

afterEach(() => {
  vi.unstubAllGlobals()
  document.cookie = 'csrf_token=; Max-Age=0; Path=/'
})

describe('ApiClient', () => {
  it('sends CSRF token for mutation requests', async () => {
    document.cookie = 'csrf_token=csrf-value; Path=/'
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 0, message: '', data: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await ApiClient.post('/example', { hello: 'world' })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = new Headers(init.headers)
    expect(headers.get('X-CSRF-Token')).toBe('csrf-value')
    expect(init.credentials).toBe('include')
  })

  it('throws a typed error for API failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 401,
            message: 'Authentication required',
            data: {},
            error: { code: 'UNAUTHENTICATED', retryable: false },
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    )

    await expect(ApiClient.get('/items')).rejects.toMatchObject({
      status: 401,
      errorCode: 'UNAUTHENTICATED',
    })
  })

  it('supports subclass-specific HTTP boundaries', async () => {
    class CustomApiClient extends ApiClient {
      protected static override basePath = '/custom-api'
    }

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 0, message: '', data: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await CustomApiClient.get('/status')

    expect(fetchMock).toHaveBeenCalledWith('/custom-api/status', expect.any(Object))
  })
  it('supports PATCH, PUT and DELETE with CSRF and an empty 204 response', async () => {
    document.cookie = 'csrf_token=xyz; Path=/'
    const calls = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', calls)
    await expect(ApiClient.patch('/row/1', { name: 'Updated' })).resolves.toBeUndefined()
    await expect(ApiClient.put('/row/1', { name: 'Full' })).resolves.toBeUndefined()
    await expect(ApiClient.delete('/row/1')).resolves.toBeUndefined()
    expect(calls).toHaveBeenCalledTimes(3)
    for (const [, request] of calls.mock.calls as [string, RequestInit][]) {
      expect(new Headers(request.headers).get('X-CSRF-Token')).toBe('xyz')
    }
  })

  it('normalizes non-JSON errors without exposing an HTML failure body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<html>502 bad gateway</html>', {
          status: 502,
          headers: { 'Content-Type': 'text/html' },
        }),
      ),
    )
    await expect(ApiClient.get('/items')).rejects.toMatchObject({
      status: 502,
      errorCode: 'HTTP_502',
    })
  })

  it('rejects broken success payloads and distinguishes network errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('oops', { status: 200, headers: { 'Content-Type': 'application/json' } }),
        ),
    )
    await expect(ApiClient.get('/broken')).rejects.toMatchObject({ errorCode: 'INVALID_RESPONSE' })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network failure')))
    await expect(ApiClient.get('/broken')).rejects.toThrow('NETWORK_ERROR')
  })
})
