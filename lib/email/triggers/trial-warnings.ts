import * as Sentry from '@sentry/nextjs'
import { addDays, formatISO } from 'date-fns'
import { config } from '@/lib/config'
import { findTrialExpiringBetween } from '@/lib/db/trial-state'
import { enqueueEmail } from '@/lib/email/enqueue'

export interface TrialWarningsTickSummary {
  enqueuedT3: number
  enqueuedT1: number
  dedupedT3: number
  dedupedT1: number
  durationMs: number
}

export async function runTrialWarningsTick(opts: {
  triggeredBy: 'qstash' | 'secret'
}): Promise<TrialWarningsTickSummary> {
  const startedAt = Date.now()
  const summary: TrialWarningsTickSummary = {
    enqueuedT3: 0,
    enqueuedT1: 0,
    dedupedT3: 0,
    dedupedT1: 0,
    durationMs: 0,
  }

  try {
    await Sentry.withMonitor(
      'trial-warnings',
      async () => {
        const { createServiceRoleClient } = await import('@/lib/supabase/service')
        const client = createServiceRoleClient()
        const now = new Date()
        const appUrl = config.server.APP_URL

        // T-3: trials expiring in [now+2d, now+3d)
        const t3From = formatISO(addDays(now, 2))
        const t3To = formatISO(addDays(now, 3))
        const t3Candidates = await findTrialExpiringBetween(client, t3From, t3To)

        for (const c of t3Candidates) {
          const result = await enqueueEmail({
            business_id: c.business_id,
            kind: 'trial-warning-t3',
            recipient: c.recipient_email,
            locale: c.language,
            props: {
              businessName: c.business_name,
              daysRemaining: 3,
              expiryDateIso: c.trial_expires_at,
              upgradeUrl: `${appUrl}/${c.language}/billing`,
            },
            dedupe_token: null,
          })
          if (result.outcome === 'enqueued') summary.enqueuedT3 += 1
          if (result.outcome === 'deduped') summary.dedupedT3 += 1
        }

        // T-1: trials expiring in [now+1d, now+2d)
        const t1From = formatISO(addDays(now, 1))
        const t1To = formatISO(addDays(now, 2))
        const t1Candidates = await findTrialExpiringBetween(client, t1From, t1To)

        for (const c of t1Candidates) {
          const result = await enqueueEmail({
            business_id: c.business_id,
            kind: 'trial-warning-t1',
            recipient: c.recipient_email,
            locale: c.language,
            props: {
              businessName: c.business_name,
              daysRemaining: 1,
              expiryDateIso: c.trial_expires_at,
              upgradeUrl: `${appUrl}/${c.language}/billing`,
            },
            dedupe_token: null,
          })
          if (result.outcome === 'enqueued') summary.enqueuedT1 += 1
          if (result.outcome === 'deduped') summary.dedupedT1 += 1
        }
      },
      {
        schedule: { type: 'crontab', value: '0 9 * * *' },
        checkinMargin: 5,
        maxRuntime: 1,
        failureIssueThreshold: 3,
        recoveryThreshold: 1,
      },
    )
  } catch (err) {
    Sentry.captureException(err, { tags: { cron: 'trial-warnings' } })
  }

  summary.durationMs = Date.now() - startedAt

  console.log(
    JSON.stringify({
      kind: 'trial_warnings.tick',
      triggeredBy: opts.triggeredBy,
      ...summary,
    }),
  )

  return summary
}
