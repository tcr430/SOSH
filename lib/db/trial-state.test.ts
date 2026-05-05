import { describe, it, expect } from 'vitest'
import { createMockClient } from './__test-utils__/mock-client'
import { getTrialState } from './trial-state'
import type { TrialStateRow } from './types'

const mockTrialState: TrialStateRow = {
  id: 'ts-1',
  business_id: 'biz-1',
  trial_started_at: '2026-04-30T00:00:00Z',
  campaigns_created_count: 1,
  posts_generated_count: 10,
  work_email_verified: true,
  trial_card_fingerprint: 'fp-abc123',
  created_at: '2026-04-30T00:00:00Z',
  updated_at: '2026-04-30T00:00:00Z',
}

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
