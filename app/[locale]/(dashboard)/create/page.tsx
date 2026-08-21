import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'

// ADR 0019 §3.1/§3.2 — the pre-chamber. A Server Component, its own
// dashboard-level route. Three options:
//   Studio (Mode 1)      -> <Link href="/studio">
//   Objective-driven (Mode 2) -> a PLAIN <Link href="/campaigns/new"> — not a
//     shared component, not a step, not a query param. campaigns/new/page.tsx,
//     CampaignForm.tsx, new/actions.ts, new/actions.test.ts are NOT touched
//     by this file or anywhere else in Track D (STUDIO-MODE2-FLOW-UNCHANGED).
//   Signal-driven (Mode 3) -> a real <button disabled>, never a <Link> — so
//     there is nothing to route to and nothing to 404 (§3.4).
//
// Leaving this page without choosing creates NOTHING — no draft row on page
// load (§3.5); a studio_drafts row is created on first explicit save or
// first suggest, both of which happen inside /studio, never here.

type Props = {
  params: Promise<{ locale: string }>
}

export default async function CreatePickerPage({ params }: Props) {
  const { locale } = await params
  const t = await getTranslations('studio.picker')

  const client = await createClient()
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) redirect(`/${locale}/login`)

  const business = await getBusinessForUser(client, user.id)
  if (!business) redirect(`/${locale}/onboarding`)

  return (
    <div className="max-w-3xl mx-auto py-8 px-4 sm:px-6">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{t('heading')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('subheading')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Link
          href={`/${locale}/studio`}
          className="flex flex-col gap-2 rounded-lg border border-border bg-card p-5 text-left transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <h2 className="text-base font-semibold">{t('mode1.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('mode1.description')}</p>
        </Link>

        <Link
          href={`/${locale}/campaigns/new`}
          className="flex flex-col gap-2 rounded-lg border border-border bg-card p-5 text-left transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <h2 className="text-base font-semibold">{t('mode2.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('mode2.description')}</p>
        </Link>

        {/* ADR §3.4 — a real disabled button, no asChild (CLAUDE.md Base UI
            rules), styled directly. The accessible name STATES THE REASON
            (via aria-label), not merely "disabled". */}
        <button
          type="button"
          disabled
          aria-label={t('mode3.unavailableLabel')}
          className={cn(
            buttonVariants({ variant: 'outline' }),
            'h-auto flex-col items-start gap-2 whitespace-normal p-5 text-left',
          )}
        >
          <span className="flex w-full items-center justify-between">
            <span className="text-base font-semibold">{t('mode3.title')}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {t('mode3.badge')}
            </span>
          </span>
          <span className="text-sm text-muted-foreground">{t('mode3.description')}</span>
        </button>
      </div>
    </div>
  )
}
