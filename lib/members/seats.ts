import type { Plan } from '@/lib/db/types'
import { getPlanCapabilities } from '@/lib/stripe/plan'

export interface SeatState {
  used: number
  max: number | null // null = unlimited
  remaining: number | null // null when max is null
  atCap: boolean // used >= max (false when unlimited)
  overage: number // max===null ? 0 : Math.max(0, used - max)
}

export function evaluateSeatState(input: {
  plan: Plan
  activeCount: number
  pendingCount: number
}): SeatState {
  const used = input.activeCount + input.pendingCount
  const max = getPlanCapabilities(input.plan).maxSeats
  const remaining = max === null ? null : max - used
  const atCap = max !== null && used >= max
  const overage = max === null ? 0 : Math.max(0, used - max)

  return { used, max, remaining, atCap, overage }
}
