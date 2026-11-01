import 'dotenv/config'

import { requiredDatabaseUrl } from '../src/config/app.config.js'
import { migrateDatabase } from './database-tools.js'

await migrateDatabase(requiredDatabaseUrl())
console.log('Migrations applied')
