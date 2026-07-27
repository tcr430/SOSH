import { vi, describe, it, expect } from 'vitest'
import { createMockClient } from './__test-utils__/mock-client'
import * as serviceModule from '@/lib/supabase/service'
import { recordAiUsage, countRecentCalls, listAiUsageByBusiness, getLastSuccessfulCallAt } from './ai-usage'
import type { AiUsageRow, AiUsageInsert } from './types'
import type { SupabaseClient } from '@supabase/supabase-js'

function makeCountClient(count: number | null, error: { message: string } | null = null) {
  const result = { count, error }
  const builder: Record<string, unknown> = {
    then: (res: (v: unknown) => unknown) => Promise.resolve(result).then(res),
  }
  for (const m of ['select', 'eq', 'gte']) {
    builder[m] = vi.fn().mockReturnValue(builder)
  }
  const client = { from: vi.fn().mockReturnValue(builder) }
  return { client: client as unknown as SupabaseClient, builder }
}

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(),
}))

const mockUsage: AiUsageRow = {
  id: 'au-1',
  business_id: 'biz-1',
  prompt_id: 'brand-voice-inference',
  prompt_version: 1,
  model: 'claude-sonnet-4-6',
  input_tokens: 500,
  output_tokens: 200,
  cost_cents: 5,
  latency_ms: 1200,
  success: true,
  error_code: null,
  created_at: '2026-04-30T00:00:00Z',
}

describe('recordAiUsage', () => {
  const insertData: AiUsageInsert = {
    business_id: 'biz-1',
    prompt_id: 'brand-voice-inference',
    prompt_version: 1,
    model: 'claude-sonnet-4-6',
    input_tokens: 500,
    output_tokens: 200,
    cost_cents: 5,
    latency_ms: 1200,
    success: true,
  }

  it('returns the recorded AI usage', async () => {
    const { client } = createMockClient(mockUsage)
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)
    const result = await recordAiUsage(insertData)
    expect(result).toEqual(mockUsage)
    expect(client.from).toHaveBeenCalledWith('ai_usage')
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'Insert error' })
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)
    await expect(recordAiUsage(insertData)).rejects.toThrow('Insert error')
  })
})

describe('countRecentCalls', () => {
  it('filters by both business_id and prompt_id and returns count', async () => {
    const { client, builder } = makeCountClient(5)
    const result = await countRecentCalls(client, 'biz-1', 60, 'brand-voice-inference')
    expect(result).toBe(5)
    expect(builder.eq).toHaveBeenCalledWith('business_id', 'biz-1')
    expect(builder.eq).toHaveBeenCalledWith('prompt_id', 'brand-voice-inference')
  })

  it('returns 0 when count is null', async () => {
    const { client } = makeCountClient(null)
    expect(await countRecentCalls(client, 'biz-1', 60, 'test-prompt')).toBe(0)
  })

  it('throws when supabase returns an error', async () => {
    const { client } = makeCountClient(null, { message: 'DB error' })
    await expect(countRecentCalls(client, 'biz-1', 60, 'test-prompt')).rejects.toThrow('DB error')
  })
})

describe('listAiUsageByBusiness', () => {
  it('returns list of AI usage records', async () => {
    const { client } = createMockClient([mockUsage])
    const result = await listAiUsageByBusiness(client, 'biz-1')
    expect(result).toEqual([mockUsage])
    expect(client.from).toHaveBeenCalledWith('ai_usage')
  })

  it('returns empty array when none found', async () => {
    const { client } = createMockClient(null, null)
    const result = await listAiUsageByBusiness(client, 'biz-1')
    expect(result).toEqual([])
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'DB error' })
    await expect(listAiUsageByBusiness(client, 'biz-1')).rejects.toThrow('DB error')
  })
})

describe('getLastSuccessfulCallAt', () => {
  it('filters by business_id, prompt_id, and success=true, ordered/limited to the most recent', async () => {
    const { client, builder } = createMockClient({ created_at: '2026-07-01T00:00:00Z' }, null)
    const result = await getLastSuccessfulCallAt(client, 'biz-1', 'learning-summarizer')

    expect(result).toBe('2026-07-01T00:00:00Z')
    expect(client.from).toHaveBeenCalledWith('ai_usage')
    expect(builder.eq).toHaveBeenCalledWith('business_id', 'biz-1')
    expect(builder.eq).toHaveBeenCalledWith('prompt_id', 'learning-summarizer')
    expect(builder.eq).toHaveBeenCalledWith('success', true)
    expect(builder.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(builder.limit).toHaveBeenCalledWith(1)
  })

  it('returns null when no successful call has ever been recorded (never treated as an error)', async () => {
    const { client } = createMockClient(null, null)
    const result = await getLastSuccessfulCallAt(client, 'biz-1', 'learning-summarizer')
    expect(result).toBeNull()
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'DB error' })
    await expect(getLastSuccessfulCallAt(client, 'biz-1', 'learning-summarizer')).rejects.toThrow('DB error')
  })
})
