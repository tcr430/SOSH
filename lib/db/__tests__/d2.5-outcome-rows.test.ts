import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// OUTCOME-CASCADE-COMPLETE (ADR 0026 §13 constraint 34) — the §D2.5 row-presence
// half, as a Tier-2/3 file-read. The SQL erasure behaviour is proven at runtime by
// supabase/__tests__/outcome-tables-purge.test.ts; this proves the three rows are
// actually recorded in the erasure-cascade document, per the CLAUDE.md standing
// rule (a business-scoped table omitted from D2.5 is a silent erasure leak).
describe('ADR 0010 Amendment 2 §D2.5 — post_dimensions / post_outcomes / campaign_retrospectives rows present', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'docs', 'decisions', '0010-legal-surface.md'), 'utf8')

  it('post_dimensions, verbatim per ADR 0026 §11', () => {
    expect(source).toContain(
      "| post_dimensions | yes (business_id + post_id + ai_original_id) | CASCADE | yes | none — cascade = erasure (generation-time tags of the customer's posts; no content; ADR 0026 §4.2) |",
    )
  })

  it('post_outcomes, verbatim per ADR 0026 §11', () => {
    expect(source).toContain(
      '| post_outcomes | yes (business_id + post_id) | CASCADE | yes | none — cascade = erasure (per-post engagement measurements and baselines; no content; ADR 0026 §6.1) |',
    )
  })

  it('campaign_retrospectives, verbatim per ADR 0026 §11', () => {
    expect(source).toContain(
      "| campaign_retrospectives | yes (business_id + campaign_id) | CASCADE | yes | none — cascade = erasure (holds the customer's hypothesis text and an optional member note; ADR 0026 §8.3) |",
    )
  })

  it('the rows agree with the ADR they were copied from (ADR 0026 §11 contains the same three lines)', () => {
    const adr = fs.readFileSync(path.join(process.cwd(), 'docs', 'decisions', '0026-outcome-loop.md'), 'utf8')
    for (const table of ['post_dimensions', 'post_outcomes', 'campaign_retrospectives']) {
      const adrRow = adr.split('\n').find((l) => l.startsWith(`| ${table} |`))
      expect(adrRow, `${table} row missing from ADR 0026 §11`).toBeDefined()
      expect(source, `${table} row in 0010 differs from ADR 0026 §11`).toContain(adrRow!.trimEnd())
    }
  })
})
