import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { CheckCircle, Inbox } from 'lucide-react'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getCampaignById } from '@/lib/db/campaigns'
import { listPostsByCampaign } from '@/lib/db/posts'
import { PostsClient } from './PostsClient'

type Props = {
  params: Promise<{ locale: string; id: string }>
  searchParams: Promise<{ filter?: string }>
}

export default async function CampaignPostsPage({ params, searchParams }: Props) {
  const { locale, id } = await params
  const { filter } = await searchParams
  const t = await getTranslations('posts')

  const client = await createClient()
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) redirect(`/${locale}/login`)

  const business = await getBusinessForUser(client, user.id)
  if (!business) redirect(`/${locale}/onboarding`)

  const campaign = await getCampaignById(client, id).catch(() => null)
  if (!campaign) redirect(`/${locale}/campaigns`)

  const rawPosts = await listPostsByCampaign(client, id, 50)
  const posts = [...rawPosts].sort((a, b) =>
    a.scheduled_at.localeCompare(b.scheduled_at),
  )

  const total = posts.length
  const approved = posts.filter(p => p.status === 'approved').length
  const draft = posts.filter(p => p.status === 'draft').length
  const skipped = posts.filter(p => p.status === 'skipped').length

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 sm:px-6">
      {/* Back link */}
      <Link
        href={`/${locale}/campaigns/${id}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors"
      >
        {t('back')}
      </Link>

      {/* Header */}
      <div className="mb-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t('title', { campaignName: campaign.name })}
        </h1>
      </div>

      {/* Summary bar */}
      <p className="text-sm text-muted-foreground mb-6">
        {t('summary.approved', { count: approved })} ·{' '}
        {t('summary.drafts', { count: draft })} ·{' '}
        {t('summary.skipped', { count: skipped })} —{' '}
        {t('summary.of', { total })}
      </p>

      {/* Ready to publish banner */}
      {draft === 0 && approved > 0 && (
        <div className="rounded-lg border border-emerald-600/40 bg-emerald-950/20 p-4 mb-6 flex items-start gap-3">
          <CheckCircle className="size-5 text-emerald-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-emerald-100">
              {t('readyBanner.title')}
            </p>
            <p className="text-xs text-emerald-200/70 mt-0.5">
              {t('readyBanner.description')}
            </p>
          </div>
        </div>
      )}

      {/* Content: empty state or posts client */}
      {total === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 flex flex-col items-center text-center">
          <Inbox className="size-10 text-muted-foreground mb-4" />
          <h2 className="text-lg font-medium mb-1">{t('empty.title')}</h2>
          <p className="text-sm text-muted-foreground mb-6 max-w-sm">
            {t('empty.description')}
          </p>
          <Link
            href={`/${locale}/campaigns/${id}`}
            className={cn(buttonVariants({ variant: 'default', size: 'sm' }))}
          >
            {t('empty.action')}
          </Link>
        </div>
      ) : (
        <PostsClient
          posts={posts}
          campaign={campaign}
          locale={locale}
          initialFilter={filter === 'failed' ? 'failed' : undefined}
        />
      )}
    </div>
  )
}
