import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createWorld, destroyWorld, seedCell, outcomeKey, type World } from '../__helpers__/outcome-fixtures'
import { insertPostOutcome } from '@/lib/db/post-outcomes'
import { upsertOutcomePattern, promoteOutcomePattern } from '@/lib/db/memory-performance'

// OUTCOME-TICK-IDEMPOTENT (ADR 0026 §7, constraint 32) — Tier 1. A replayed extract-outcomes tick must change
// no row: the same outcome insert and the same cell upsert applied twice leave ONE row with identical values.

describe('OUTCOME-TICK-IDEMPOTENT over the real database', () => {
  let w: World
  beforeEach(async () => {
    w = await createWorld('tick-idem')
  })
  afterEach(async () => {
    await destroyWorld(w)
  })

  it('the same outcome insert applied twice -> one row, identical values, second call reports no write', async () => {
    await seedCell(w, { role: 'customer_proof', wins: 1, losses: 0, campaigns: 1 })
    const { data: rows } = await w.admin.from('post_outcomes').select('*').eq('business_id', w.businessId)
    expect(rows).toHaveLength(1)
    const original = rows[0]

    // Replay the very same insert, with a DIFFERENT value: ON CONFLICT DO NOTHING must keep the frozen one.
    expect(await insertPostOutcome({ ...original, value: 999 })).toBe(false)
    expect(await insertPostOutcome(original)).toBe(false)

    const { data: after } = await w.admin.from('post_outcomes').select('*').eq('business_id', w.businessId)
    expect(after).toEqual(rows)
  })

  it('the same cell upsert (and promote) applied twice -> one row, identical stats', async () => {
    await seedCell(w, { role: 'customer_proof', wins: 9, losses: 1, campaigns: 3 })
    const call = () => upsertOutcomePattern({
      business_id: w.businessId, dimension: 'role', value: 'customer_proof', platform: 'linkedin',
      direction: 'above', pattern: "On LinkedIn, customer proof posts beat this brand's usual engagement count.",
    })
    // updated_at is bumped by the set_updated_at trigger on the ON CONFLICT path; every stat and value is what must not move.
    const stable = <T extends { updated_at?: string } | null>(row: T) => (row === null ? row : { ...row, updated_at: undefined })
    const first = await call()
    const second = await call()
    expect(stable(second)).toEqual(stable(first))

    const key = outcomeKey('role', 'customer_proof', 'above', 'linkedin')
    expect((await promoteOutcomePattern(w.businessId, key))?.status).toBe('active')
    expect(await promoteOutcomePattern(w.businessId, key)).toBeNull() // replay: nothing left to promote

    const third = await call()
    expect(third).toMatchObject({ status: 'active', outcome_n: 10, outcome_wins: 9, outcome_distinct_campaigns: 3 })
    const { data: mem } = await w.admin.from('performance_memory').select('id').eq('business_id', w.businessId).eq('source', 'outcome')
    expect(mem).toHaveLength(1)
  })
})
