import { describe, it, expect, vi, beforeEach } from 'vitest'

// ADR 0026 §8.2 (J2.11) — the retrospective readers filter on business_id, are bounded and ordered, and the
// insert is ON CONFLICT (campaign_id) DO NOTHING (a campaign is evaluated ONCE — OUTCOME-TICK-IDEMPOTENT).

const calls: Array<[string, ...unknown[]]> = []
let queue: Array<{ data: unknown; error: unknown }> = []
const next = () => (queue.length > 1 ? queue.shift()! : queue[0] ?? { data: [], error: null })

function chain(table: string) {
  const c: Record<string, unknown> = {}
  const rec = (name: string) => (...args: unknown[]) => { calls.push([`${table}.${name}`, ...args]); return c }
  for (const m of ['select', 'eq', 'is', 'in', 'not', 'order', 'limit', 'upsert']) c[m] = rec(m)
  c.maybeSingle = () => Promise.resolve(next())
  c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(next()).then(res, rej)
  return c
}
vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: () => ({ from: chain }) }))

import {
  getFrozenBriefContent, insertCampaignRetrospective, listCampaignPostStates, listCampaignsAwaitingRetrospective, listOutcomesForCampaign,
} from './campaign-retrospectives'

beforeEach(() => {
  calls.length = 0
  queue = [{ data: [], error: null }]
})

describe('campaign-retrospectives readers', () => {
  it('insertCampaignRetrospective upserts ON CONFLICT (campaign_id) DO NOTHING and reports whether it wrote', async () => {
    queue = [{ data: [{ id: 'r' }], error: null }]
    expect(await insertCampaignRetrospective({ campaign_id: 'c' } as never)).toBe(true)
    expect(calls).toContainEqual(['campaign_retrospectives.upsert', { campaign_id: 'c' }, { onConflict: 'campaign_id', ignoreDuplicates: true }])
    queue = [{ data: [], error: null }]
    expect(await insertCampaignRetrospective({ campaign_id: 'c' } as never)).toBe(false)
  })

  it('listCampaignsAwaitingRetrospective filters business, orders newest first, bounds, and drops evaluated campaigns', async () => {
    queue = [
      { data: [{ id: 'c1', name: 'A' }, { id: 'c2', name: 'B' }], error: null },
      { data: [{ campaign_id: 'c1' }], error: null },
    ]
    expect(await listCampaignsAwaitingRetrospective('biz', 1e9)).toEqual([{ id: 'c2', name: 'B' }])
    expect(calls).toContainEqual(['campaigns.eq', 'business_id', 'biz'])
    expect(calls).toContainEqual(['campaigns.order', 'created_at', { ascending: false }])
    expect(calls).toContainEqual(['campaigns.limit', 100])
    expect(calls).toContainEqual(['campaign_retrospectives.eq', 'business_id', 'biz'])
  })

  it('listCampaignPostStates and listOutcomesForCampaign filter on business AND campaign, ordered and bounded', async () => {
    await listCampaignPostStates('biz', 'camp')
    await listOutcomesForCampaign('biz', 'camp', 5)
    expect(calls).toContainEqual(['posts.eq', 'business_id', 'biz'])
    expect(calls).toContainEqual(['posts.eq', 'campaign_id', 'camp'])
    expect(calls).toContainEqual(['posts.order', 'created_at', { ascending: false }])
    expect(calls).toContainEqual(['post_outcomes.eq', 'business_id', 'biz'])
    expect(calls).toContainEqual(['post_outcomes.eq', 'campaign_id', 'camp'])
    expect(calls).toContainEqual(['post_outcomes.limit', 5])
  })

  it('getFrozenBriefContent reads only a FROZEN, business-scoped brief', async () => {
    queue = [{ data: { content: { hypothesis: 'h' } }, error: null }]
    expect(await getFrozenBriefContent('biz', 'camp')).toEqual({ hypothesis: 'h' })
    expect(calls).toContainEqual(['campaign_briefs.eq', 'business_id', 'biz'])
    expect(calls).toContainEqual(['campaign_briefs.not', 'frozen_at', 'is', null])
  })
})
