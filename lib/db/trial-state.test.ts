import { vi, describe, it, expect } from 'vitest'
import { createMockClient } from './__test-utils__/mock-client'
import * as serviceModule from '@/lib/supabase/service'
import { getTrialState, incrementBrandVoiceAttempts, incrementPostsGenerated, recordTrialCardFingerprint } from './trial-state'
import type { TrialStateRow } from './types'

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(),
}))

const mockTrialState: TrialStateRow = {
  id: 'ts-1',
  business_id: 'biz-1',
  trial_started_at: '2026-04-30T00:00:00Z',
  campaigns_created_count: 1,
  posts_generated_count: 10,
  brand_voice_inference_attempts: 0,
  work_email_verified: true,
  trial_card_fingerprint: 'fp-abc123',
  created_at: '2026-04-30T00:00:00Z',
  updated_at: '2026-04-30T00:00:00Z',
}

describe('incrementBrandVoiceAttempts', () => {
  it('calls rpc increment_brand_voice_attempts with the business_id', async () => {
    const { client } = createMockClient()
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)
    await incrementBrandVoiceAttempts('biz-1')
    expect(client.rpc).toHaveBeenCalledWith('increment_brand_voice_attempts', { p_business_id: 'biz-1' })
  })

  it('throws when rpc returns an error', async () => {
    const { client } = createMockClient()
    vi.mocked(client.rpc).mockResolvedValue({ data: null, error: { message: 'RPC error' } } as never)
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)
    await expect(incrementBrandVoiceAttempts('biz-1')).rejects.toThrow('RPC error')
  })
})

describe('incrementPostsGenerated', () => {
  it('calls rpc increment_posts_generated with the business_id', async () => {
    const { client } = createMockClient()
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)
    await incrementPostsGenerated('biz-1')
    expect(client.rpc).toHaveBeenCalledWith('increment_posts_generated', { p_business_id: 'biz-1' })
  })

  it('throws when rpc returns an error', async () => {
    const { client } = createMockClient()
    vi.mocked(client.rpc).mockResolvedValue({ data: null, error: { message: 'RPC error' } } as never)
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)
    await expect(incrementPostsGenerated('biz-1')).rejects.toThrow('RPC error')
  })
})

describe('getTrialState', () => {
  it('returns trial state when found', async () => {
    const { client } = createMockClient(mockTrialState)
    const result = await getTrialState(client, 'biz-1')
    expect(result).toEqual(mockTrialState)
    expect(client.from).toHaveBeenCalledWith('trial_state')
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'DB error' })
    await expect(getTrialState(client, 'biz-1')).rejects.toThrow('DB error')
  })

  it('throws when data is null', async () => {
    const { client } = createMockClient(null, null)
    await expect(getTrialState(client, 'missing')).rejects.toThrow()
  })
})

describe('recordTrialCardFingerprint', () => {
  it('resolves when fingerprint is set for the first time', async () => {
    const { client } = createMockClient(null, null)
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)
    await expect(
      recordTrialCardFingerprint({ businessId: 'biz-1', fingerprint: 'fp_test_abc123' })
    ).resolves.toBeUndefined()
    expect(client.from).toHaveBeenCalledWith('trial_state')
  })

  it('silently no-ops when fingerprint is already set (WHERE trial_card_fingerprint IS NULL excludes row)', async () => {
    const { client } = createMockClient(null, null)
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)
    await expect(
      recordTrialCardFingerprint({ businessId: 'biz-1', fingerprint: 'fp_test_abc123' })
    ).resolves.toBeUndefined()
  })

  it('throws on DB error', async () => {
    const { client } = createMockClient(null, { message: 'Update error' })
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)
    await expect(
      recordTrialCardFingerprint({ businessId: 'biz-1', fingerprint: 'fp_test_abc123' })
    ).rejects.toThrow('Update error')
  })
})
