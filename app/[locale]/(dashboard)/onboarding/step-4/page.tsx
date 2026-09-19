import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { Button } from '@/components/ui/button'
import { OnboardingProgress } from '@/components/onboarding/OnboardingProgress'
import { completeOnboardingAction } from './actions'
import { BackfillPanel, type BackfillRunViewModel } from './BackfillPanel'
import { createClient } from '@/lib/supabase/server'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getBackfillRunsForBusiness } from '@/lib/db/backfill-runs'
import { getSocialAccountById } from '@/lib/db/social-accounts'
import { listEvidenceCandidatesForRun } from '@/lib/db/memory-evidence'
import { listAudienceCandidatesForRun } from '@/lib/db/memory-audience'
import { listPerformanceCandidatesForRun } from '@/lib/db/memory-performance'

// ADR 0025 §10.1 (Session 32 I2.14) — X/Twitter is the only served read
// path today (LinkedIn is built but not served: BACKFILL-NOTHING-ACTIVE-
// BEFORE-RATIFY / current-phase.md). Used only for the "not started" copy.
const SUPPORTED_BACKFILL_PLATFORMS_LABEL = 'X (Twitter)'

async function loadBackfillRunViewModels(): Promise<BackfillRunViewModel[]> {
  const client = await createClient()
  const {
    data: { user },
  } = await client.auth.getUser()
  if (!user) return []

  const business = await getBusinessForUser(client, user.id)
  if (!business) return []

  const runs = await getBackfillRunsForBusiness(client, business.id)
  const live = runs.filter((r) => r.status !== 'discarded')

  return Promise.all(
    live.map(async (run) => {
      const account = await getSocialAccountById(client, run.social_account_id).catch(() => null)
      const accountLabel = account?.platform_display_name ?? account?.platform_username ?? run.platform

      const candidates =
        run.status === 'awaiting_ratification'
          ? {
              evidence: await listEvidenceCandidatesForRun(client, run.id),
              audience: await listAudienceCandidatesForRun(client, run.id),
              performance: await listPerformanceCandidatesForRun(client, run.id),
            }
          : { evidence: [], audience: [], performance: [] }

      return { run, accountLabel, candidates }
    }),
  )
}

export default async function Step4Page({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const t = await getTranslations('onboarding')
  const runViewModels = await loadBackfillRunViewModels()

  return (
    <div className="max-w-lg mx-auto space-y-8 py-8">
      <OnboardingProgress step={4} />

      <div className="space-y-4 text-center py-8">
        <div className="text-5xl" aria-hidden="true">🎉</div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('step4.title')}</h1>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">{t('step4.subtitle')}</p>
      </div>

      <BackfillPanel
        locale={locale}
        initialRuns={runViewModels}
        supportedPlatformsLabel={SUPPORTED_BACKFILL_PLATFORMS_LABEL}
      />

      <div className="flex flex-col items-center gap-4">
        <form action={completeOnboardingAction}>
          <input type="hidden" name="locale" value={locale} />
          <Button type="submit" size="lg">
            {t('step4.cta')}
          </Button>
        </form>

        <Link
          href={`/${locale}/onboarding/step-3`}
          className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-4"
        >
          {t('back')}
        </Link>
      </div>
    </div>
  )
}
