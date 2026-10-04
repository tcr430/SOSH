import { addDays, formatISO, parseISO } from 'date-fns'
import type { BackfillRunStatus, PostMetricsRow, PostOutcomeInsert, PostRow } from './types'
import { getErrorMessage } from './utils'
import { OUTCOME_MATURITY_DAYS, OUTCOME_MATURITY_GRACE_DAYS } from '@/lib/outcomes/constants'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readAllPages, keysetFilterDesc } from './keyset-pager'

// ADR 0026 §6 (Session 33 J2.7) — reads and the single write of the outcome worker. Every function is
// SERVICE-ROLE (lazy import, NO client parameter), takes a businessId and filters on it, and every list is
// bounded and ordered on an existing index.

const DEFAULT_LIMIT = 200
const MAX_LIMIT = 500

function bound(limit: number | undefined): number {
  return Math.min(Math.max(Math.trunc(limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT)
}

// ON CONFLICT (post_id) DO NOTHING: an outcome is frozen once, so a replayed tick changes nothing
// (OUTCOME-TICK-IDEMPOTENT). Returns true when a row was written.
export async function insertPostOutcome(insert: PostOutcomeInsert): Promise<boolean> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client
    .from('post_outcomes')
    .upsert(insert, { onConflict: 'post_id', ignoreDuplicates: true })
    .select('post_id')
  if (error) throw new Error(getErrorMessage(error))
  return (data ?? []).length > 0
}

export type MaturedOutcomeForBaseline = {
  post_id: string
  published_at: string
  value: number
  metric_basis: 'rate' | 'count'
}

// The candidate baseline population for one brand and platform: matured outcomes published strictly
// before `before`, newest first, on post_outcomes_business_platform_published_idx. The normaliser applies
// the window (X 90 days / LinkedIn last 20), the basis match and the self-exclusion.
export async function listMaturedOutcomesForBaseline(
  businessId: string,
  platform: string,
  opts: { before: string; limit?: number },
): Promise<MaturedOutcomeForBaseline[]> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client
    .from('post_outcomes')
    .select('post_id, published_at, value, metric_basis')
    .eq('business_id', businessId)
    .eq('platform', platform)
    .lt('published_at', opts.before)
    .order('published_at', { ascending: false })
    .limit(bound(opts.limit))
  if (error) throw new Error(getErrorMessage(error))
  return (data ?? []).map((r) => ({ ...r, value: Number(r.value) })) as MaturedOutcomeForBaseline[]
}

export type PostDueForOutcome = {
  post: PostRow
  // null when no metrics row exists or the day-7 sync never landed: a skip candidate.
  metrics: PostMetricsRow | null
  // 'no_metrics'   — the day-7 sync did not land (a row exists but is older, or none exists): the skip candidates.
  // 'never_synced' — the SUBSET of those with NO post_metrics row at all (the sync has never succeeded).
  due: 'ready' | 'no_metrics' | 'never_synced'
}

// Published posts past maturity that have no outcome row yet, oldest first, bounded.
//   ready      — the day-7 sync landed (last_synced_at >= published_at + 7d)
//   no_metrics — past maturity + grace with no day-7 sync: counted, never zeroed
// A post inside the grace window without a day-7 sync is left for a later tick.
export async function listPostsDueForOutcome(
  businessId: string,
  opts: { now: string; limit?: number; lookbackDays?: number },
): Promise<PostDueForOutcome[]> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const now = parseISO(opts.now)
  const cutoff = formatISO(addDays(now, -OUTCOME_MATURITY_DAYS))
  let query = client
    .from('posts')
    .select('*, post_metrics(*)')
    .eq('business_id', businessId)
    .eq('status', 'published')
    .is('deleted_at', null)
    .not('published_at', 'is', null)
    .lte('published_at', cutoff)
  // Bounds the scan: a post that never got a day-7 sync stays a skip candidate only inside this window.
  if (opts.lookbackDays !== undefined) query = query.gte('published_at', formatISO(addDays(now, -opts.lookbackDays)))
  const { data: posts, error } = await query.order('published_at', { ascending: true }).limit(bound(opts.limit))
  if (error) throw new Error(getErrorMessage(error))
  const rows = (posts ?? []) as Array<PostRow & { post_metrics: PostMetricsRow | PostMetricsRow[] | null }>
  if (rows.length === 0) return []

  const { data: done, error: doneError } = await client
    .from('post_outcomes')
    .select('post_id')
    .eq('business_id', businessId)
    .in('post_id', rows.map((r) => r.id))
  if (doneError) throw new Error(getErrorMessage(doneError))
  const finished = new Set((done ?? []).map((d) => d.post_id as string))

  const due: PostDueForOutcome[] = []
  for (const { post_metrics, ...post } of rows) {
    if (finished.has(post.id)) continue
    const metrics = (Array.isArray(post_metrics) ? post_metrics[0] : post_metrics) ?? null
    const publishedAt = parseISO(post.published_at as string)
    const day7 = addDays(publishedAt, OUTCOME_MATURITY_DAYS)
    if (metrics && parseISO(metrics.last_synced_at) >= day7) {
      due.push({ post: post as PostRow, metrics, due: 'ready' })
    } else if (now >= addDays(publishedAt, OUTCOME_MATURITY_DAYS + OUTCOME_MATURITY_GRACE_DAYS)) {
      due.push({ post: post as PostRow, metrics: null, due: metrics ? 'no_metrics' : 'never_synced' })
    }
  }
  return due
}

export type LatestSnapshot = { id: string; post_id: string; rendered_content: string; format: 'single' | 'thread' }

// The latest revision's snapshot per post (ai_original_id = latest revision; absent for human-written).
export async function listLatestSnapshotsForPosts(businessId: string, postIds: string[]): Promise<LatestSnapshot[]> {
  if (postIds.length === 0) return []
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client
    .from('post_ai_originals')
    .select('id, post_id, revision, rendered_content, format')
    .eq('business_id', businessId)
    .in('post_id', postIds)
    .order('post_id', { ascending: true })
    .order('revision', { ascending: false })
    .limit(Math.min(postIds.length * 20, 2000))
  if (error) throw new Error(getErrorMessage(error))
  const latest = new Map<string, LatestSnapshot>()
  for (const r of data ?? []) {
    if (!latest.has(r.post_id)) {
      latest.set(r.post_id, { id: r.id, post_id: r.post_id, rendered_content: r.rendered_content, format: r.format })
    }
  }
  return [...latest.values()]
}

export type PostDimensionsForTagging = {
  ai_original_id: string
  role: string | null
  format: string | null
  origin_mode: string | null
}

// The generation-time dimensions (ADR 0026 s4.2) of the given snapshots, business-scoped. Read only —
// post_dimensions is written by the AFTER INSERT trigger and nothing else.
export async function listPostDimensionsBySnapshot(businessId: string, aiOriginalIds: string[]): Promise<PostDimensionsForTagging[]> {
  if (aiOriginalIds.length === 0) return []
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client
    .from('post_dimensions')
    .select('ai_original_id, role, format, origin_mode')
    .eq('business_id', businessId)
    .in('ai_original_id', aiOriginalIds)
    .order('ai_original_id', { ascending: true })
    .limit(Math.min(aiOriginalIds.length, 2000))
  if (error) throw new Error(getErrorMessage(error))
  return (data ?? []) as PostDimensionsForTagging[]
}

export type EngagementSeed ={ value: number; basis: 'rate' | 'count' }

// The imported X engagement baseline (ADR 0026 §6.3). Maps social_backfill_runs.summary's vocabulary:
// 'impressions' -> 'rate', 'raw' -> 'count', 'none' -> no seed. The normaliser enforces the basis match.
//
// The seed comes only from a run whose extraction FINISHED (Session 33-D D6, NIT-3). ADR 0025 §6 defines the run
// states queued -> fetching -> extracting -> awaiting_ratification -> ratified (plus unsupported / failed / discarded);
// it has no 'completed'. The summary is written DURING extraction, so a run that later failed, was discarded or is
// still running can already carry an engagementBaseline — that must never seed a brand's baseline.
export const SEED_RUN_STATUSES: readonly BackfillRunStatus[] = ['awaiting_ratification', 'ratified']

export async function getEngagementSeed(businessId: string, platform: string): Promise<EngagementSeed | null> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client
    .from('social_backfill_runs')
    .select('summary')
    .eq('business_id', businessId)
    .eq('platform', platform)
    .in('status', [...SEED_RUN_STATUSES])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(getErrorMessage(error))
  const summary = (data?.summary ?? {}) as { engagementBaseline?: unknown; engagementBaselineBasis?: unknown }
  const value = summary.engagementBaseline
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (summary.engagementBaselineBasis === 'impressions') return { value, basis: 'rate' }
  if (summary.engagementBaselineBasis === 'raw') return { value, basis: 'count' }
  return null
}

// ── Analytics reads (ADR 0031 §9.1; Session 37 O2.4) ──────────────────────────────────────────────────────────
// AUTHENTICATED, business-bound, keyset-paged on (published_at DESC, post_id DESC). They ride
// post_outcomes_business_platform_published_idx. `log_lift` is never selected (it is rendered nowhere, ADR 0031 §2.4).

export const ANALYTICS_OUTCOMES_PAGE = 500
export const ANALYTICS_TREND_PAGE = 1000

export interface OutcomeForAnalytics {
  post_id: string
  business_id: string
  platform: string
  published_at: string
  ai_original_id: string | null
  metric_basis: 'rate' | 'count'
  value: number
  beat_baseline: boolean | null
  baseline_source: 'own' | 'import_seed' | null
  length_band: 'short' | 'medium' | 'long' | null
  cta_present: boolean | null
  hook_survived: boolean | null
  measured_at: string
}

const OUTCOME_ANALYTICS_COLUMNS =
  'post_id, business_id, platform, published_at, ai_original_id, metric_basis, value, beat_baseline, baseline_source, length_band, cta_present, hook_survived, measured_at'

export interface OutcomeRangeQuery {
  platform: string
  /** published_at >= start */
  start: string
  /** published_at < end */
  end: string
  /** measured_at <= outcomesThrough: every read behind one view is bounded by the SAME instant ([db-1]). */
  outcomesThrough: string
}

async function readOutcomes(
  read: string,
  client: SupabaseClient,
  businessId: string,
  q: OutcomeRangeQuery,
  maxPage: number,
  requested: number | undefined,
): Promise<OutcomeForAnalytics[]> {
  const pageSize = Math.min(Math.max(Math.trunc(requested ?? maxPage), 1), maxPage)
  return readAllPages<OutcomeForAnalytics>({
    read,
    pageSize,
    fetchPage: async (after, limit) => {
      let query = client
        .from('post_outcomes')
        .select(OUTCOME_ANALYTICS_COLUMNS)
        .eq('business_id', businessId)
        .eq('platform', q.platform)
        .gte('published_at', q.start)
        .lt('published_at', q.end)
        .lte('measured_at', q.outcomesThrough)
      if (after) query = query.or(keysetFilterDesc('published_at', 'post_id', { primary: after.published_at, tiebreak: after.post_id }))
      const { data, error } = await query
        .order('published_at', { ascending: false })
        .order('post_id', { ascending: false })
        .limit(limit)
      if (error) throw new Error(getErrorMessage(error))
      return ((data ?? []) as Array<Omit<OutcomeForAnalytics, 'value'> & { value: number | string }>).map((r) => ({ ...r, value: Number(r.value) }))
    },
  })
}

// The month's outcomes for one platform, 500 a page.
export function listMonthOutcomes(
  client: SupabaseClient,
  businessId: string,
  q: OutcomeRangeQuery,
  opts: { pageSize?: number } = {},
): Promise<OutcomeForAnalytics[]> {
  return readOutcomes('month outcomes', client, businessId, q, ANALYTICS_OUTCOMES_PAGE, opts.pageSize)
}

// The 12-month trend's outcomes for one platform, 1,000 a page (PostgREST's default max rows).
export function listTrendOutcomes(
  client: SupabaseClient,
  businessId: string,
  q: OutcomeRangeQuery,
  opts: { pageSize?: number } = {},
): Promise<OutcomeForAnalytics[]> {
  return readOutcomes('trend outcomes', client, businessId, q, ANALYTICS_TREND_PAGE, opts.pageSize)
}

export interface DimensionForAnalytics {
  ai_original_id: string
  role: string | null
  format: string | null
  origin_mode: string | null
  hook_type: string | null
}

const DIMENSION_CHUNK = 200

// The generation-time dimensions of the given snapshots, in chunks of 200 ids (a URL and a row bound), business-bound.
export async function listDimensionsForAnalytics(
  client: SupabaseClient,
  businessId: string,
  aiOriginalIds: readonly string[],
): Promise<DimensionForAnalytics[]> {
  const ids = [...new Set(aiOriginalIds)]
  const out: DimensionForAnalytics[] = []
  for (let i = 0; i < ids.length; i += DIMENSION_CHUNK) {
    const { data, error } = await client
      .from('post_dimensions')
      .select('ai_original_id, role, format, origin_mode, hook_type')
      .eq('business_id', businessId)
      .in('ai_original_id', ids.slice(i, i + DIMENSION_CHUNK))
      .order('ai_original_id', { ascending: true })
      .limit(DIMENSION_CHUNK)
    if (error) throw new Error(getErrorMessage(error))
    out.push(...((data ?? []) as DimensionForAnalytics[]))
  }
  return out
}
