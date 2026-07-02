'use client'

import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'

// Exported so tests can assert these contracts without rendering
export const CREATE_POST_DISABLED = true as const
export const campaignCreatePath = (locale: string) => `/${locale}/campaigns/new`

interface CalendarToolbarProps {
  monthLabel: string
  locale: string
  onPrev: () => void
  onNext: () => void
  onToday: () => void
}

export function CalendarToolbar({
  monthLabel,
  locale,
  onPrev,
  onNext,
  onToday,
}: CalendarToolbarProps) {
  const t = useTranslations('calendar')

  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-border bg-card shrink-0">
      {/* Month navigation */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onPrev}
          aria-label={t('toolbar.prev_month')}
          className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        <span className="min-w-[140px] text-center text-sm font-semibold px-1">
          {monthLabel}
        </span>

        <button
          type="button"
          onClick={onNext}
          aria-label={t('toolbar.next_month')}
          className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          <ChevronRight className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={onToday}
          className="ml-2 inline-flex items-center min-h-[36px] rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          {t('toolbar.today')}
        </button>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Link
          href={campaignCreatePath(locale)}
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
        >
          {t('toolbar.create_campaign')}
        </Link>

        <button
          type="button"
          disabled={CREATE_POST_DISABLED}
          title={t('toolbar.create_post_coming_soon')}
          className={cn(
            buttonVariants({ size: 'sm' }),
            'cursor-not-allowed opacity-50',
          )}
        >
          {t('toolbar.create_post')}
        </button>
      </div>
    </div>
  )
}
