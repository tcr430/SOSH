import { describe, it, expect, expectTypeOf } from 'vitest'
import type { PerformanceMemoryRow, PerformanceMemoryUpdate } from '@/lib/db/types'

// ADR 0026 §5.3 / §5.5 (J2.5) — the TypeScript half of OUTCOME-WRITE-PROTECTED. The database
// rejects a client's forged provenance or statistics (supabase/__tests__/
// performance-memory-outcome-schema.test.ts); this proves the codebase's own PATCH type cannot
// even express it. The expectTypeOf assertions are enforced by `npm run typecheck` (tsc includes
// test files); the runtime assertion exists so the file is not an "executed zero tests" false-green.

describe('PerformanceMemoryRow / PerformanceMemoryUpdate (ADR 0026 §5)', () => {
  it('the row type gains every outcome column, nullable (they are null on every non-outcome row)', () => {
    expectTypeOf<PerformanceMemoryRow['outcome_n']>().toEqualTypeOf<number | null>()
    expectTypeOf<PerformanceMemoryRow['outcome_wins']>().toEqualTypeOf<number | null>()
    expectTypeOf<PerformanceMemoryRow['outcome_distinct_campaigns']>().toEqualTypeOf<number | null>()
    expectTypeOf<PerformanceMemoryRow['interval_low']>().toEqualTypeOf<number | null>()
    expectTypeOf<PerformanceMemoryRow['interval_high']>().toEqualTypeOf<number | null>()
    expectTypeOf<PerformanceMemoryRow['metric_basis']>().toEqualTypeOf<'rate' | 'count' | null>()
    expectTypeOf<PerformanceMemoryRow['baseline_seeded']>().toEqualTypeOf<boolean | null>()
    expectTypeOf<PerformanceMemoryRow['contradicted_at']>().toEqualTypeOf<string | null>()
    expectTypeOf<'outcome'>().toExtend<PerformanceMemoryRow['source']>()
    expect(true).toBe(true)
  })

  it('the Update type EXCLUDES source, pattern_key and every stats column', () => {
    type UpdateKey = keyof PerformanceMemoryUpdate
    expectTypeOf<'source'>().not.toExtend<UpdateKey>()
    expectTypeOf<'pattern_key'>().not.toExtend<UpdateKey>()
    expectTypeOf<'outcome_n'>().not.toExtend<UpdateKey>()
    expectTypeOf<'outcome_wins'>().not.toExtend<UpdateKey>()
    expectTypeOf<'outcome_distinct_campaigns'>().not.toExtend<UpdateKey>()
    expectTypeOf<'interval_low'>().not.toExtend<UpdateKey>()
    expectTypeOf<'interval_high'>().not.toExtend<UpdateKey>()
    expectTypeOf<'metric_basis'>().not.toExtend<UpdateKey>()
    expectTypeOf<'baseline_seeded'>().not.toExtend<UpdateKey>()
    expectTypeOf<'contradicted_at'>().not.toExtend<UpdateKey>()
    // tenancy-critical / immutable / derived, per CLAUDE.md's *Update rule
    expectTypeOf<'business_id'>().not.toExtend<UpdateKey>()
    expectTypeOf<'deleted_at'>().not.toExtend<UpdateKey>()
    expectTypeOf<'import_run_id'>().not.toExtend<UpdateKey>()
    expectTypeOf<'recency_at'>().not.toExtend<UpdateKey>()
    expect(true).toBe(true)
  })

  it('what a member may legitimately edit is still expressible', () => {
    expectTypeOf<'pattern'>().toExtend<keyof PerformanceMemoryUpdate>()
    expectTypeOf<'status'>().toExtend<keyof PerformanceMemoryUpdate>()
    expect(true).toBe(true)
  })
})
