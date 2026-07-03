import type { SupabaseClient } from '@supabase/supabase-js'
import type { BusinessRow } from '@/lib/db/types'
import { countSeatUsage } from '@/lib/db/business-members'
import { evaluateSeatState } from '@/lib/members/seats'
import type { SeatState } from '@/lib/members/seats'

export type SeatEnforcementReason = 'seat_cap_reached' | 'overage_locked'

export async function checkInviteAllowed(
  client: SupabaseClient,
  business: BusinessRow,
): Promise<{ allowed: boolean; reason?: SeatEnforcementReason; seats: SeatState }> {
  const { activeCount, pendingCount } = await countSeatUsage(client, business.id)
  const seats = evaluateSeatState({ plan: business.plan, activeCount, pendingCount })

  if (seats.overage > 0) {
    return { allowed: false, reason: 'overage_locked', seats }
  }
  if (seats.atCap) {
    return { allowed: false, reason: 'seat_cap_reached', seats }
  }
  return { allowed: true, seats }
}

export function upgradeCtaTargetFor(reason: SeatEnforcementReason): '/billing' | null {
  switch (reason) {
    case 'seat_cap_reached':
    case 'overage_locked':
      return '/billing'
    default:
      return null
  }
}
