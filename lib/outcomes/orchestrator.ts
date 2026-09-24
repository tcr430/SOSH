import * as Sentry from '@sentry/nextjs'
import { formatISO } from 'date-fns'
import { config } from '@/lib/config'
import { listBusinessIdsPage } from '@/lib/db/businesses'
import {
  getEngagementSeed,
  insertPostOutcome,
  listLatestSnapshotsForPosts,
  listMaturedOutcomesForBaseline,
  listPostDimensionsBySnapshot,
  listPostsDueForOutcome,
  type EngagementSeed,
  type LatestSnapshot,
  type PostDimensionsForTagging,
} from '@/lib/db/post-outcomes'
import {
  demoteOutcomePattern,
  promoteOutcomePattern,
  upsertOutcomePattern,
  type OutcomePatternDimension,
} from '@/lib/db/memory-performance'
import type { PostOutcomeInsert } from '@/lib/db/types'
import { OUTCOME_PROMOTABLE_DIMENSIONS } from './constants'
import { ctaPresent, hookSurvived, lengthBand } from './measured'
import { normaliseOutcome, type OutcomePlatform, type PriorOutcome } from './normalise'
import { runRetrospectivePhase } from './retrospective'
import { renderOutcomePattern } from './template'

// ADR 0026 §7 / §14 (Session 33 J2.8) — the extract-outcomes tick. DETERMINISTIC: no model call anywhere in
// lib/outcomes. One daily tick that (a) freezes matured outcomes, (b) recomputes the cells they touched
// through the SQL floor, (c) leaves a slot for the campaign-retrospective phase.
//
// Discipline:
//   * ONE business per iteration; no business id is captured across iterations (ADR 0018 §10.3).
//   * Per-item try/catch: one failing business, post or cell increments `errors` and never fails the batch.
//     This is also where a mixed rate/count cell's loud RAISE from SQL is absorbed.
//   * The floor lives in SQL. This file passes only WHAT IDENTIFIES A CELL and a closed-template sentence;
//     it never supplies n, wins, campaigns or a bound, and it never decides that a pattern is promotable.
//   * hook_type and proof_type are descriptive-only and are never a cell here (OUTCOME-DESCRIPTIVE-ONLY).
//   * IDEMPOTENT: the outcome insert is ON CONFLICT DO NOTHING, the due-list excludes posts that already have
//     an outcome, and the cell upsert / promote / demote are recomputes — a replayed tick changes no row.
//   * The canonical tick log line is emitted by the ROUTE (CLAUDE.md worker carve-out), not here.

// A post that never received a day-7 sync stays a skip candidate only this long (bounds the scan).
const CANDIDATE_LOOKBACK_DAYS = 30
const BUSINESS_PAGE = 100
const BASELINE_HISTORY_LIMIT = 500

export interface OutcomeTickSummary {
  triggeredBy: 'qstash' | 'secret'
  tick: string
  durationMs: number
  candidates: number
  matured: number
  outcomesWritten: number
  skippedNoMetrics: number
  // A SUBSET of skippedNoMetrics: posts with NO metrics row at all, i.e. the sync has never succeeded for them.
  // A quiet week leaves a stale row (counted only in skippedNoMetrics); an auth outage, a revoked token or a
  // provider fault leaves none, so a non-zero value here is the signal to look at sync-metrics (MAJOR-2).
  skippedNeverSynced: number
  skippedNoBaseline: number
  skippedIneligibleField: number
  cellsRecomputed: number
  candidatesUpserted: number
  promoted: number
  demoted: number
  retrospectivesCompleted: number
  errors: number
}

interface Cell {
  dimension: OutcomePatternDimension
  value: string
  platform: OutcomePlatform
}

// The promotable set, expressed in the performance_memory vocabulary (§5.1 widens dimension with 'cta').
const PROMOTABLE: ReadonlySet<string> = new Set(
  OUTCOME_PROMOTABLE_DIMENSIONS.map((d) => (d === 'cta_present' ? 'cta' : d)),
)

function cellKey(c: Cell): string {
  return `${c.platform}|${c.dimension}|${c.value}`
}

// The generation-time cells of one frozen post (from its snapshot's dimensions) plus its measured cells.
// hook_type / proof_type are not read at all.
function cellsFor(
  platform: OutcomePlatform,
  dims: PostDimensionsForTagging | undefined,
  measured: { lengthBand: string | null; cta: boolean | null },
): Cell[] {
  const cells: Cell[] = []
  const add = (dimension: OutcomePatternDimension, value: string | null | undefined) => {
    if (value == null || !PROMOTABLE.has(dimension)) return
    cells.push({ dimension, value, platform })
  }
  add('role', dims?.role)
  add('format', dims?.format)
  add('origin_mode', dims?.origin_mode)
  add('length_band', measured.lengthBand)
  add('cta', measured.cta === null ? null : String(measured.cta))
  return cells
}

async function recomputeCell(cell: Cell, businessId: string, summary: OutcomeTickSummary): Promise<void> {
  const basis = cell.platform === 'twitter' ? 'rate' : 'count'
  for (const direction of ['above', 'below'] as const) {
    summary.cellsRecomputed += 1
    try {
      const row = await upsertOutcomePattern({
        business_id: businessId,
        dimension: cell.dimension,
        value: cell.value,
        platform: cell.platform,
        direction,
        pattern: renderOutcomePattern({ platform: cell.platform, dimension: cell.dimension, value: cell.value, direction, basis }),
      })
      if (row === null) continue // below OUTCOME_PROVISIONAL_N: nothing is written
      summary.candidatesUpserted += 1
      const key = row.pattern_key
      if (key == null) continue
      // Both calls are conditional UPDATEs that RECOMPUTE the floor in SQL; the status only picks which to ask.
      if (row.status === 'candidate') {
        if ((await promoteOutcomePattern(businessId, key)) !== null) summary.promoted += 1
      } else if (row.status === 'active') {
        if ((await demoteOutcomePattern(businessId, key)) !== null) summary.demoted += 1
      }
    } catch (err) {
      summary.errors += 1
      Sentry.captureException(err, { tags: { cron: 'extract-outcomes', phase: 'cell' } })
    }
  }
}

// Freezes this business's due outcomes and recomputes the touched cells. Returns how many `ready` posts it
// consumed from the batch budget (skip candidates cost nothing).
async function processBusiness(businessId: string, now: Date, budget: number, summary: OutcomeTickSummary): Promise<number> {
  const due = await listPostsDueForOutcome(businessId, { now: formatISO(now), limit: budget, lookbackDays: CANDIDATE_LOOKBACK_DAYS })
  summary.candidates += due.length

  const ready = due.filter((d) => d.due === 'ready')
  summary.skippedNoMetrics += due.length - ready.length
  summary.skippedNeverSynced += due.filter((d) => d.due === 'never_synced').length
  if (ready.length === 0) return 0

  const postIds = ready.map((d) => d.post.id)
  const snapshots = new Map<string, LatestSnapshot>((await listLatestSnapshotsForPosts(businessId, postIds)).map((s) => [s.post_id, s]))
  const dims = new Map<string, PostDimensionsForTagging>(
    (await listPostDimensionsBySnapshot(businessId, [...snapshots.values()].map((s) => s.id))).map((d) => [d.ai_original_id, d]),
  )
  const seeds = new Map<string, EngagementSeed | null>()
  const touched = new Map<string, Cell>()

  for (const item of ready) {
    summary.matured += 1
    const { post, metrics } = item
    try {
      const publishedAt = post.published_at as string
      let seed = seeds.get(post.platform)
      if (seed === undefined) {
        seed = await getEngagementSeed(businessId, post.platform)
        seeds.set(post.platform, seed)
      }
      const prior: PriorOutcome[] = (await listMaturedOutcomesForBaseline(businessId, post.platform, { before: publishedAt, limit: BASELINE_HISTORY_LIMIT }))
        .map((o) => ({ postId: o.post_id, publishedAt: o.published_at, value: o.value, basis: o.metric_basis }))

      const result = normaliseOutcome({ platform: post.platform, metrics: metrics ?? {}, postId: post.id, publishedAt, prior, seed })
      if (result.kind === 'excluded') {
        summary.skippedIneligibleField += 1
        continue
      }
      if (result.beatBaseline === null) summary.skippedNoBaseline += 1

      const snapshot = snapshots.get(post.id)
      const band = lengthBand({ platform: post.platform, content: post.content, format: snapshot?.format })
      const cta = ctaPresent(post.content)
      const insert: PostOutcomeInsert = {
        post_id: post.id,
        business_id: businessId,
        campaign_id: post.campaign_id,
        platform: post.platform,
        published_at: publishedAt,
        ai_original_id: snapshot?.id ?? null,
        metric_basis: result.basis,
        value: result.value,
        baseline: result.baseline,
        baseline_n: result.baselineN,
        baseline_source: result.baselineSource,
        log_lift: result.logLift,
        beat_baseline: result.beatBaseline,
        length_band: band,
        cta_present: cta,
        hook_survived: hookSurvived(post.content, snapshot?.rendered_content ?? null),
        measured_at: formatISO(now),
      }
      const written = await insertPostOutcome(insert)
      if (!written) continue // already frozen: a replayed tick changes nothing
      summary.outcomesWritten += 1

      // A post with no baseline is recorded but is not an observation (beat_baseline is NULL).
      if (result.beatBaseline !== null) {
        for (const cell of cellsFor(post.platform as OutcomePlatform, snapshot ? dims.get(snapshot.id) : undefined, { lengthBand: band, cta })) {
          touched.set(cellKey(cell), cell)
        }
      }
    } catch (err) {
      summary.errors += 1
      Sentry.captureException(err, { tags: { cron: 'extract-outcomes', phase: 'post' } })
    }
  }

  for (const cell of touched.values()) await recomputeCell(cell, businessId, summary)
  return ready.length
}

export async function runOutcomeTick(opts: { triggeredBy: 'qstash' | 'secret' }): Promise<OutcomeTickSummary> {
  const startedAt = Date.now()
  const now = new Date()
  const summary: OutcomeTickSummary = {
    triggeredBy: opts.triggeredBy,
    tick: formatISO(now),
    durationMs: 0,
    candidates: 0,
    matured: 0,
    outcomesWritten: 0,
    skippedNoMetrics: 0,
    skippedNeverSynced: 0,
    skippedNoBaseline: 0,
    skippedIneligibleField: 0,
    cellsRecomputed: 0,
    candidatesUpserted: 0,
    promoted: 0,
    demoted: 0,
    retrospectivesCompleted: 0,
    errors: 0,
  }

  try {
    await Sentry.withMonitor(
      'extract-outcomes',
      async () => {
        let budget = config.server.OUTCOME_BATCH_SIZE
        let after: string | null = null
        for (;;) {
          const page: string[] = await listBusinessIdsPage(after, BUSINESS_PAGE)
          if (page.length === 0) break
          for (const businessId of page) {
            after = businessId
            try {
              if (budget > 0) budget -= await processBusiness(businessId, now, budget, summary)
            } catch (err) {
              summary.errors += 1
              Sentry.captureException(err, { tags: { cron: 'extract-outcomes', phase: 'business' } })
            }
            // ADR 0026 §8.2 — the retrospective phase: its own try, so a failing outcome pass never skips it.
            try {
              const retro = await runRetrospectivePhase(businessId, now)
              summary.retrospectivesCompleted += retro.completed
              summary.errors += retro.errors
            } catch (err) {
              summary.errors += 1
              Sentry.captureException(err, { tags: { cron: 'extract-outcomes', phase: 'retrospective' } })
            }
          }
        }
      },
      {
        schedule: { type: 'crontab', value: '0 4 * * *' },
        checkinMargin: 5,
        maxRuntime: 10,
        failureIssueThreshold: 1,
        recoveryThreshold: 1,
      },
    )
  } catch (err) {
    summary.errors += 1
    Sentry.captureException(err, { tags: { cron: 'extract-outcomes' } })
  }

  summary.durationMs = Date.now() - startedAt
  return summary
}
