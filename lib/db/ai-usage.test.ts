import { vi, describe, it, expect } from 'vitest'
import { createMockClient } from './__test-utils__/mock-client'
import * as serviceModule from '@/lib/supabase/service'
import { recordAiUsage, listAiUsageByBusiness } from './ai-usage'
import type { AiUsageRow, AiUsageInsert } from './types'

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
