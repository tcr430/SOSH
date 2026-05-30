import { describe, it, expect } from 'vitest'
import { addDays, formatISO } from 'date-fns'
import { getConnectionStatus } from './connection-status'
import type { SocialAccountRow, VaultSecretId } from '@/lib/db/types'

const VAULT_ID = 'vault-test-uuid' as VaultSecretId

function makeAccount(overrides: Partial<SocialAccountRow> = {}): SocialAccountRow {
  return {
    id: 'acc-1',
    business_id: 'biz-1',
    platform: 'linkedin',
    platform_user_id: 'u1',
    platform_username: 'testuser',
    platform_display_name: 'Test User',
    vault_access_token_id: VAULT_ID,
    vault_refresh_token_id: null,
    token_expires_at: null,
    is_active: true,
    connected_at: '2026-01-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('getConnectionStatus', () => {
  it('returns disconnected when no account provided', () => {
    expect(getConnectionStatus(null, 'linkedin')).toBe('disconnected')
    expect(getConnectionStatus(undefined, 'linkedin')).toBe('disconnected')
  })

  it('returns disconnected when account is inactive', () => {
    const account = makeAccount({ is_active: false })
    expect(getConnectionStatus(account, 'linkedin')).toBe('disconnected')
  })

  it('returns connected for active account with no expiry', () => {
    const account = makeAccount({ token_expires_at: null })
    expect(getConnectionStatus(account, 'linkedin')).toBe('connected')
  })

  it('returns connected for active account with token expiring in 8 days', () => {
    const expiresAt = formatISO(addDays(new Date(), 8))
    const account = makeAccount({ token_expires_at: expiresAt })
    expect(getConnectionStatus(account, 'linkedin')).toBe('connected')
  })

  it('returns expiring_soon for active account with token expiring in 5 days', () => {
    const expiresAt = formatISO(addDays(new Date(), 5))
    const account = makeAccount({ token_expires_at: expiresAt })
    expect(getConnectionStatus(account, 'linkedin')).toBe('expiring_soon')
  })

  it('returns expiring_soon for active account expiring today', () => {
    const expiresAt = formatISO(addDays(new Date(), 0))
    const account = makeAccount({ token_expires_at: expiresAt })
    expect(getConnectionStatus(account, 'linkedin')).toBe('expiring_soon')
  })

  it('returns expiring_soon for active account with token expiring in exactly 7 days (boundary is inclusive)', () => {
    const expiresAt = formatISO(addDays(new Date(), 7))
    const account = makeAccount({ token_expires_at: expiresAt })
    expect(getConnectionStatus(account, 'linkedin')).toBe('expiring_soon')
  })

  it('returns connected for active account with token expiring in 8 days (just beyond 7-day boundary)', () => {
    const expiresAt = formatISO(addDays(new Date(), 8))
    const account = makeAccount({ token_expires_at: expiresAt })
    expect(getConnectionStatus(account, 'linkedin')).toBe('connected')
  })

  it('returns coming_soon for instagram with no account', () => {
    expect(getConnectionStatus(null, 'instagram')).toBe('coming_soon')
    expect(getConnectionStatus(undefined, 'instagram')).toBe('coming_soon')
  })

  it('returns connected_coming_soon for instagram with active account', () => {
    const account = makeAccount({ platform: 'instagram' })
    expect(getConnectionStatus(account, 'instagram')).toBe('connected_coming_soon')
  })

  it('returns coming_soon for facebook with no account', () => {
    expect(getConnectionStatus(null, 'facebook')).toBe('coming_soon')
  })

  it('returns connected_coming_soon for threads with active account', () => {
    const account = makeAccount({ platform: 'threads' })
    expect(getConnectionStatus(account, 'threads')).toBe('connected_coming_soon')
  })

  it('returns connected for linkedin with active account (publishing platform)', () => {
    const account = makeAccount({ platform: 'linkedin' })
    expect(getConnectionStatus(account, 'linkedin')).toBe('connected')
  })

  it('returns connected for twitter with active account (publishing platform)', () => {
    const account = makeAccount({ platform: 'twitter' })
    expect(getConnectionStatus(account, 'twitter')).toBe('connected')
  })

  it('returns coming_soon for instagram inactive account', () => {
    const account = makeAccount({ platform: 'instagram', is_active: false })
    expect(getConnectionStatus(account, 'instagram')).toBe('coming_soon')
  })
})
