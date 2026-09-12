import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// ADR 0016 §5.3 (B1 follow-up, migration 20260719020000) — the `recency_at`
// STORED generated column must compute exactly `COALESCE(last_confirmed_at,
// created_at)`, since lib/db/memory-*.ts orders on `recency_at` (PostgREST
// cannot express a raw COALESCE in `.order()`). A wrong formula here would
// silently corrupt retrieval ranking with no application-layer signal —
// this is DB-behaviour (Tier-1), not something a mocked-client Tier-2 test
// (lib/db/memory-*.test.ts) can prove.

const MEMORY_TABLES = ['brand_memory', 'evidence_memory', 'audience_memory', 'performance_memory'] as const

const DOMAIN_COLUMNS: Record<(typeof MEMORY_TABLES)[number], Record<string, unknown>> = {
  brand_memory: { category: 'positioning', statement: 'We integrate natively with every platform' },
  evidence_memory: { kind: 'quote', content: 'This tool saved us hours every week' },
  audience_memory: { kind: 'problem', statement: 'CTOs struggle to keep a consistent posting cadence' },
  performance_memory: { dimension: 'topic', pattern: 'technical-comparison posts perform well for CTO audiences' },
}

describe('governed-memory recency_at generated column (ADR 0016 §5.3)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let ownerId: string
  let businessId: string

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    const email = `govmem-recency-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data: user, error: userErr } = await admin.auth.admin.createUser({
      email,
      password: 'TestPass123!',
      email_confirm: true,
    })
    if (userErr) throw userErr
    ownerId = user.user.id

    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Governed Memory Recency Business', owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessId = biz.id
  })

  afterAll(async () => {
    if (!admin) return
    for (const table of MEMORY_TABLES) {
      await admin.from(table).delete().eq('business_id', businessId)
    }
    if (businessId) await admin.from('businesses').delete().eq('id', businessId)
    if (ownerId) await admin.auth.admin.deleteUser(ownerId)
  })

  it.each(MEMORY_TABLES)('%s: recency_at equals last_confirmed_at when set', async (table) => {
    const lastConfirmedAt = '2026-07-01T12:00:00Z'
    const { data: row, error } = await admin
      .from(table)
      .insert({
        business_id: businessId,
        source: 'manual',
        scope: 'brand',
        last_confirmed_at: lastConfirmedAt,
        ...DOMAIN_COLUMNS[table],
      })
      .select('recency_at, last_confirmed_at, created_at')
      .single()
    expect(error).toBeNull()
    expect(new Date(row.recency_at).toISOString()).toBe(new Date(lastConfirmedAt).toISOString())
  })

  it.each(MEMORY_TABLES)('%s: recency_at falls back to created_at when last_confirmed_at is NULL', async (table) => {
    const { data: row, error } = await admin
      .from(table)
      .insert({
        business_id: businessId,
        source: 'distilled',
        scope: 'brand',
        // last_confirmed_at intentionally omitted — a never-confirmed row.
        ...DOMAIN_COLUMNS[table],
        // ADR 0018 §7.2 (ADR 0016 Amendment B, C2.9 regression fix) —
        // performance_memory_distilled_requires_pattern_key CHECK
        // (supabase/migrations/20260726020000_performance_memory_pattern_key.sql)
        // rejects any source='distilled' row with a NULL pattern_key. This
        // fixture predates that constraint; only performance_memory needs
        // the extra column since the CHECK is scoped to that table/source.
        ...(table === 'performance_memory' ? { pattern_key: 'recency-fixture:distilled' } : {}),
      })
      .select('recency_at, last_confirmed_at, created_at')
      .single()
    expect(error).toBeNull()
    expect(row.last_confirmed_at).toBeNull()
    expect(new Date(row.recency_at).toISOString()).toBe(new Date(row.created_at).toISOString())
  })
})
