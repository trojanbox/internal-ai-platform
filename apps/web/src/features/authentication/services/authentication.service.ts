import type { AuthResponse, LoginRequest, RegisterRequest, UserDto } from '@repo/contracts'

import { ApiClient } from '../../../infrastructure/http/api.client'

export class AuthenticationService {
  protected constructor() {}

  static async login(input: LoginRequest): Promise<UserDto> {
    const response = await ApiClient.post<AuthResponse>('/auth/login', input)
    return response.data.user
  }

  static async register(input: RegisterRequest): Promise<UserDto> {
    const response = await ApiClient.post<AuthResponse>('/auth/register', input)
    return response.data.user
  }

  static async session(options?: { signal?: AbortSignal }): Promise<UserDto> {
    const response = await ApiClient.get<AuthResponse>('/auth/session', options)
    return response.data.user
  }

  static async logout(): Promise<void> {
    await ApiClient.post('/auth/logout')
  }
}
