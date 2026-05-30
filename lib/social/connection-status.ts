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
    if (daysUntilExpiry <= EXPIRY_WARNING_DAYS) {
      return 'expiring_soon'
    }
  }

  return 'connected'
}
