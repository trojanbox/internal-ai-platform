import { redirect, type ActionFunctionArgs } from 'react-router-dom'

import { ApiClientError } from '../../../infrastructure/http/api.client'
import { AuthenticationService } from '../services/authentication.service'

export async function loginAction({ request }: ActionFunctionArgs) {
  const formData = await request.formData()
  try {
    await AuthenticationService.login({
      email: String(formData.get('email') ?? ''),
      password: String(formData.get('password') ?? ''),
    })
    return redirect('/items')
  } catch (error) {
    if (error instanceof ApiClientError) return { errorCode: error.errorCode }
    return { errorCode: 'UNKNOWN' }
  }
}
