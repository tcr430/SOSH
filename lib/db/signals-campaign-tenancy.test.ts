import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSignalForCampaign } from './signals'

// ADR 0027 §2.3/§2.4 — AGENCY-TOOLS-TENANT-BOUND, Session 34-D D2 (MINOR-1). getSignalForCampaign is a
// three-hop walk (insight_cards -> signal_candidates -> signals), each hop carrying its OWN explicit
// .eq('business_id', ...) — "three chances to omit one". The Tier-1 tenancy test cannot see a single omission
// (the other hops still filter), so this recording client asserts, BY TABLE NAME, that business_id is applied
// on EACH hop. Tier 2: no database; the fake records every .eq() per .from().
//
// Production callers of getSignalForCampaign: lib/campaigns/planner/tools.ts:122 (the get_campaign_signal
// tool) only — exercised by lib/campaigns/planner/__tests__/tools.test.ts (mock client), the Tier-1
// supabase/__tests__/planner-tools-tenancy.test.ts (live), and this file (per-hop predicates).

const SIGNAL = { id: 'sig-1', business_id: 'biz-1', title: 'Release 1.0' }

function recordingClient() {
  const eqByTable: Record<string, Array<[string, unknown]>> = {}
  const rows: Record<string, unknown> = {
    insight_cards: { signal_candidate_id: 'cand-1' },
    signal_candidates: { signal_id: 'sig-1' },
    signals: SIGNAL,
  }
  const client = {
    from(table: string) {
      const calls = (eqByTable[table] ??= [])
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          calls.push([column, value])
          return builder
        },
        maybeSingle: async () => ({ data: rows[table], error: null }),
      }
      return builder
    },
  } as unknown as SupabaseClient
  return { client, eqByTable }
}

describe('getSignalForCampaign applies business_id on every hop (ADR 0027 §2.4, MINOR-1)', () => {
  it.each(['insight_cards', 'signal_candidates', 'signals'])('hop %s filters by the EXACT bound business_id', async (table) => {
    const { client, eqByTable } = recordingClient()
    const result = await getSignalForCampaign(client, 'biz-1', 'camp-1')
    expect(result).toEqual(SIGNAL)
    expect(eqByTable[table], `${table} was never queried`).toBeDefined()
    expect(eqByTable[table], `${table} lacks .eq('business_id', 'biz-1')`).toContainEqual(['business_id', 'biz-1'])
  })

  it('walks exactly the three hops, in order, and no other table', async () => {
    const { client, eqByTable } = recordingClient()
    await getSignalForCampaign(client, 'biz-1', 'camp-1')
    expect(Object.keys(eqByTable)).toEqual(['insight_cards', 'signal_candidates', 'signals'])
  })
})
