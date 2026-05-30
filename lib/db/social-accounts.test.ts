import { vi, describe, it, expect } from 'vitest'
import { createMockClient } from './__test-utils__/mock-client'
import * as serviceModule from '@/lib/supabase/service'
import {
  listAllSocialAccounts,
  getSocialAccountById,
  createSocialAccount,
  updateSocialAccount,
  deactivateSocialAccount,
  getActiveByBusinessAndPlatform,
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

describe('getActiveByBusinessAndPlatform', () => {
  it('returns active account when found', async () => {
    const { client } = createMockClient(mockAccount)
    const result = await getActiveByBusinessAndPlatform(client, 'biz-1', 'linkedin')
    expect(result).toEqual(mockAccount)
    expect(client.from).toHaveBeenCalledWith('social_accounts')
  })

  it('returns null when no active account found', async () => {
    const { client } = createMockClient(null, null)
    const result = await getActiveByBusinessAndPlatform(client, 'biz-1', 'linkedin')
    expect(result).toBeNull()
  })

  it('throws when supabase returns an error', async () => {
    const { client } = createMockClient(null, { message: 'DB error' })
    await expect(getActiveByBusinessAndPlatform(client, 'biz-1', 'linkedin')).rejects.toThrow('DB error')
  })
})

describe('listByBusiness', () => {
  const publicAccount = {
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
      'platform, platform_username, platform_display_name, is_active, connected_at, token_expires_at',
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
