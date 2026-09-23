import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { PLAN_ANALYSIS_REASONS } from './types'
import { TOOL_LOOP_FAILURE_REASONS } from '@/lib/ai/tool-runner'

// ADR 0027 §3.3 (Session 34 K2.7 security review F3). The closed set of plan_analysis_reason values lives in
// TWO places that cannot import each other: the TypeScript list (lib/db/types.ts) and the CHECK in SQL. This
// Tier-2 test reads the migration TEXT so that adding a value to one and not the other is a red test, not a
// runtime 23514 the first time the planner hits that branch in production. (The CHECK itself is proved
// Tier-1 in supabase/__tests__/plan-proposals-version-scope.test.ts — a CHECK can only be proved against
// a live Postgres.)

const MIGRATION = path.join(process.cwd(), 'supabase', 'migrations', '20260923100000_plan_proposal_version_scope_and_reason_check.sql')

function reasonsInCheck(sql: string): string[] {
  const noComments = sql.replace(/--[^\n]*/g, '')
  const m = /campaign_briefs_plan_analysis_reason_check\s+CHECK\s*\(\s*plan_analysis_reason IS NULL OR plan_analysis_reason IN \(([\s\S]*?)\)\s*\)/.exec(noComments)
  if (!m) throw new Error('reason CHECK not found in the migration — this test would pass vacuously')
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1])
}

describe('plan_analysis_reason: the TypeScript list and the SQL CHECK agree', () => {
  it('the migration CHECK lists exactly PLAN_ANALYSIS_REASONS', () => {
    const inSql = reasonsInCheck(fs.readFileSync(MIGRATION, 'utf8'))
    expect(inSql.length).toBe(14)
    expect([...inSql].sort()).toEqual([...PLAN_ANALYSIS_REASONS].sort())
  })

  it('the list is the runtime loop-failure array plus the three orchestrator-level reasons', () => {
    expect([...PLAN_ANALYSIS_REASONS].sort()).toEqual([...TOOL_LOOP_FAILURE_REASONS, 'internal_error', 'no_brief', 'daily_cap'].sort())
  })

  it('the extractor sees a planted extra literal (planted)', () => {
    const planted = `ALTER TABLE t ADD CONSTRAINT campaign_briefs_plan_analysis_reason_check CHECK (plan_analysis_reason IS NULL OR plan_analysis_reason IN ('a_b', 'c_d'))`
    expect(reasonsInCheck(planted)).toEqual(['a_b', 'c_d'])
  })
})
