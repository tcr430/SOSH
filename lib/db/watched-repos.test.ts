import { describe, it, expect, vi, afterEach } from 'vitest'
import { createMockClient } from './__test-utils__/mock-client'

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(),
}))

import { createServiceRoleClient } from '@/lib/supabase/service'
import {
  listWatchedReposForBusiness,
  countActiveWatchedReposForBusiness,
  listActiveWatchedReposForConnection,
  setWatchedRepoActive,
  updateWatchedRepoPollCursor,
} from './watched-repos'

const mockCreateServiceRoleClient = vi.mocked(createServiceRoleClient)

afterEach(() => {
  vi.clearAllMocks()
})

describe('lib/db/watched-repos.ts (ADR 0020 §10.1)', () => {
  it('listWatchedReposForBusiness is bounded and ORDER BY repo_id matches UNIQUE(business_id, repo_id)', async () => {
    const { client, builder } = createMockClient([], null)
    await listWatchedReposForBusiness(client, 'biz-1', 20)
    expect(builder.eq).toHaveBeenCalledWith('business_id', 'biz-1')
    expect(builder.order).toHaveBeenCalledWith('repo_id', { ascending: true })
    expect(builder.limit).toHaveBeenCalledWith(20)
  })

  it('listWatchedReposForBusiness defaults its bound to 20 (the watch-list cap)', async () => {
    const { client, builder } = createMockClient([], null)
    await listWatchedReposForBusiness(client, 'biz-1')
    expect(builder.limit).toHaveBeenCalledWith(20)
  })

  it('countActiveWatchedReposForBusiness scopes to business_id and is_active', async () => {
    const { client, builder } = createMockClient(null, null)
    await countActiveWatchedReposForBusiness(client, 'biz-1')
    expect(builder.eq).toHaveBeenCalledWith('business_id', 'biz-1')
    expect(builder.eq).toHaveBeenCalledWith('is_active', true)
  })

  it('listActiveWatchedReposForConnection is bounded and filters on connection_id (matches watched_repos_connection_id_idx), plus an explicit business_id predicate', async () => {
    const { client, builder } = createMockClient([], null)
    mockCreateServiceRoleClient.mockReturnValue(client)

    await listActiveWatchedReposForConnection('conn-1', 'biz-1', 20)

    expect(builder.eq).toHaveBeenCalledWith('connection_id', 'conn-1')
    expect(builder.eq).toHaveBeenCalledWith('business_id', 'biz-1')
    expect(builder.limit).toHaveBeenCalledWith(20)
  })

  it('setWatchedRepoActive is a tenancy-scoped conditional UPDATE (§3.5 no-DELETE-policy: unwatching is is_active=false)', async () => {
    const { client, builder } = createMockClient(null, null)
    await setWatchedRepoActive(client, 'repo-1', 'biz-1', false)
    expect(builder.update).toHaveBeenCalledWith({ is_active: false })
    expect(builder.eq).toHaveBeenCalledWith('id', 'repo-1')
    expect(builder.eq).toHaveBeenCalledWith('business_id', 'biz-1')
  })

  it('updateWatchedRepoPollCursor states an explicit business_id predicate (§3.5)', async () => {
    const { client, builder } = createMockClient(null, null)
    mockCreateServiceRoleClient.mockReturnValue(client)

    await updateWatchedRepoPollCursor('repo-1', 'biz-1', '"new-etag"')

    expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ releases_etag: '"new-etag"' }))
    expect(builder.eq).toHaveBeenCalledWith('id', 'repo-1')
    expect(builder.eq).toHaveBeenCalledWith('business_id', 'biz-1')
  })
})
