import * as Sentry from '@sentry/nextjs'
import { formatISO } from 'date-fns'
import { config } from '@/lib/config'
import { getRegistry, SocialProviderError } from '@/lib/social/index'
import type { Platform } from '@/lib/social/index'
import { listPostsForMetricsSync } from '@/lib/db/posts'
import { upsertPostMetrics } from '@/lib/db/post-metrics'
import { getActiveByBusinessAndPlatform } from '@/lib/db/social-accounts'
import { markCronSeen } from '@/lib/db/cron-health'

export interface MetricsSyncTickSummary {
  tick: string
  durationMs: number
  candidates: number
  synced: number
  skippedNotImplemented: number
  skippedNoData: number
  skippedNoAccount: number
  errors: number
}

export async function runMetricsSyncTick(opts?: {
  now?: Date
  batchSize?: number
  triggeredBy?: 'qstash' | 'secret'
}): Promise<MetricsSyncTickSummary> {
  return Sentry.withMonitor('metrics-sync-tick', async () => {
  const start = Date.now()
  const now = opts?.now ?? new Date()
  const batchSize = opts?.batchSize ?? config.server.METRICS_SYNC_BATCH_SIZE

  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()

  await markCronSeen(client, 'metrics-sync')

  const candidates = await listPostsForMetricsSync(client, {
    now,
    staleMinutes: config.server.METRICS_STALE_MINUTES,
    maxAgeDays: config.server.METRICS_MAX_AGE_DAYS,
    limit: batchSize,
  })

  const summary: MetricsSyncTickSummary = {
    tick: formatISO(now),
    durationMs: 0,
    candidates: candidates.length,
    synced: 0,
    skippedNotImplemented: 0,
    skippedNoData: 0,
    skippedNoAccount: 0,
    errors: 0,
  }

  const unsupportedPlatforms = new Set<Platform>()
  const registry = getRegistry()

  for (const post of candidates) {
    if (unsupportedPlatforms.has(post.platform)) {
      summary.skippedNotImplemented++
      continue
    }

    const account = await getActiveByBusinessAndPlatform(client, post.business_id, post.platform)
    if (!account) {
      summary.skippedNoAccount++
      continue
    }

    try {
      const provider = registry.get(post.platform)
      const result = await provider.fetchPostMetrics({
        socialAccountId: account.id,
        platformPostId: post.platform_post_id!,
      })

      if (result === null) {
        summary.skippedNoData++
        continue
      }

      await upsertPostMetrics({
        post_id: post.id,
        business_id: post.business_id,
        likes: result.likes,
        comments: result.comments,
        shares: result.shares,
        saves: result.saves,
        clicks: result.clicks,
        reach: result.reach,
        impressions: result.impressions,
        last_synced_at: result.fetchedAt,
      })
      summary.synced++
    } catch (e) {
      if (e instanceof SocialProviderError && e.code === 'NOT_IMPLEMENTED') {
        unsupportedPlatforms.add(post.platform)
        summary.skippedNotImplemented++
      } else {
        summary.errors++
      }
    }
  }

  summary.durationMs = Date.now() - start

  console.log(JSON.stringify({ kind: 'metrics-sync-tick', triggeredBy: opts?.triggeredBy, ...summary }))

  return summary
  }, {
    schedule: { type: 'crontab', value: '0 * * * *' },
    checkinMargin: 5,
    maxRuntime: 1,
    failureIssueThreshold: 3,
    recoveryThreshold: 1,
  }) // end Sentry.withMonitor
}
