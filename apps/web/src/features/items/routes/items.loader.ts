import { itemListQuerySchema } from '@repo/contracts'
import { redirect, type LoaderFunctionArgs } from 'react-router-dom'

import { ApiClientError } from '../../../infrastructure/http/api.client'
import { ItemService } from '../services/item.service'

export async function itemsLoader({ request }: LoaderFunctionArgs) {
  const params = new URL(request.url).searchParams
  const parsed = itemListQuerySchema.safeParse({
    currentPage: params.get('currentPage') ?? undefined,
    pageSize: params.get('pageSize') ?? undefined,
  })
  if (!parsed.success) throw new Response('Invalid pagination query', { status: 400 })
  try {
    return { items: await ItemService.list(parsed.data, { signal: request.signal }) }
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 401) throw redirect('/login')
    throw error
  }
}
