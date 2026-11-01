import { redirect, type LoaderFunctionArgs } from 'react-router-dom'

import { ApiClientError } from '../../../infrastructure/http/api.client'
import { ItemService } from '../services/item.service'

export async function itemDetailLoader({ params, request }: LoaderFunctionArgs) {
  if (!params.itemId) throw new Response('Item id is required', { status: 400 })
  try {
    return { item: await ItemService.detail(params.itemId, { signal: request.signal }) }
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 401) throw redirect('/login')
    throw error
  }
}
