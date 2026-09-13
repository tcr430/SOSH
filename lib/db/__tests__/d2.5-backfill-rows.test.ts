import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// BACKFILL-CASCADE-COMPLETE (ADR 0025 §12 constraint 48) — the §D2.5
// row-presence half, as a Tier-2 file-read (not the SQL cascade test,
// supabase/__tests__/backfill-cascade.test.ts, which proves the runtime
// behavior; this proves the two rows are actually recorded in the
// erasure-cascade document per the CLAUDE.md standing rule).
describe('ADR 0010 Amendment 2 §D2.5 — social_backfill_runs / social_backfill_posts rows present', () => {
  it('both rows exist, verbatim per ADR 0025 §9.2', () => {
    const filePath = path.join(process.cwd(), 'docs', 'decisions', '0010-legal-surface.md')
    const source = fs.readFileSync(filePath, 'utf8')

    expect(source).toContain(
      '| social_backfill_runs | yes (business_id + social_account_id) | CASCADE (both) | yes | none — cascade = erasure (holds `staged_voice`, which may include verbatim post excerpts, and account statistics; ADR 0025 §9.1) |',
    )
    expect(source).toContain(
      "| social_backfill_posts | yes (business_id + run_id) | CASCADE (both) | yes | none — cascade = erasure (holds the customer's own imported post text, which may quote third parties; short-lived by design, ADR 0025 §8.3) |",
    )
  })
})
