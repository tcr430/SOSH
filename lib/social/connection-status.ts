import { differenceInCalendarDays } from 'date-fns'
import type { Platform } from '@/lib/db/types'
import { publishingAvailableFor } from './platforms/config'

export type ConnectionStatus = 'connected' | 'connected_coming_soon' | 'expiring_soon' | 'disconnected' | 'coming_soon'

interface AccountForStatus {
  is_active: boolean
  token_expires_at: string | null
}

const EXPIRY_WARNING_DAYS = 7

export function getConnectionStatus(
  account: AccountForStatus | undefined | null,
  platform: Platform,
): ConnectionStatus {
  if (!publishingAvailableFor(platform)) {
    return account?.is_active ? 'connected_coming_soon' : 'coming_soon'
  }

  if (!account || !account.is_active) {
    return 'disconnected'
  }

  if (account.token_expires_at !== null) {
    const daysUntilExpiry = differenceInCalendarDays(new Date(account.token_expires_at), new Date())
    // MINOR-6/A-12 (Session 30.5-D, D6): a NEGATIVE daysUntilExpiry means the
    // token already expired — that is 'disconnected' (reconnect required),
    // not 'expiring_soon' (renew it soon). Boundary is exclusive: exactly 0
    // (expiring today) is still 'expiring_soon'. No sixth state — this
    // routes into the existing 'disconnected' state (§9.4 note added).
    if (daysUntilExpiry < 0) {
      return 'disconnected'
    }
    if (daysUntilExpiry <= EXPIRY_WARNING_DAYS) {
      return 'expiring_soon'
    }
  }

  return 'connected'
}

interface AccountForDefault {
  id: string
  is_active: boolean
}

// ADR 0028 §5.3/§9.4 — "default" mirrors resolvePublishAccount's own
// resolution order (lib/db/social-accounts.ts), not a stored flag: no
// `is_default` column exists, and adding one would be a schema decision this
// UI step doesn't own. With exactly one active identity for a platform, that
// identity IS the resolver's implicit default. With two or more, the
// resolver calls it 'ambiguous' and refuses to publish rather than guess —
// so there is honestly no default to mark, and this returns null rather than
// picking one arbitrarily.
export function pickDefaultAccountId(accounts: readonly AccountForDefault[]): string | null {
  const active = accounts.filter(a => a.is_active)
  return active.length === 1 ? active[0]!.id : null
}
