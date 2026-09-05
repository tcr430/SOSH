import { vi, describe, it, expect } from 'vitest'
import { createMockClient } from './__test-utils__/mock-client'
import * as serviceModule from '@/lib/supabase/service'
import {
  listAllSocialAccounts,
  getSocialAccountById,
  createSocialAccount,
  updateSocialAccount,
  deactivateSocialAccount,
  getActiveById,
  listActiveByBusinessAndPlatform,
  resolvePublishAccount,
  listByBusiness,
} from './social-accounts'
import type { SocialAccountRow, SocialAccountInsert, VaultSecretId } from './types'

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(),
}))

const mockAccount: SocialAccountRow = {
  id: 'sa-1',
  business_id: 'biz-1',
  platform: 'linkedin',
  platform_user_id: 'lnk-123',
  platform_username: 'acme_corp',
  platform_display_name: 'Acme Corp',
  vault_access_token_id: 'vault-1' as VaultSecretId,
  vault_refresh_token_id: null,
  token_expires_at: null,
  is_active: true,
  connected_at: '2026-04-30T00:00:00Z',
  created_at: '2026-04-30T00:00:00Z',
  updated_at: '2026-04-30T00:00:00Z',
}

describe('listAllSocialAccounts', () => {
  it('returns list of social accounts', async () => {
    const { client } = createMockClient([mockAccount])
    const result = await listAllSocialAccounts(client, 'biz-1')
    expect(result).toEqual([mockAccount])
    expect(client.from).toHaveBeenCalledWith('social_accounts')
  })

  it('applies limit', async () => {
    const { client, builder } = createMockClient([mockAccount])
    await listAllSocialAccounts(client, 'biz-1', 20)
    expect(builder.limit).toHaveBeenCalledWith(20)
  })

  it('returns empty array when none found', async () => {
    const { client } = createMockClient(null, null)
    const result = await listAllSocialAccounts(client, 'biz-1')
    expect(result).toEqual([])
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'DB error' })
    await expect(listAllSocialAccounts(client, 'biz-1')).rejects.toThrow('DB error')
  })
})

describe('getSocialAccountById', () => {
  it('returns a social account when found', async () => {
    const { client } = createMockClient(mockAccount)
    const result = await getSocialAccountById(client, 'sa-1')
    expect(result).toEqual(mockAccount)
    expect(client.from).toHaveBeenCalledWith('social_accounts')
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'DB error' })
    await expect(getSocialAccountById(client, 'sa-1')).rejects.toThrow('DB error')
  })

  it('throws when data is null', async () => {
    const { client } = createMockClient(null, null)
    await expect(getSocialAccountById(client, 'missing')).rejects.toThrow()
  })
})

describe('createSocialAccount', () => {
  const insertData: SocialAccountInsert = {
    business_id: 'biz-1',
    platform: 'linkedin',
    platform_user_id: 'lnk-123',
    platform_username: 'acme_corp',
    vault_access_token_id: 'vault-1' as VaultSecretId,
  }

  it('returns the created social account', async () => {
    const { client } = createMockClient(mockAccount)
    const result = await createSocialAccount(client, insertData)
    expect(result).toEqual(mockAccount)
    expect(client.from).toHaveBeenCalledWith('social_accounts')
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'Insert error' })
    await expect(createSocialAccount(client, insertData)).rejects.toThrow('Insert error')
  })
})

describe('updateSocialAccount', () => {
  it('returns the updated social account', async () => {
    const { client } = createMockClient(mockAccount)
    const result = await updateSocialAccount(client, 'sa-1', { is_active: false })
    expect(result).toEqual(mockAccount)
    expect(client.from).toHaveBeenCalledWith('social_accounts')
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'Update error' })
    await expect(updateSocialAccount(client, 'sa-1', { is_active: false })).rejects.toThrow('Update error')
  })
})

describe('deactivateSocialAccount', () => {
  it('deactivates account and deletes vault secret', async () => {
    const { client } = createMockClient(mockAccount)
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)
    await deactivateSocialAccount('sa-1')
    expect(client.from).toHaveBeenCalledWith('social_accounts')
    expect(client.rpc).toHaveBeenCalledWith('vault_delete_secret', {
      secret_id: mockAccount.vault_access_token_id,
    })
  })

  it('does not call rpc for refresh token when null', async () => {
    const { client } = createMockClient(mockAccount)
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)
    await deactivateSocialAccount('sa-1')
    expect(client.rpc).toHaveBeenCalledTimes(1)
  })

  it('deletes both vault secrets when refresh token exists', async () => {
    const accountWithRefresh: SocialAccountRow = {
      ...mockAccount,
      vault_refresh_token_id: 'vault-refresh-1' as VaultSecretId,
    }
    const { client } = createMockClient(accountWithRefresh)
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)
    await deactivateSocialAccount('sa-1')
    expect(client.rpc).toHaveBeenCalledTimes(2)
    expect(client.rpc).toHaveBeenCalledWith('vault_delete_secret', {
      secret_id: 'vault-refresh-1',
    })
  })

  it('does not throw when vault deletion fails (best-effort)', async () => {
    const { client } = createMockClient(mockAccount)
    client.rpc = vi.fn().mockRejectedValue(new Error('vault error'))
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)
    await expect(deactivateSocialAccount('sa-1')).resolves.toBeUndefined()
  })

  it('throws when account lookup or db update fails', async () => {
    const { client } = createMockClient(null, { message: 'Deactivate error' })
    vi.mocked(serviceModule.createServiceRoleClient).mockReturnValue(client)
    await expect(deactivateSocialAccount('sa-1')).rejects.toThrow()
  })
})

// ADR 0028 §5.3 (N2.5) — getActiveByBusinessAndPlatform's replacement: a
// by-id resolver, a list-returning resolver, and the shared publish-account
// resolver built on both.

describe('getActiveById', () => {
  it('returns the active account when found', async () => {
    const { client } = createMockClient(mockAccount)
    const result = await getActiveById(client, 'sa-1')
    expect(result).toEqual(mockAccount)
    expect(client.from).toHaveBeenCalledWith('social_accounts')
  })

  it('returns null when not found or inactive', async () => {
    const { client } = createMockClient(null, null)
    const result = await getActiveById(client, 'sa-1')
    expect(result).toBeNull()
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'DB error' })
    await expect(getActiveById(client, 'sa-1')).rejects.toThrow('DB error')
  })
})

describe('listActiveByBusinessAndPlatform', () => {
  const secondAccount: SocialAccountRow = { ...mockAccount, id: 'sa-2', platform_user_id: 'lnk-456' }

  it('returns the multi-row case — the whole point of replacing .maybeSingle()', async () => {
    const { client } = createMockClient([mockAccount, secondAccount])
    const result = await listActiveByBusinessAndPlatform(client, 'biz-1', 'linkedin')
    expect(result).toEqual([mockAccount, secondAccount])
  })

  it('applies an explicit bounded limit', async () => {
    const { client, builder } = createMockClient([mockAccount])
    await listActiveByBusinessAndPlatform(client, 'biz-1', 'linkedin', 5)
    expect(builder.limit).toHaveBeenCalledWith(5)
  })

  it('applies an explicit ORDER BY, not implicit ordering', async () => {
    const { client, builder } = createMockClient([mockAccount])
    await listActiveByBusinessAndPlatform(client, 'biz-1', 'linkedin')
    expect(builder.order).toHaveBeenCalledWith('connected_at', { ascending: false })
  })

  it('returns empty array when none found', async () => {
    const { client } = createMockClient(null, null)
    const result = await listActiveByBusinessAndPlatform(client, 'biz-1', 'linkedin')
    expect(result).toEqual([])
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'DB error' })
    await expect(listActiveByBusinessAndPlatform(client, 'biz-1', 'linkedin')).rejects.toThrow('DB error')
  })
})

describe('resolvePublishAccount — SOCIAL-DUAL-IDENTITY-RESOLVER', () => {
  const secondAccount: SocialAccountRow = { ...mockAccount, id: 'sa-2', platform_user_id: 'lnk-456' }

  it('a pinned social_account_id WINS over the business default', async () => {
    const { client } = createMockClient(mockAccount)
    const result = await resolvePublishAccount(client, 'biz-1', 'linkedin', 'sa-1')
    expect(result).toEqual({ outcome: 'resolved', account: mockAccount })
  })

  it('a pinned social_account_id that is gone/inactive resolves to none, never a silent substitution', async () => {
    const { client } = createMockClient(null, null)
    const result = await resolvePublishAccount(client, 'biz-1', 'linkedin', 'sa-missing')
    expect(result).toEqual({ outcome: 'none' })
  })

  it('no pin, exactly one active account: the business default is used', async () => {
    const { client } = createMockClient([mockAccount])
    const result = await resolvePublishAccount(client, 'biz-1', 'linkedin', null)
    expect(result).toEqual({ outcome: 'resolved', account: mockAccount })
  })

  it('no pin, zero active accounts: none', async () => {
    const { client } = createMockClient([])
    const result = await resolvePublishAccount(client, 'biz-1', 'linkedin', null)
    expect(result).toEqual({ outcome: 'none' })
  })

  it('AMBIGUITY CASE: no pin, two active accounts: ambiguous — nothing is silently chosen', async () => {
    const { client } = createMockClient([mockAccount, secondAccount])
    const result = await resolvePublishAccount(client, 'biz-1', 'linkedin', null)
    expect(result).toEqual({ outcome: 'ambiguous' })
  })
})

describe('listByBusiness', () => {
  const publicAccount = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    platform: 'linkedin' as const,
    platform_username: 'acme_corp',
    platform_display_name: 'Acme Corp',
    is_active: true,
    connected_at: '2026-04-30T00:00:00Z',
    token_expires_at: null,
  }

  it('returns public account list', async () => {
    const { client } = createMockClient([publicAccount])
    const result = await listByBusiness(client, 'biz-1')
    expect(result).toEqual([publicAccount])
    expect(client.from).toHaveBeenCalledWith('social_accounts')
  })

  it('selects only public columns (no vault IDs)', async () => {
    const { client, builder } = createMockClient([publicAccount])
    await listByBusiness(client, 'biz-1')
    expect(builder.select).toHaveBeenCalledWith(
      'id, platform, platform_username, platform_display_name, is_active, connected_at, token_expires_at',
    )
  })

  it('returns empty array when none found', async () => {
    const { client } = createMockClient(null, null)
    const result = await listByBusiness(client, 'biz-1')
    expect(result).toEqual([])
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'DB error' })
    await expect(listByBusiness(client, 'biz-1')).rejects.toThrow('DB error')
  })
})
