import { redirect, type LoaderFunctionArgs } from 'react-router-dom'

import { ApiClientError } from '../../../infrastructure/http/api.client'
import { AuthenticationService } from '../services/authentication.service'

export async function sessionLoader({ request }: LoaderFunctionArgs) {
  try {
    return { user: await AuthenticationService.session({ signal: request.signal }) }
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 401) throw redirect('/login')
    throw error
  }
}
