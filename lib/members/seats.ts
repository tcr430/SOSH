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

export type SeatMeterVariant = 'normal' | 'unlimited' | 'at_cap' | 'overage_locked'

export interface SeatMeterView {
  variant: SeatMeterVariant
  // i18n key under the `team` namespace, interpolated with {used, max, overage}.
  messageKey: string
  // Distinct per §5.4 (SEAT-OVERAGE-CTA-DISTINCT) — overage's CTA is
  // deliberately NOT "upgrade" (they're mid-downgrade Pro→Plus).
  ctaLabelKey: string | null
  ctaHref: string | null
}

// §5.4 — the seat meter's 4 states and their copy/CTA contract. Precedence
// matters: overage (Pro→Plus downgrade) is checked before atCap since a
// bounded plan can be simultaneously "at or over cap" — overage is the more
// specific, more urgent state.
export function getSeatMeterView(seats: SeatState): SeatMeterView {
  if (seats.overage > 0) {
    return {
      variant: 'overage_locked',
      messageKey: 'team.seat_meter.overage_locked',
      ctaLabelKey: 'team.seat_meter.overage_cta',
      ctaHref: '/billing',
    }
  }
  if (seats.atCap) {
    return {
      variant: 'at_cap',
      messageKey: 'team.seat_meter.at_cap',
      ctaLabelKey: 'team.seat_meter.upgrade_cta',
      ctaHref: '/billing',
    }
  }
  if (seats.max === null) {
    return {
      variant: 'unlimited',
      messageKey: 'team.seat_meter.unlimited',
      ctaLabelKey: null,
      ctaHref: null,
    }
  }
  return {
    variant: 'normal',
    messageKey: 'team.seat_meter.normal',
    ctaLabelKey: null,
    ctaHref: null,
  }
}
