import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/server'
import { getBusinessByOwner } from '@/lib/db/businesses'
import { getCampaignById } from '@/lib/db/campaigns'
import { listPostsByCampaign } from '@/lib/db/posts'
import { PLATFORM_CONFIGS } from '@/lib/social'
import { config } from '@/lib/config'
import type { CampaignStatus } from '@/lib/db/types'
import { CampaignDetailActions } from './CampaignDetailActions'

type Props = {
  params: Promise<{ locale: string; id: string }>
}

const STATUS_STYLES: Record<CampaignStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  active: 'bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300',
  paused: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  completed: 'bg-muted text-muted-foreground opacity-60',
}

export default async function CampaignDetailPage({ params }: Props) {
  const { locale, id } = await params
  const t = await getTranslations('campaigns.detail')
  const tStatus = await getTranslations('campaigns.status')
  const tFreq = await getTranslations('campaigns.new.fields.frequency')

  const client = await createClient()
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) redirect(`/${locale}/login`)

  const business = await getBusinessByOwner(client, user.id)
  if (!business) redirect(`/${locale}/onboarding`)

  const campaign = await getCampaignById(client, id).catch(() => null)
  if (!campaign) redirect(`/${locale}/campaigns`)

  const allPosts = campaign.status !== 'draft'
    ? await listPostsByCampaign(client, id, 200)
    : []
  const failedCount = allPosts.filter(p => p.status === 'failed').length
  const upcomingDates = allPosts
    .filter(p => (p.status === 'approved' || p.status === 'scheduled') && p.scheduled_at > new Date().toISOString())
    .map(p => p.scheduled_at)
  const nextScheduledAt = upcomingDates.length > 0
    ? upcomingDates.reduce((a, b) => (a < b ? a : b))
    : null

  const platformNames = campaign.platforms
    .map((p) => PLATFORM_CONFIGS[p]?.displayName ?? p)
    .join(', ')

  const startDate = format(parseISO(campaign.start_date), 'PP')
  const endDate = campaign.end_date
    ? format(parseISO(campaign.end_date), 'PP')
    : t('meta.no_end_date')

  const frequencyLabel =
    campaign.frequency === 'custom'
      ? t('meta.posts_per_week', { n: campaign.posts_per_week })
      : tFreq(campaign.frequency)

  return (
    <div className="max-w-3xl mx-auto py-8 px-4 sm:px-6">
      {/* Back link */}
      <Link
        href={`/${locale}/campaigns`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors"
      >
        ← {t('back')}
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-8">
        <div className="flex items-center gap-3 flex-wrap min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight truncate">{campaign.name}</h1>
          <span
            className={cn(
              'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium',
              STATUS_STYLES[campaign.status],
            )}
          >
            {tStatus(campaign.status)}
          </span>
        </div>
        <Link
          href={`/${locale}/campaigns/${id}/edit`}
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'shrink-0')}
        >
          {t('edit')}
        </Link>
      </div>

      {/* Overview card */}
      <section className="rounded-lg border border-border bg-card p-6 mb-4 space-y-4">
        {/* Objective */}
        <p className="text-sm text-foreground leading-relaxed">{campaign.objective}</p>

        {/* Special instructions */}
        {campaign.special_instructions && (
          <div className="border-t border-border pt-4">
            <p className="text-xs font-medium text-muted-foreground mb-1.5">
              {t('meta.special_instructions')}
            </p>
            <p className="text-sm text-foreground leading-relaxed">
              {campaign.special_instructions}
            </p>
          </div>
        )}

        {/* Meta row */}
        <div className="border-t border-border pt-4 grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground">{t('meta.platforms')}</p>
            <p className="text-sm text-foreground mt-0.5">{platformNames}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground">{t('meta.frequency')}</p>
            <p className="text-sm text-foreground mt-0.5">{frequencyLabel}</p>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <p className="text-xs font-medium text-muted-foreground">{t('meta.dates')}</p>
            <p className="text-sm text-foreground mt-0.5">
              {startDate} → {endDate}
            </p>
          </div>
        </div>
      </section>

      {/* Interactive: generate posts + danger zone */}
      <CampaignDetailActions
        campaign={campaign}
        locale={locale}
        pollMaxSeconds={config.server.POST_GENERATION_POLL_MAX_SECONDS}
        nextScheduledAt={nextScheduledAt}
        failedCount={failedCount}
      />
    </div>
  )
}
