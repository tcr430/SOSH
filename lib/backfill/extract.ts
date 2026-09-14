import { runPrompt } from '@/lib/ai/runner'
import { buildCustomerContext } from '@/lib/ai/context'
import { calculateCostCents } from '@/lib/ai/models'
import { backfillVoiceSynthesisPrompt } from '@/lib/ai/prompts/backfill-voice-synthesis'
import { backfillInsightsPrompt, type BackfillInsightsOutput } from '@/lib/ai/prompts/backfill-insights'
import { getMostRecentUsageCostCents } from '@/lib/db/ai-usage'
import { getStagedPostsForRun } from '@/lib/db/backfill-posts'
import {
  getBackfillRunById,
  reserveBackfillSpend,
  reconcileBackfillSpend,
  incrementBackfillPassesDone,
  markBackfillRunPartial,
  stageBackfillVoice,
  transitionBackfillRun,
} from '@/lib/db/backfill-runs'
import { reserveBackfillDailySpend, reconcileBackfillDailySpend } from '@/lib/db/backfill-daily-budget'
import { importAudienceItem, importPerformanceItem } from '@/lib/memory/import'
import { computeBackfillStats, writeBackfillStatsSummary } from './stats'
import { computeWeightedSubset, writeBackfillLifts } from './weighting'
import { computeFormatPatterns, writeFormatPatterns, importedConfidence } from './patterns/format'
import {
  BACKFILL_VOICE_INPUT_POSTS,
  BACKFILL_VOICE_EXAMPLES,
  BACKFILL_VOICE_EXAMPLE_MAX_CHARS,
  BACKFILL_EXTRACTION_TRUNCATE_CHARS,
  BACKFILL_PATTERN_MIN_N,
  BACKFILL_PATTERN_MIN_LIFT,
  BACKFILL_AUDIENCE_MIN_BACKING,
  BACKFILL_AUDIENCE_CONFIDENCE,
  BACKFILL_DAILY_CENTS,
} from './constants'
import type { SocialBackfillPostRow, SocialBackfillRunRow } from '@/lib/db/types'

// ADR 0025 §4.1 step 4 / §6.1 (Session 32 I2.11) — the model-pass
// orchestrator. ONE unit of bounded work per call (the I2.9 cron tick's
// dispatch discipline): pass 0 is the deterministic stats/weighting/format
// step (I2.10, no model call); pass 1 is voice synthesis; pass 2 is
// insights. I2.12 inserts the evidence-batch phase between pass 2 and the
// final transition to 'awaiting_ratification'.

export type ExtractionUnitResult =
  | { status: 'progressed'; pass: 'stats' | 'voice' | 'insights' }
  | { status: 'awaiting_ratification'; partial: boolean }
  | { status: 'no_op' }

const DEFAULT_MAX_OUTPUT_TOKENS = 4096
const PARTIAL_REASON_BUDGET_CEILING = 'budget_ceiling_reached'

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

// ADR §6.1 — reserve BOTH the run's own ceiling (reserve_backfill_spend)
// AND the shared per-business daily cap (purpose='backfill_cents', 150
// cents) BEFORE every model call. Either refusing stops extraction.
async function reserveSpend(run: SocialBackfillRunRow, estimateCents: number): Promise<boolean> {
  const runReservation = await reserveBackfillSpend(run.id, estimateCents)
  if (!runReservation) return false
  const dailyReservation = await reserveBackfillDailySpend(run.business_id, estimateCents, BACKFILL_DAILY_CENTS)
  if (!dailyReservation) {
    await reconcileBackfillSpend(run.id, estimateCents, 0) // release the run-level reservation
    return false
  }
  return true
}

// ADR §6.1 — reconcile BOTH reservations to the ACTUAL cost after the call.
// runPrompt does not return usage to its caller (it records ai_usage
// internally) — getMostRecentUsageCostCents reads that same row back.
async function reconcileSpend(run: SocialBackfillRunRow, reservedCents: number, promptId: string): Promise<void> {
  const actual = (await getMostRecentUsageCostCents(run.business_id, promptId)) ?? reservedCents
  await reconcileBackfillSpend(run.id, reservedCents, actual)
  await reconcileBackfillDailySpend(run.business_id, reservedCents, actual)
}

async function refuseAsPartial(run: SocialBackfillRunRow): Promise<ExtractionUnitResult> {
  await markBackfillRunPartial(run.id, PARTIAL_REASON_BUDGET_CEILING)
  return { status: 'awaiting_ratification', partial: true }
}

// Pass 0 (I2.10, no model call): stats/weighting/format patterns.
async function runDeterministicPass(
  run: SocialBackfillRunRow,
  posts: readonly SocialBackfillPostRow[],
): Promise<ExtractionUnitResult> {
  const stats = computeBackfillStats(posts)
  const { lifts, weighting } = computeWeightedSubset(posts)
  await writeBackfillStatsSummary(run.id, stats, weighting)
  if (lifts.size > 0) await writeBackfillLifts(run.id, lifts)

  const formatCandidates = computeFormatPatterns(posts, lifts)
  await writeFormatPatterns(run.business_id, run.id, run.platform, formatCandidates)

  await incrementBackfillPassesDone(run.id)
  return { status: 'progressed', pass: 'stats' }
}

// Pass 1: voice synthesis, staged only — writes NOTHING to brand_voices or
// brand_voice_variations (ADR §4.2).
async function runVoiceSynthesisPass(
  run: SocialBackfillRunRow,
  posts: readonly SocialBackfillPostRow[],
): Promise<ExtractionUnitResult> {
  const { subset } = computeWeightedSubset(posts)
  const top20 = subset.slice(0, BACKFILL_VOICE_INPUT_POSTS).map((post) => ({
    content: truncate(post.content, BACKFILL_EXTRACTION_TRUNCATE_CHARS),
    format: post.format,
  }))

  const estimateCents = calculateCostCents(
    'SONNET_4_6',
    Math.ceil(top20.reduce((sum, p) => sum + p.content.length, 0) / 4),
    DEFAULT_MAX_OUTPUT_TOKENS,
  )
  if (!(await reserveSpend(run, estimateCents))) return refuseAsPartial(run)

  const context = await buildCustomerContext(run.business_id)
  const voiceOutput = await runPrompt(backfillVoiceSynthesisPrompt, context, { posts: top20 })
  await reconcileSpend(run, estimateCents, backfillVoiceSynthesisPrompt.id)

  // ADR §4.2 — up to 3 examples = the highest-lift posts, verbatim. subset
  // is already ordered by lift descending (weighted) or recency (unweighted).
  const examples = subset
    .slice(0, BACKFILL_VOICE_EXAMPLES)
    .map((post) => truncate(post.content, BACKFILL_VOICE_EXAMPLE_MAX_CHARS))

  await stageBackfillVoice(run.id, { ...voiceOutput, examples })
  await incrementBackfillPassesDone(run.id)
  return { status: 'progressed', pass: 'voice' }
}

// Pass 2: insights (topic/hook/proof_type + audience statements). The
// model NEVER supplies n or confidence — recomputed here from staging.
async function runInsightsPass(
  run: SocialBackfillRunRow,
  posts: readonly SocialBackfillPostRow[],
): Promise<ExtractionUnitResult> {
  const { subset } = computeWeightedSubset(posts)
  const inputPosts = subset.map((post) => ({
    platformPostId: post.platform_post_id,
    content: truncate(post.content, BACKFILL_EXTRACTION_TRUNCATE_CHARS),
    format: post.format,
  }))

  const estimateCents = calculateCostCents(
    'SONNET_4_6',
    Math.ceil(inputPosts.reduce((sum, p) => sum + p.content.length, 0) / 4),
    DEFAULT_MAX_OUTPUT_TOKENS,
  )
  if (!(await reserveSpend(run, estimateCents))) return refuseAsPartial(run)

  const context = await buildCustomerContext(run.business_id)
  const insightsOutput = await runPrompt(backfillInsightsPrompt, context, { posts: inputPosts })
  await reconcileSpend(run, estimateCents, backfillInsightsPrompt.id)

  await writeInsightsOutput(run, posts, insightsOutput)

  await incrementBackfillPassesDone(run.id)
  // I2.12 inserts the evidence-batch phase here (passes_done >= 3) before
  // this final transition. For now, extraction completes after insights.
  await transitionBackfillRun(run.id, ['extracting'], 'awaiting_ratification')
  return { status: 'awaiting_ratification', partial: false }
}

async function writeInsightsOutput(
  run: SocialBackfillRunRow,
  posts: readonly SocialBackfillPostRow[],
  output: BackfillInsightsOutput,
): Promise<void> {
  const postsByPlatformId = new Map(posts.map((post) => [post.platform_post_id, post]))

  for (const candidate of output.patterns) {
    // DISCARD ids not in the run's own staging set, and any post without a
    // computed lift (excluded from this run's ranking entirely).
    const backing = candidate.backingPostIds
      .map((id) => postsByPlatformId.get(id))
      .filter((post): post is SocialBackfillPostRow => post !== undefined && post.lift !== null)

    const n = backing.length
    if (n < BACKFILL_PATTERN_MIN_N) continue
    const medianLift = median(backing.map((post) => post.lift as number))
    if (medianLift < BACKFILL_PATTERN_MIN_LIFT) continue

    const newest = backing.reduce((latest, post) => (post.published_at > latest ? post.published_at : latest), backing[0].published_at)
    await importPerformanceItem({
      businessId: run.business_id,
      runId: run.id,
      sourcePostIds: backing.map((post) => post.platform_post_id),
      dimension: candidate.dimension,
      pattern: candidate.pattern,
      platform: run.platform,
      confidence: importedConfidence(n),
      observationCount: n,
      newestPublishedAt: newest,
    })
  }

  for (const statement of output.audienceStatements) {
    const backing = statement.backingPostIds
      .map((id) => postsByPlatformId.get(id))
      .filter((post): post is SocialBackfillPostRow => post !== undefined)
    if (backing.length < BACKFILL_AUDIENCE_MIN_BACKING) continue

    const newest = backing.reduce((latest, post) => (post.published_at > latest ? post.published_at : latest), backing[0].published_at)
    await importAudienceItem({
      businessId: run.business_id,
      runId: run.id,
      sourcePostIds: backing.map((post) => post.platform_post_id),
      segment: null,
      kind: statement.kind,
      statement: statement.statement,
      platform: run.platform,
      confidence: BACKFILL_AUDIENCE_CONFIDENCE,
      publishedAt: newest,
    })
  }
}

export async function runExtractionUnit(runId: string): Promise<ExtractionUnitResult> {
  const run = await getBackfillRunById(runId)
  if (!run || run.status !== 'extracting') return { status: 'no_op' }

  const posts = await getStagedPostsForRun(runId)

  if (run.passes_done === 0) return runDeterministicPass(run, posts)
  if (run.passes_done === 1) return runVoiceSynthesisPass(run, posts)
  return runInsightsPass(run, posts)
}
