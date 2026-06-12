/**
 * Real-network integration test: enqueue an outbox row → drain → assert sent.
 *
 * OFF by default. Set EMAIL_INTEGRATION_TEST_ENABLED=true in .env.local plus:
 *   EMAIL_PROVIDER=resend
 *   RESEND_API_KEY=<live key>
 *   EMAIL_FROM, EMAIL_REPLY_TO
 *   SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL
 *
 * Uses delivered@resend.dev — Resend's guaranteed-deliver sandbox address.
 * Requires at least one business row in the database (uses the first found).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const INTEGRATION = process.env.EMAIL_INTEGRATION_TEST_ENABLED === 'true'

describe.skipIf(!INTEGRATION)('email drain round-trip (real Resend)', () => {
  let rowId: string | undefined

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    const client = createServiceRoleClient()

    const { data: business, error: bizErr } = await client
      .from('businesses')
      .select('id, language')
      .limit(1)
      .single()

    if (bizErr || !business) {
      throw new Error(
        `Round-trip setup: no business in DB — create one before running this test. ${bizErr?.message ?? ''}`,
      )
    }

    const { data: row, error: insertErr } = await client
      .from('email_outbox')
      .insert({
        business_id: business.id,
        kind: 'trial-warning-t3',
        recipient: 'delivered@resend.dev',
        locale: (business.language as string | null) ?? 'en',
        // Props shape must match trial-warning-t3 Zod schema; schema drift causes the live test to fail on send.
        props: {
          businessName: 'Integration Test',
          daysRemaining: 3,
          expiryDateIso: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
          upgradeUrl: 'https://sosh.app/billing',
        },
        status: 'pending',
        next_attempt_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (insertErr || !row) {
      throw new Error(`Round-trip setup: outbox insert failed. ${insertErr?.message ?? ''}`)
    }
    rowId = row.id as string
  })

  afterAll(async () => {
    if (!rowId) return
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    const client = createServiceRoleClient()
    await client.from('email_outbox').delete().eq('id', rowId)
  })

  it('drains outbox row and marks it sent with provider_message_id', async () => {
    const { runEmailDrainTick } = await import('@/lib/email/orchestrator')
    const summary = await runEmailDrainTick({ triggeredBy: 'secret' })

    expect(summary.claimed).toBeGreaterThanOrEqual(1)
    expect(summary.sent).toBeGreaterThanOrEqual(1)

    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    const client = createServiceRoleClient()
    const { data: row } = await client
      .from('email_outbox')
      .select('status, provider_message_id')
      .eq('id', rowId!)
      .single()

    expect(row?.status).toBe('sent')
    expect(row?.provider_message_id).toBeTruthy()
  })
})
