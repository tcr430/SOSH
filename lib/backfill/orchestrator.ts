import * as Sentry from '@sentry/nextjs'
import { subMonths, formatISO } from 'date-fns'
import { getRegistry, SocialProviderError } from '@/lib/social'
import type { RecentPost } from '@/lib/social'
import { getBackfillRunById, transitionBackfillRun, recordBackfillFetchProgress } from '@/lib/db/backfill-runs'
import { stageBackfillPosts } from '@/lib/db/backfill-posts'
import { BACKFILL_MAX_POSTS, BACKFILL_MAX_PAGES, BACKFILL_MAX_PLATFORM_READS, BACKFILL_LOOKBACK_MONTHS } from './constants'

// ADR 0025 §2.3/§6.5 (Session 32 I2.8) — the fetch phase ONLY. Imports
// lib/social via its index.ts barrel exclusively (the ESLint social
// provider boundary scan covers this), lib/db's backfill wrappers, and this
// package's own constants. NO lib/ai import — the model passes are I2.11/
// I2.12's job.

const FETCH_PAGE_SIZE = 100

export type FetchPhaseResult =
  | { status: 'unsupported' }
  | { status: 'extracting'; postsStaged: number; platformPostsRead: number }
  | { status: 'deferred'; reason: 'rate_limited' | 'network' }
  | { status: 'failed'; errorCode: string }
  | { status: 'no_op' } // the run was not in a state this call could act on (already moved by a concurrent discard/disconnect)

function isWithinLookback(publishedAt: string, notBefore: Date): boolean {
  return new Date(publishedAt).getTime() >= notBefore.getTime()
}

// ADR §2.5 error-reaction table, transcribed exactly:
// NOT_IMPLEMENTED -> unsupported; RangeError -> failed/caller_bug (not
// resumable, Sentry); TOKEN_* -> failed (resumable); PLATFORM_REJECTED ->
// failed; RATE_LIMITED -> defer, NOT failed; NETWORK -> leave for next
// tick; UNKNOWN -> failed. Already-staged rows are kept on every path
// (nothing here ever deletes a staged row).
async function reactToFetchError(runId: string, err: unknown): Promise<FetchPhaseResult> {
  if (err instanceof RangeError) {
    Sentry.captureException(err, { tags: { phase: 'backfill-fetch', reason: 'caller_bug' } })
    await transitionBackfillRun(runId, ['fetching'], 'failed', 'caller_bug')
    return { status: 'failed', errorCode: 'caller_bug' }
  }

  if (err instanceof SocialProviderError) {
    switch (err.code) {
      case 'NOT_IMPLEMENTED':
        await transitionBackfillRun(runId, ['fetching'], 'unsupported')
        return { status: 'unsupported' }
      case 'RATE_LIMITED':
        return { status: 'deferred', reason: 'rate_limited' }
      case 'NETWORK':
        return { status: 'deferred', reason: 'network' }
      case 'TOKEN_EXPIRED':
      case 'TOKEN_REVOKED':
      case 'PLATFORM_REJECTED':
      case 'PROVIDER_NOT_CONFIGURED':
      case 'UNKNOWN':
      default:
        await transitionBackfillRun(runId, ['fetching'], 'failed', err.code)
        return { status: 'failed', errorCode: err.code }
    }
  }

  // An unrecognized throwable (neither a RangeError nor a SocialProviderError)
  // is UNKNOWN, not a silent pass-through.
  Sentry.captureException(err, { tags: { phase: 'backfill-fetch', reason: 'unknown' } })
  await transitionBackfillRun(runId, ['fetching'], 'failed', 'UNKNOWN')
  return { status: 'failed', errorCode: 'UNKNOWN' }
}

// ADR §2.3 — bounded work for ONE tick. Cursors live in memory for this
// call only and are NEVER persisted (§6.5): a call that defers or leaves
// work for "next tick" simply re-runs fetchPhase from cursor=null next
// time, idempotently (already-staged rows are deduped by
// stage_backfill_posts's ON CONFLICT). This means one fetchPhase() call
// performs the ENTIRE bounded fetch effort for a run (up to the page/post/
// read ceilings) before ever transitioning to 'extracting'.
export async function fetchPhase(runId: string): Promise<FetchPhaseResult> {
  const run = await getBackfillRunById(runId)
  if (!run) throw new RangeError(`fetchPhase: no such backfill run ${runId}`)
  if (run.status !== 'queued' && run.status !== 'fetching') {
    return { status: 'no_op' }
  }

  const provider = getRegistry().get(run.platform)

  // ADR §2.1 — a static flag check, BEFORE any transition into 'fetching'
  // and with ZERO fetchRecentPosts calls: "unsupported" must never look
  // like a fetch that ran and found nothing.
  if (!provider.historicalReadAvailable) {
    await transitionBackfillRun(runId, ['queued', 'fetching'], 'unsupported')
    return { status: 'unsupported' }
  }

  const transitioned = await transitionBackfillRun(runId, ['queued', 'fetching'], 'fetching')
  if (!transitioned) return { status: 'no_op' }

  const notBefore = subMonths(new Date(), BACKFILL_LOOKBACK_MONTHS)
  let cursor: string | null = null
  let postsStaged = 0
  let platformPostsRead = 0
  let page = 0

  while (page < BACKFILL_MAX_PAGES && postsStaged < BACKFILL_MAX_POSTS && platformPostsRead < BACKFILL_MAX_PLATFORM_READS) {
    let result
    try {
      result = await provider.fetchRecentPosts({
        platform: run.platform,
        socialAccountId: run.social_account_id,
        pageSize: FETCH_PAGE_SIZE,
        cursor,
        notBefore: formatISO(notBefore),
      })
    } catch (err) {
      // Whatever was staged in earlier pages of THIS call is already
      // committed row-by-row above — record it before reacting, so a
      // deferred/failed run still shows real progress.
      if (postsStaged > 0 || platformPostsRead > 0) {
        await recordBackfillFetchProgress(runId, postsStaged, platformPostsRead)
      }
      return reactToFetchError(runId, err)
    }

    page += 1
    platformPostsRead += result.posts.length

    // The orchestrator enforces the lookback itself (§2.2) — notBefore is a
    // hint only, never trusted.
    const inWindow = result.posts.filter((post) => isWithinLookback(post.publishedAt, notBefore))

    if (inWindow.length > 0) {
      const staged = await stageBackfillPosts(runId, run.business_id, run.social_account_id, inWindow as RecentPost[])
      postsStaged += staged
    }

    // An empty page with a non-null cursor is NOT the end (§2.3) — only a
    // WHOLE page entirely older than the lookback stops the loop early.
    const wholePageOlder = result.posts.length > 0 && inWindow.length === 0
    cursor = result.nextCursor

    if (cursor === null || wholePageOlder) break
  }

  await recordBackfillFetchProgress(runId, postsStaged, platformPostsRead)
  await transitionBackfillRun(runId, ['fetching'], 'extracting')
  return { status: 'extracting', postsStaged, platformPostsRead }
}
