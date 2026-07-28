import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { listPerformanceMemoryCandidates } from '@/lib/db/memory-performance'

// [Session 25-D correction, MINOR-6] Tier-1, live Postgres — proves the
// expires_at filter added to listPerformanceMemoryCandidates is a genuine
// outcome, not just a query-builder call: an expired 'active' row must NOT
// be returned, and a NULL-expires_at row (manual/import rows never get one)
// must still be returned. A mocked client cannot simulate real filter
// evaluation, so this is the only place this property can actually be
// proven, per docs/reviews/session-25-reviewer.md MINOR-6.

describe('listPerformanceMemoryCandidates — expires_at decay (ADR 0018 §7.1, MINOR-6)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let ownerId: string
  let businessId: string

  async function createUser(label: string) {
    const email = `perfmem-expiry-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: 'TestPass123!',
      email_confirm: true,
    })
    if (error) throw error
    return { id: data.user.id as string, email }
  }

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    const owner = await createUser('owner')
    ownerId = owner.id

    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Expiry Filter Business', owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessId = biz.id
  })

  afterAll(async () => {
    if (!admin) return
    if (businessId) {
      await admin.from('performance_memory').delete().eq('business_id', businessId)
      await admin.from('businesses').delete().eq('id', businessId)
    }
    if (ownerId) await admin.auth.admin.deleteUser(ownerId)
  })

  it('excludes an expired active row and includes a NULL-expires_at row', async () => {
    const now = new Date()
    const past = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
    const future = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()

    const { error: expiredErr } = await admin.from('performance_memory').insert({
      business_id: businessId,
      source: 'distilled',
      status: 'active',
      scope: 'brand',
      dimension: 'topic',
      pattern: 'A 90-day-stale pattern that should no longer reach generation',
      pattern_key: `expiry-expired-${Date.now()}`,
      observation_count: 5,
      confidence: 0.8,
      expires_at: past,
    })
    expect(expiredErr).toBeNull()

    const { error: nullExpiryErr } = await admin.from('performance_memory').insert({
      business_id: businessId,
      source: 'manual',
      status: 'active',
      scope: 'brand',
      dimension: 'topic',
      pattern: 'A manually-entered pattern with no expiry',
      pattern_key: null,
      observation_count: 1,
      confidence: 0.9,
      expires_at: null,
    })
    expect(nullExpiryErr).toBeNull()

    const { error: freshErr } = await admin.from('performance_memory').insert({
      business_id: businessId,
      source: 'distilled',
      status: 'active',
      scope: 'brand',
      dimension: 'topic',
      pattern: 'A fresh pattern well inside its 90-day window',
      pattern_key: `expiry-fresh-${Date.now()}`,
      observation_count: 5,
      confidence: 0.8,
      expires_at: future,
    })
    expect(freshErr).toBeNull()

    const results = await listPerformanceMemoryCandidates(admin, businessId, 50)
    const patterns = results.map((r) => r.pattern)

    expect(patterns).not.toContain('A 90-day-stale pattern that should no longer reach generation')
    expect(patterns).toContain('A manually-entered pattern with no expiry')
    expect(patterns).toContain('A fresh pattern well inside its 90-day window')
  })
})
