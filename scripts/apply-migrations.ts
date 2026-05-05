import { config } from '../lib/config'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from 'pg'

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations')

async function run() {
  const dbUrl = config.server.DATABASE_URL
  if (!dbUrl) {
    console.error('DATABASE_URL is not set.')
    console.error(
      'Add it to .env.local — find it in Supabase Dashboard → Project Settings → Database → Connection string (URI).',
    )
    process.exit(1)
  }

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  if (files.length === 0) {
    console.log('No migration files found in', MIGRATIONS_DIR)
    return
  }

  console.log(`Applying ${files.length} migration(s) from ${MIGRATIONS_DIR}\n`)

  const client = new Client({ connectionString: dbUrl })
  await client.connect()

  let applied = 0
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8')
    process.stdout.write(`  ${file} … `)
    try {
      await client.query(sql)
      console.log('✓')
      applied++
    } catch (err) {
      console.log('✗')
      console.error(`\nFailed on: ${file}`)
      console.error((err as Error).message)
      await client.end()
      process.exit(1)
    }
  }

  await client.end()
  console.log(`\n${applied}/${files.length} migrations applied.`)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
