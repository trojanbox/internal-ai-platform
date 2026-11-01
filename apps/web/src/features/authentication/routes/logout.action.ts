import { redirect } from 'react-router-dom'

import { AuthenticationService } from '../services/authentication.service'

export async function logoutAction() {
  await AuthenticationService.logout()
  return redirect('/login')
}
