import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// ADR 0025 §8.3/§6.4 (Session 32 I2.13) — BACKFILL-STAGING-PURGED. One
// assertion file listing all FOUR paths that must purge social_backfill_posts
// staging rows for a run: ratify, discard, disconnect (I2.9, via
// deactivateSocialAccount -> discard_backfill_run), and the TTL sweep (I2.9).
// This is a diff-verified-style check over the actual migration SQL — a
// mocked RPC call proves nothing about what the SECURITY DEFINER function
// body actually does.

function migrationsText(): string {
  const dir = join(process.cwd(), 'supabase', 'migrations')
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n')
}

describe('BACKFILL-STAGING-PURGED — staging lifecycle', () => {
  const sql = migrationsText()
  const lib = readFileSync(join(process.cwd(), 'lib', 'db', 'social-accounts.ts'), 'utf8')

  it('ratify_backfill_run purges social_backfill_posts for the run', () => {
    const match = sql.match(
      /CREATE OR REPLACE FUNCTION public\.ratify_backfill_run[\s\S]*?\$\$;/g,
    )
    expect(match).not.toBeNull()
    for (const fn of match ?? []) {
      expect(fn).toMatch(/DELETE FROM public\.social_backfill_posts WHERE run_id = p_run_id/)
    }
  })

  it('discard_backfill_run purges social_backfill_posts for the run', () => {
    const match = sql.match(
      /CREATE OR REPLACE FUNCTION public\.discard_backfill_run[\s\S]*?\$\$;/g,
    )
    expect(match).not.toBeNull()
    for (const fn of match ?? []) {
      expect(fn).toMatch(/DELETE FROM public\.social_backfill_posts WHERE run_id = p_run_id/)
    }
  })

  it('disconnect (deactivateSocialAccount) discards any live run, which purges staging', () => {
    expect(lib).toMatch(/getLiveBackfillRunForAccount/)
    expect(lib).toMatch(/discardBackfillRun\(liveRun\.id, null\)/)
  })

  it('the TTL sweep purges expired staging directly', () => {
    const match = sql.match(
      /CREATE OR REPLACE FUNCTION public\.sweep_expired_backfill_staging[\s\S]*?\$\$;/g,
    )
    expect(match).not.toBeNull()
    for (const fn of match ?? []) {
      expect(fn).toMatch(/DELETE FROM public\.social_backfill_posts/)
    }
  })
})
