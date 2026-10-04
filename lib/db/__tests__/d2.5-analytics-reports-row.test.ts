import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// REPORT-CASCADE-COMPLETE (ADR 0031 §13 constraint 28) — the §D2.5 row-presence half, as a Tier-2 file read. The SQL
// erasure behaviour is proven at runtime by supabase/__tests__/analytics-reports-purge.test.ts; this proves the row is
// actually recorded in the erasure-cascade document IN THE SAME COMMIT as the migration (CLAUDE.md standing rule: a
// business-scoped table omitted from D2.5 is a silent GDPR-erasure leak), and that the migration honours its own header.
const read = (...p: string[]) => fs.readFileSync(path.join(process.cwd(), ...p), 'utf8').replace(/\r\n/g, '\n')

describe('ADR 0010 Amendment 2 §D2.5 — analytics_reports row present (ADR 0031 §11)', () => {
  const legal = read('docs', 'decisions', '0010-legal-surface.md')
  const adr = read('docs', 'decisions', '0031-analytics-and-monthly-report.md')

  it('the row, verbatim per ADR 0031 §11', () => {
    expect(legal).toContain(
      '| analytics_reports | yes (business_id) | CASCADE | yes | none — cascade = erasure (stored monthly report snapshot: aggregates, template-sentence keys and params, exclusion counts and cited post ids of the customer\'s own posts; no post text; write-once, no authenticated write; ADR 0031) |',
    )
  })

  it('the row agrees with the ADR it was copied from (ADR 0031 §11 contains the same line)', () => {
    const adrRow = adr.split('\n').find((l) => l.startsWith('| analytics_reports |'))
    expect(adrRow, 'analytics_reports row missing from ADR 0031 §11').toBeDefined()
    expect(legal, 'the 0010 row differs from ADR 0031 §11').toContain(adrRow!.trimEnd())
  })

  it('the row sits directly AFTER the founder_interview_answers row, inside the D2.5 table', () => {
    const lines = legal.split('\n')
    const answers = lines.findIndex((l) => l.startsWith('| founder_interview_answers |'))
    expect(answers).toBeGreaterThan(0)
    expect(lines[answers + 1].startsWith('| analytics_reports |')).toBe(true)
    const heading = lines.findIndex((l) => l.startsWith('#### D2.5'))
    expect(heading).toBeGreaterThan(0)
    expect(heading).toBeLessThan(answers)
  })

  it('the businesses.report_email column has its dated note (a column on a cascaded table needs no row)', () => {
    expect(legal).toContain('**Session 37 O2.2 note (2026-10-04):**')
    expect(legal).toContain('`businesses.report_email`')
  })
})

describe('the analytics_reports migration honours its own header (ADR 0031 §11)', () => {
  const sql = read('supabase', 'migrations', '20261004120000_analytics_reports.sql')
  const code = sql
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n')

  it('creates NO SQL function (the DEFINER audit gate count must not move) and reuses reject_outcome_table_update', () => {
    expect(code).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i)
    expect(code).toMatch(/EXECUTE FUNCTION public\.reject_outcome_table_update\(\)/)
  })

  it('has no BEFORE DELETE trigger (the FK cascade and purge_business must still work)', () => {
    expect(code).not.toMatch(/BEFORE\s+DELETE/i)
    expect(code).toMatch(/BEFORE UPDATE ON public\.analytics_reports/)
  })

  it('the kind CHECK is the six prior kinds, copied from 20260709120000, plus monthly-report', () => {
    const kinds = (s: string) => [...s.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1])
    const prior = read('supabase', 'migrations', '20260709120000_email_outbox_team_invite_kind.sql')
    const priorKinds = kinds(prior.slice(prior.indexOf('CHECK')))
    expect(priorKinds).toHaveLength(6)
    const widened = code.slice(code.indexOf('email_outbox_kind_check\n  CHECK'))
    expect(kinds(widened.slice(0, widened.indexOf(');')))).toEqual([...priorKinds, 'monthly-report'])
  })

  it('declares the email_outbox policy change in its header rather than bundling it silently', () => {
    expect(sql).toMatch(/DECLARED HERE, NOT BUNDLED SILENTLY/)
    expect(code).toMatch(/ALTER POLICY email_outbox_select_own ON public\.email_outbox/)
  })
})
