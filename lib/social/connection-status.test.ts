import { describe, it, expect } from 'vitest'
import { addDays, formatISO } from 'date-fns'
import { getConnectionStatus, pickDefaultAccountId } from './connection-status'
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

  // MINOR-6/A-12 (Session 30.5-D, D6): differenceInCalendarDays <= 7 admitted
  // NEGATIVE values, so an already-expired token rendered 'expiring_soon'
  // ("renew it soon") instead of 'disconnected' ("reconnect required") — the
  // exact moment LinkedIn's non-refreshable 60-day token stops working is
  // the single most common reconnection event this product will generate.
  // Ruling (A-12): daysUntilExpiry < 0 routes to the EXISTING 'disconnected'
  // state — no sixth state.
  it('returns disconnected (not expiring_soon) for an active account whose token expired 3 days ago', () => {
    const expiresAt = formatISO(addDays(new Date(), -3))
    const account = makeAccount({ token_expires_at: expiresAt })
    expect(getConnectionStatus(account, 'linkedin')).toBe('disconnected')
  })

  it('boundary: expiring exactly today (daysUntilExpiry === 0) is still expiring_soon, not disconnected', () => {
    const expiresAt = formatISO(addDays(new Date(), 0))
    const account = makeAccount({ token_expires_at: expiresAt })
    expect(getConnectionStatus(account, 'linkedin')).toBe('expiring_soon')
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

describe('pickDefaultAccountId — ADR 0028 §5.3/§9.4', () => {
  it('returns null for an empty list', () => {
    expect(pickDefaultAccountId([])).toBeNull()
  })

  it('returns the id of the single active account', () => {
    expect(pickDefaultAccountId([{ id: 'a1', is_active: true }])).toBe('a1')
  })

  it('ignores inactive accounts when exactly one active remains', () => {
    expect(
      pickDefaultAccountId([
        { id: 'a1', is_active: false },
        { id: 'a2', is_active: true },
      ]),
    ).toBe('a2')
  })

  it('returns null when zero accounts are active', () => {
    expect(
      pickDefaultAccountId([
        { id: 'a1', is_active: false },
        { id: 'a2', is_active: false },
      ]),
    ).toBeNull()
  })

  it('returns null when two accounts are active — no default, resolvePublishAccount would call this ambiguous', () => {
    expect(
      pickDefaultAccountId([
        { id: 'a1', is_active: true },
        { id: 'a2', is_active: true },
      ]),
    ).toBeNull()
  })
})
