import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { getSeatMeterView } from '@/lib/members/seats'
import type { SeatState } from '@/lib/members/seats'

// A quiet progress indicator, not a marketing gauge (DESIGN POSTURE) — the
// one confident focal element on an otherwise calm, dense administrative
// surface. §5.4's 4 states.
export async function SeatMeter({ seats }: { seats: SeatState }) {
  const t = await getTranslations('team')
  const view = getSeatMeterView(seats)

  const percent =
    view.variant === 'unlimited'
      ? 0
      : Math.min(100, Math.round((seats.used / Math.max(seats.max ?? 1, 1)) * 100))

  return (
    <div className="rounded-lg border p-4 space-y-2" data-seat-meter-variant={view.variant}>
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-foreground">
          {t(view.messageKey as Parameters<typeof t>[0], {
            used: seats.used,
            max: seats.max ?? 0,
            overage: seats.overage,
          })}
        </p>
        {view.ctaLabelKey && view.ctaHref && (
          <Link
            href={view.ctaHref}
            className="shrink-0 text-sm font-medium underline underline-offset-4 hover:text-primary"
          >
            {t(view.ctaLabelKey as Parameters<typeof t>[0], { overage: seats.overage })}
          </Link>
        )}
      </div>
      {view.variant !== 'unlimited' && (
        <div
          role="progressbar"
          aria-valuenow={seats.used}
          aria-valuemin={0}
          aria-valuemax={seats.max ?? seats.used}
          aria-label={t('seat_meter.aria_label')}
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            className={
              view.variant === 'overage_locked'
                ? 'h-full bg-destructive'
                : view.variant === 'at_cap'
                  ? 'h-full bg-foreground'
                  : 'h-full bg-foreground/60'
            }
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
    </div>
  )
}
