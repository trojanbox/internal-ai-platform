import { z } from 'zod'

import type { ApiSuccess } from '../common/api.contract.js'

export const registerRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(15).max(256),
})

export const loginRequestSchema = registerRequestSchema

export const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  createdAt: z.string().datetime(),
})

export type RegisterRequest = z.infer<typeof registerRequestSchema>
export type LoginRequest = z.infer<typeof loginRequestSchema>
export type UserDto = z.infer<typeof userSchema>
export type AuthResponse = ApiSuccess<{ user: UserDto }>
