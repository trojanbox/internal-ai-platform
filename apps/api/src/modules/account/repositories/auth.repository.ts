import { Injectable } from '@nestjs/common'
import { and, eq } from 'drizzle-orm'

import { DatabaseService } from '../../infrastructure/database/database.service.js'
import { activeRecord } from '../../infrastructure/database/active-record.js'
import { users } from '../../infrastructure/database/schema/index.js'

@Injectable()
export class AuthRepository {
  constructor(private readonly database: DatabaseService) {}

  async findUserByEmail(email: string) {
    const [user] = await this.database.db
      .select()
      .from(users)
      .where(and(eq(users.email, email), activeRecord(users)))
      .limit(1)
    return user
  }

  async findActiveUserById(userId: string) {
    const [user] = await this.database.db
      .select({ id: users.id, email: users.email, createdAt: users.createdAt })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.isActive, true), activeRecord(users)))
      .limit(1)
    return user
  }

  async createUser(input: { id: string; email: string; passwordHash: string; createdAt: Date }) {
    const [user] = await this.database.db
      .insert(users)
      .values({ ...input, isActive: true })
      .onConflictDoNothing({ target: users.email })
      .returning()
    return user
  }
}
