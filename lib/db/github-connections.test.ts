import { describe, it, expect, vi, afterEach } from 'vitest'
import { createMockClient } from './__test-utils__/mock-client'

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(),
}))

import { createServiceRoleClient } from '@/lib/supabase/service'
import {
  getGithubConnectionByBusinessId,
  listConnectionsReadyForPoll,
  claimGithubConnectionForPoll,
  completeGithubConnectionPoll,
} from './github-connections'

const mockCreateServiceRoleClient = vi.mocked(createServiceRoleClient)

afterEach(() => {
  vi.clearAllMocks()
})

describe('lib/db/github-connections.ts (ADR 0020 §10.1)', () => {
  it('getGithubConnectionByBusinessId scopes to business_id (authenticated client)', async () => {
    const { client, builder } = createMockClient(null, null)
    await getGithubConnectionByBusinessId(client, 'biz-1')
    expect(builder.eq).toHaveBeenCalledWith('business_id', 'biz-1')
  })

  it('listConnectionsReadyForPoll is bounded and ORDER BY matches github_connections_poll_claim_idx (is_active, last_poll_started_at)', async () => {
    const { client, builder } = createMockClient([], null)
    mockCreateServiceRoleClient.mockReturnValue(client)

    await listConnectionsReadyForPoll(20)

    expect(builder.eq).toHaveBeenCalledWith('is_active', true)
    expect(builder.order).toHaveBeenCalledWith('last_poll_started_at', { ascending: true, nullsFirst: true })
    expect(builder.limit).toHaveBeenCalledWith(20)
  })

  it('listConnectionsReadyForPoll defaults its bound to 20', async () => {
    const { client, builder } = createMockClient([], null)
    mockCreateServiceRoleClient.mockReturnValue(client)

    await listConnectionsReadyForPoll()

    expect(builder.limit).toHaveBeenCalledWith(20)
  })

  it('claimGithubConnectionForPoll is an atomic conditional UPDATE guarded by is_active (L-11)', async () => {
    const { client, builder } = createMockClient(null, null)
    mockCreateServiceRoleClient.mockReturnValue(client)

    await claimGithubConnectionForPoll('conn-1')

    expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ last_poll_started_at: expect.any(String) }))
    expect(builder.eq).toHaveBeenCalledWith('id', 'conn-1')
    expect(builder.eq).toHaveBeenCalledWith('is_active', true)
  })

  it('completeGithubConnectionPoll states an explicit business_id predicate (§3.5)', async () => {
    const { client, builder } = createMockClient(null, null)
    mockCreateServiceRoleClient.mockReturnValue(client)

    await completeGithubConnectionPoll('conn-1', 'biz-1', 'ok')

    expect(builder.eq).toHaveBeenCalledWith('id', 'conn-1')
    expect(builder.eq).toHaveBeenCalledWith('business_id', 'biz-1')
  })
})
