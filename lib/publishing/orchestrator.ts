import * as Sentry from '@sentry/nextjs'
import { after } from 'next/server'
import { addSeconds, formatISO } from 'date-fns'
import { config } from '@/lib/config'
import { getRegistry, SocialProviderError } from '@/lib/social/index'
import type { PublishInput } from '@/lib/social/index'
import {
  claimPostsForPublishing,
  publishPostComplete,
  markPostFailed,
  requeueScheduledPost,
} from '@/lib/db/posts'
import { incrementBusinessPublishedCount, getBusinessById } from '@/lib/db/businesses'
import { enqueueFirstPostPublished } from '@/lib/email/triggers/publishing'
import { reapStuckSendingRows } from '@/lib/db/email-outbox'
import { recoverStuckGenerationSessions } from '@/lib/db/post-generation-sessions'
import { pruneStaleAuthRateLimits } from '@/lib/db/auth-rate-limits'
import { markCronSeen } from '@/lib/db/cron-health'
import { getActiveByBusinessAndPlatform } from '@/lib/db/social-accounts'
import type { PostRow } from '@/lib/db/types'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface PublishTickSummary {
  tick: string
  durationMs: number
  claimed: number
  published: number
  failed: number
  retried: number
  refreshed: number
  reaped: number
}

export interface JanitorTickSummary {
  tick: string
  durationMs: number
  stuckGenerationSessionsReaped: number
  authRateLimitsPruned: number
}

function redactTokens(obj: unknown): unknown {
  if (typeof obj !== 'object' || obj === null) return obj
  return Object.fromEntries(
    Object.entries(obj as Record<string, unknown>).map(([k, v]) =>
      /token|secret|authorization|cookie/i.test(k)
        ? [k, '[REDACTED]']
        : [k, redactTokens(v)],
    ),
  )
}

export async function runPublishTick(opts?: {
  now?: Date
  batchSize?: number
  reaped?: number
  triggeredBy?: 'qstash' | 'secret'
}): Promise<PublishTickSummary> {
  return Sentry.withMonitor('publish-tick', async () => {
  const tickStart = Date.now()
  const now = opts?.now ?? new Date()
  const batchSize = opts?.batchSize ?? config.server.PUBLISH_BATCH_SIZE

  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()

  await markCronSeen(client, 'publish')

  const summary: PublishTickSummary = {
    tick: formatISO(now),
    durationMs: 0,
    claimed: 0,
    published: 0,
    failed: 0,
    retried: 0,
    refreshed: 0,
    reaped: opts?.reaped ?? 0,
  }

  const posts = await claimPostsForPublishing(client, batchSize, now)
  summary.claimed = posts.length

  if (posts.length === 0) {
    summary.durationMs = Date.now() - tickStart
    console.log(JSON.stringify({ kind: 'publish-tick', triggeredBy: opts?.triggeredBy, ...summary }))
    return summary
  }

  const refreshedThisTick = new Set<string>()

  async function publishOne(post: PostRow): Promise<void> {
    const account = await getActiveByBusinessAndPlatform(client, post.business_id, post.platform)

    if (!account) {
      await markPostFailed(client, post.id, {
        errorCode: 'TOKEN_REVOKED',
        errorDetails: { reason: 'account_disconnected' },
      })
      summary.failed++
      return
    }

    const input: PublishInput = {
      socialAccountId: account.id,
      content: post.content,
      hashtags: post.hashtags,
      mediaUrls: post.media_urls,
    }

    const registry = getRegistry()
    const provider = registry.get(post.platform)

    let result: Awaited<ReturnType<typeof provider.publish>>
    try {
      result = await provider.publish(input)
    } catch (err) {
      if (!(err instanceof SocialProviderError)) throw err
      await handleError(err, post, account.id, input, client, now, summary, refreshedThisTick)
      return
    }

    const updated = await publishPostComplete(client, post.id, {
      platformPostId: result.platformPostId,
      platformUrl: result.url,
      publishedAt: now,
    })
    if (!updated) return // guard rejected the transition — no-op, not an error

    await maybeEnqueueFirstPostPublished({ client, businessId: post.business_id, post, postUrl: result.url ?? null })
    summary.published++
  }

  for (const post of posts) {
    try {
      await publishOne(post)
    } catch (err) {
      console.error('Unexpected error processing post', post.id, err)
    }
  }

  summary.durationMs = Date.now() - tickStart
  console.log(JSON.stringify({ kind: 'publish-tick', triggeredBy: opts?.triggeredBy, ...summary }))
  return summary
  }, {
    schedule: { type: 'crontab', value: '* * * * *' },
    checkinMargin: 2,
    maxRuntime: 1,
    failureIssueThreshold: 3,
    recoveryThreshold: 1,
  }) // end Sentry.withMonitor
}

async function maybeEnqueueFirstPostPublished(opts: {
  client: SupabaseClient
  businessId: string
  post: PostRow
  postUrl: string | null
}): Promise<void> {
  let newCount: number
  try {
    newCount = await incrementBusinessPublishedCount(opts.client, opts.businessId)
  } catch (err) {
    Sentry.captureException(err, { tags: { email_kind: 'first-post-published', business_id: opts.businessId } })
    return
  }
  if (newCount !== 1) return
  const business = await getBusinessById(opts.client, opts.businessId)
  after(async () => {
    try {
      await enqueueFirstPostPublished({ business, post: opts.post, postUrl: opts.postUrl })
    } catch (err) {
      Sentry.captureException(err, { tags: { email_kind: 'first-post-published', business_id: opts.businessId } })
    }
  })
}

async function handleError(
  err: SocialProviderError,
  post: PostRow,
  socialAccountId: string,
  input: PublishInput,
  client: SupabaseClient,
  now: Date,
  summary: PublishTickSummary,
  refreshedThisTick: Set<string>,
): Promise<void> {
  const MAX = config.server.PUBLISH_MAX_ATTEMPTS
  const BACKOFF = config.server.PUBLISH_RETRY_BACKOFF_SECONDS

  switch (err.code) {
    case 'TOKEN_EXPIRED': {
      if (!refreshedThisTick.has(socialAccountId)) {
        const registry = getRegistry()
        const provider = registry.get(post.platform)
        await provider.refreshAccessToken({ socialAccountId })
        refreshedThisTick.add(socialAccountId)
        summary.refreshed++

        let retryResult: Awaited<ReturnType<typeof provider.publish>>
        try {
          retryResult = await provider.publish(input)
        } catch (e2) {
          if (e2 instanceof SocialProviderError) {
            if (e2.code === 'TOKEN_EXPIRED') {
              // Still expired after refresh — token is genuinely revoked
              await markPostFailed(client, post.id, {
                errorCode: 'TOKEN_REVOKED',
                errorDetails: redactTokens({ reason: 'refresh_failed' }),
              })
              summary.failed++
              return
            }
            // Any other SocialProviderError (NETWORK, RATE_LIMITED, etc.) — normal error matrix
            // NETWORK here does consume publish_attempts (the refresh consumed no budget)
            await handleError(e2, post, socialAccountId, input, client, now, summary, refreshedThisTick)
            return
          }
          // Non-SocialProviderError (unexpected) — terminal
          await markPostFailed(client, post.id, {
            errorCode: 'UNKNOWN',
            errorDetails: redactTokens({ reason: 'unexpected_refresh_retry_error' }),
          })
          summary.failed++
          return
        }

        const updated = await publishPostComplete(client, post.id, {
          platformPostId: retryResult.platformPostId,
          platformUrl: retryResult.url,
          publishedAt: now,
        })
        if (!updated) return // guard rejected the transition — no-op, not an error

        await maybeEnqueueFirstPostPublished({ client, businessId: post.business_id, post, postUrl: retryResult.url ?? null })
        summary.published++
      } else {
        await markPostFailed(client, post.id, {
          errorCode: 'TOKEN_REVOKED',
          errorDetails: { reason: 'refresh_loop' },
        })
        summary.failed++
      }
      return
    }

    case 'RATE_LIMITED': {
      const newScheduledAt = addSeconds(now, err.retryAfterSeconds ?? 60)
      await requeueScheduledPost(client, post.id, {
        newScheduledAt,
        errorCode: 'RATE_LIMITED',
        errorDetails: redactTokens({ retryAfterSeconds: err.retryAfterSeconds }),
        incrementAttempts: false,
      })
      summary.retried++
      return
    }

    case 'NETWORK': {
      if (post.publish_attempts + 1 >= MAX) {
        await markPostFailed(client, post.id, {
          errorCode: 'NETWORK',
          errorDetails: redactTokens({ attempts: post.publish_attempts + 1 }),
        })
        summary.failed++
      } else {
        const expo = BACKOFF * 2 ** post.publish_attempts
        const jitter = expo * (Math.random() * 0.5 - 0.25)
        const newScheduledAt = addSeconds(now, Math.round(expo + jitter))
        await requeueScheduledPost(client, post.id, {
          newScheduledAt,
          errorCode: 'NETWORK',
          errorDetails: redactTokens({ attempts: post.publish_attempts + 1 }),
          incrementAttempts: true,
        })
        summary.retried++
      }
      return
    }

    case 'TOKEN_REVOKED':
    case 'PLATFORM_REJECTED':
    case 'NOT_IMPLEMENTED':
    case 'PROVIDER_NOT_CONFIGURED':
    case 'UNKNOWN':
    default: {
      await markPostFailed(client, post.id, {
        errorCode: err.code,
        errorDetails: redactTokens(err.details ?? {}),
      })
      summary.failed++
      return
    }
  }
}

export async function runJanitorTick(opts?: {
  now?: Date
  triggeredBy?: 'qstash' | 'secret'
}): Promise<JanitorTickSummary> {
  return Sentry.withMonitor('janitor-cron', async () => {
  const tickStart = Date.now()
  const now = opts?.now ?? new Date()

  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()

  const stuckGenerationSessionsReaped = await recoverStuckGenerationSessions(client, {
    now,
    staleMinutes: config.server.POST_GENERATION_SESSION_STALE_MINUTES,
  })
  const authRateLimitsPruned = await pruneStaleAuthRateLimits(client)
  const reapedStuckEmails = await reapStuckSendingRows(
    client,
    config.server.EMAIL_SENDING_STUCK_MINUTES,
  )

  const summary: JanitorTickSummary = {
    tick: formatISO(now),
    durationMs: Date.now() - tickStart,
    stuckGenerationSessionsReaped,
    authRateLimitsPruned,
  }

  console.log(JSON.stringify({ kind: 'janitor_tick', triggeredBy: opts?.triggeredBy, reapedStuckEmails, ...summary }))
  return summary
  }) // end Sentry.withMonitor
}
