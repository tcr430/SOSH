import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGte = vi.fn()
const mockEq = vi.fn()
const mockSelect = vi.fn()
const mockFrom = vi.fn()

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(() => ({ from: mockFrom })),
}))

import { getCostThisMonth, getCallVolumeLast24h } from './metrics'

beforeEach(() => {
  vi.clearAllMocks()
  mockEq.mockReturnValue({ gte: mockGte })
  mockSelect.mockReturnValue({ eq: mockEq })
  mockFrom.mockReturnValue({ select: mockSelect })
})

describe('getCostThisMonth', () => {
  it('returns total cents summed from ai_usage rows', async () => {
    mockGte.mockResolvedValue({ data: [{ cost_cents: 150 }, { cost_cents: 75 }], error: null })
    const result = await getCostThisMonth('biz-1')
    expect(result).toEqual({ cents: 225 })
  })

  it('returns 0 when no rows exist', async () => {
    mockGte.mockResolvedValue({ data: [], error: null })
    const result = await getCostThisMonth('biz-1')
    expect(result).toEqual({ cents: 0 })
  })

  it('returns 0 when data is null', async () => {
    mockGte.mockResolvedValue({ data: null, error: null })
    const result = await getCostThisMonth('biz-1')
    expect(result).toEqual({ cents: 0 })
  })
})

describe('getCallVolumeLast24h', () => {
  it('returns count from ai_usage for the last 24h', async () => {
    mockGte.mockResolvedValue({ count: 42, error: null })
    const result = await getCallVolumeLast24h('biz-1')
    expect(result).toEqual({ count: 42 })
  })

  it('returns 0 when count is null', async () => {
    mockGte.mockResolvedValue({ count: null, error: null })
    const result = await getCallVolumeLast24h('biz-1')
    expect(result).toEqual({ count: 0 })
  })
})
