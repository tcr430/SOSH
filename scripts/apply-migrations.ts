import { config } from '../lib/config'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from 'pg'

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations')

const CREATE_TRACKING_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`

async function getApplied(client: Client): Promise<Set<string>> {
  const { rows } = await client.query<{ version: string }>(
    'SELECT version FROM schema_migrations ORDER BY version',
  )
  return new Set(rows.map((r) => r.version))
}

async function run() {
  const seed = process.argv.includes('--seed')

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

  const client = new Client({ connectionString: dbUrl })
  await client.connect()

  await client.query(CREATE_TRACKING_TABLE)
  const applied = await getApplied(client)

  // --seed: mark all files as applied without running SQL.
  // Use this once when schema_migrations is empty but the DB already has tables.
  if (seed) {
    const toSeed = files.filter((f) => !applied.has(f))
    if (toSeed.length === 0) {
      console.log('Nothing to seed — all migrations already tracked.')
      await client.end()
      return
    }
    for (const file of toSeed) {
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING', [file])
      console.log(`  seeded: ${file}`)
    }
    console.log(`\n${toSeed.length} migration(s) marked as applied without running SQL.`)
    await client.end()
    return
  }

  const pending = files.filter((f) => !applied.has(f))
  const skipped = files.length - pending.length

  if (skipped > 0) {
    console.log(`Skipping ${skipped} already-applied migration(s).`)
  }

  if (pending.length === 0) {
    console.log('Nothing to apply — database is up to date.')
    await client.end()
    return
  }

  console.log(`Applying ${pending.length} pending migration(s) from ${MIGRATIONS_DIR}\n`)

  let appliedCount = 0
  for (const file of pending) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8')
    process.stdout.write(`  ${file} … `)
    try {
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file])
      console.log('✓')
      appliedCount++
    } catch (err) {
      console.log('✗')
      console.error(`\nFailed on: ${file}`)
      console.error((err as Error).message)
      await client.end()
      process.exit(1)
    }
  }

  await client.end()
  console.log(`\n${appliedCount}/${pending.length} migrations applied.`)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
