import 'dotenv/config'

import { requiredDatabaseUrl } from '../src/config/app.config.js'
import { seedDemoData } from './database-tools.js'

const count = await seedDemoData(requiredDatabaseUrl())
console.log('Ensured ' + count + ' demo items exist')
