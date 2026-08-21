import { describe, it, expect, beforeAll, afterAll } from 'vitest'

// ADR 0021 §4.6 [db-MAJOR-2] (Session 28 E5.7) — Tier 1, live Postgres. The
// persistence-time guard generateCard() (lib/signals/triage/card.ts) relies
// on: getEvidenceMemoryByIds(client, businessId, ids) is business_id-filtered,
// so a cross-tenant id is silently DROPPED, never returned — the mechanism
// that makes card.ts's `reFetchedEvidence.length !== verifiedEvidenceIds.length`
// check actually catch a cross-tenant id. Proven here against LIVE Postgres,
// not a mock: insight_cards.evidence is a jsonb id array with no FK, and RLS
// does not protect ids inside a blob, so this business_id filter is the
// SOLE tenancy boundary for it.

describe('cross-tenant evidence id rejected at card insert (ADR 0021 §4.6 [db-MAJOR-2], live Postgres)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let ownerAId: string
  let ownerBId: string
  let businessAId: string
  let businessBId: string
  let evidenceBId: string

  async function createUser(label: string) {
    const email = `signals3-card-evidence-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data, error } = await admin.auth.admin.createUser({ email, password: 'TestPass123!', email_confirm: true })
    if (error) throw error
    return data.user.id as string
  }

  async function insertBusiness(name: string, ownerId: string) {
    const { data, error } = await admin.from('businesses').insert({ name, owner_id: ownerId, plan: 'plus' }).select('id').single()
    if (error) throw error
    return data.id as string
  }

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    ownerAId = await createUser('owner-a')
    ownerBId = await createUser('owner-b')
    businessAId = await insertBusiness('Card Evidence Tenant Business A', ownerAId)
    businessBId = await insertBusiness('Card Evidence Tenant Business B', ownerBId)

    const { data: evB, error: evBErr } = await admin
      .from('evidence_memory')
      .insert({
        business_id: businessBId,
        source: 'manual',
        scope: 'brand',
        status: 'active',
        kind: 'quote',
        content: 'Business B evidence — must never be visible to Business A',
      })
      .select('id')
      .single()
    if (evBErr) throw evBErr
    evidenceBId = evB.id
  })

  afterAll(async () => {
    if (!admin) return
    await admin.from('evidence_memory').delete().eq('business_id', businessBId)
    await admin.from('businesses').delete().eq('id', businessAId)
    await admin.from('businesses').delete().eq('id', businessBId)
    for (const id of [ownerAId, ownerBId]) {
      if (id) await admin.auth.admin.deleteUser(id)
    }
  })

  it("getEvidenceMemoryByIds filtered by Business A's id returns ZERO rows for Business B's evidence id — the mechanism card.ts's persistence-time guard depends on", async () => {
    const { getEvidenceMemoryByIds } = await import('@/lib/db/memory-evidence')

    const rows = await getEvidenceMemoryByIds(admin, businessAId, [evidenceBId])

    // A cross-tenant id is silently dropped, never returned — this IS the
    // count mismatch (0 !== 1) that trips card.ts's evidence_tenant_mismatch
    // rejection, proven against live Postgres rather than asserted from a
    // mocked client's recorded call arguments.
    expect(rows).toHaveLength(0)
  })

  it("the SAME id, filtered by Business B's own id, IS returned — proving the zero-row result above is tenancy, not a broken id", async () => {
    const { getEvidenceMemoryByIds } = await import('@/lib/db/memory-evidence')

    const rows = await getEvidenceMemoryByIds(admin, businessBId, [evidenceBId])

    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(evidenceBId)
  })
})
