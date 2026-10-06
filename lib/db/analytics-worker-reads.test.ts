import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TenantMismatchError } from '@/lib/reports/isolation'

// Session 37-D D1 (MAJOR-4, security-reviewer LOW): the worker's patterns binding asserts ownership on the RAW rows, before the
// eligibility filter and the cap, so a foreign row that the selection would have dropped still fails the run.
const mocks = vi.hoisted(() => ({ listOutcomePatterns: vi.fn(), service: { tag: 'service-role-client' } }))
vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: () => mocks.service }))
vi.mock('./memory-performance', () => ({ listOutcomePatterns: mocks.listOutcomePatterns }))

import { analyticsWorkerReaders } from './analytics-worker-reads'

const A = 'biz-a'
const B = 'biz-b'
const row = (businessId: string, over: Record<string, unknown> = {}) => ({
  id: 'p', business_id: businessId, source: 'outcome', confidence: 0.5, observation_count: 10, status: 'active', sensitivity: 'internal', public_use_permission: false,
  scope: 'platform', scope_ref: 'twitter', last_confirmed_at: '2026-03-20T00:00:00Z', recency_at: '2026-03-20T00:00:00Z', expires_at: null, deleted_at: null,
  created_at: '2026-03-01T00:00:00Z', updated_at: '2026-03-20T00:00:00Z', import_run_id: null, import_source_post_ids: null, dimension: 'format',
  pattern: 'P.', platform: 'twitter', pattern_key: 'outcome:format:k:above:twitter', outcome_n: 10, outcome_wins: 7, outcome_distinct_campaigns: 3,
  interval_low: 0.4, interval_high: 0.9, metric_basis: 'rate', baseline_seeded: false, contradicted_at: null, ...over,
})

beforeEach(() => mocks.listOutcomePatterns.mockReset())

describe('analyticsWorkerReaders().listPatterns', () => {
  it('reads active rows of the business with the SERVICE-ROLE client and returns the selection', async () => {
    mocks.listOutcomePatterns.mockResolvedValue([row(A)])
    const out = await analyticsWorkerReaders().listPatterns(A, { platform: 'twitter' })
    expect(mocks.listOutcomePatterns).toHaveBeenCalledWith(mocks.service, A, { status: 'active', platform: 'twitter' })
    expect(out).toEqual([{ business_id: A, pattern_key: 'outcome:format:k:above:twitter', platform: 'twitter', pattern: 'P.', wins: 7, n: 10, campaigns: 3 }])
  })

  it('a foreign row that the selection WOULD DROP (expired, candidate, hypothesis, over the cap) still throws TenantMismatchError', async () => {
    for (const dropped of [{ status: 'candidate' }, { expires_at: '2020-01-01T00:00:00Z' }, { dimension: 'hypothesis' }, { outcome_n: null }]) {
      mocks.listOutcomePatterns.mockResolvedValue([row(A), row(B, dropped)])
      await expect(analyticsWorkerReaders().listPatterns(A, {}), JSON.stringify(dropped)).rejects.toBeInstanceOf(TenantMismatchError)
    }
  })

  it('a row with no business_id is a mismatch too', async () => {
    mocks.listOutcomePatterns.mockResolvedValue([row(A, { business_id: undefined })])
    await expect(analyticsWorkerReaders().listPatterns(A, {})).rejects.toBeInstanceOf(TenantMismatchError)
  })
})
