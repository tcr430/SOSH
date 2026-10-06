import type { SupabaseClient } from '@supabase/supabase-js'
import { formatISO } from 'date-fns'
import { getBusinessById } from '@/lib/db/businesses'
import { listPublishedPostsInRange, countPublishedPostsInRange, type PublishedPostForAnalytics } from '@/lib/db/posts'
import { listMonthOutcomes, listTrendOutcomes, listDimensionsForAnalytics, type OutcomeForAnalytics, type OutcomeRangeQuery, type DimensionForAnalytics } from '@/lib/db/post-outcomes'
import { listMetricsForPosts, type MetricsForAnalytics } from '@/lib/db/post-metrics'
import { listAccountLabels, type SocialAccountLabel } from '@/lib/db/social-accounts'
import { listCampaigns } from '@/lib/db/campaigns'
import { listCompletedRetrospectivesInRange, type RetrospectiveForAnalytics } from '@/lib/db/campaign-retrospectives'
import { ReadCeilingExceeded } from '@/lib/db/keyset-pager'
import type { BusinessRow, CampaignRow, Platform } from '@/lib/db/types'
import { listOutcomePatterns } from '@/lib/db/memory-performance'
import { selectOutcomePatterns, type OutcomeObservation, type OutcomePatternRow } from '@/lib/memory'
import { parsePatternKey } from '@/lib/outcomes/pattern-key'
import { metricsReadAvailableFor } from '@/lib/social'
import { hasAdvancedAnalytics } from '@/lib/stripe/plan'
import { OUTCOME_MATURITY_DAYS } from '@/lib/outcomes/constants'
import { ANALYTICS_COMPARE_FLOOR } from './constants'
import { exclusionReason, type ExclusionReason } from './exclusions'
import { monthOf, periodBounds, previousPeriod, utcIso } from './period'
import { formatRate, typicalOf } from './rates'
import type { AnalyticsOutcome, AnalyticsPostRecord, MetricBasis } from './types'
import {
  monthPairView,
  platformMonthView,
  typicalView,
  winsView,
  type MonthPairView,
  type PlatformMonthView,
  type TypicalView,
  type WinsView,
} from './view-model'
import { winsOf } from './wins'

// ADR 0031 §3, §4, §9 — the loaders the pages (O2.6), the report (O2.7) and the PDF (O2.9) read. Server-side only.
//
//   * `businessId` is ALWAYS the server-side active-business resolver's answer, handed in by the caller; the plan and
//     the timezone are read from that business row, never from the caller.
//   * THE PLAN GATE (ANALYTICS-PLAN-GATE-SERVER): a basic business never causes a Pro reader to run. Not fetched and then
//     hidden: the branch below does not call it, and the returned model is a discriminated union on `tier`, so a Pro
//     key on a basic model does not compile.
//   * UNAVAILABLE BY CAPABILITY: the platform's state comes from `metricsReadAvailable(platform)` (injectable, defaulting
//     to the real one), never from a platform string and never from an absence of rows.
//   * ACCOUNTS: grouped by posts.social_account_id. NULL is its own labelled bucket and is never resolved to a default
//     account (ADR 0031 §4.4).
//   * A ReadCeilingExceeded from the O2.4 readers becomes THAT section's error state; any other failure propagates.
//   * The campaign level stays the shipped /campaigns/[id] view: the table here only links to it.

export interface LoaderDeps {
  metricsReadAvailable: (platform: Platform) => boolean
  /** The clock, injected: also the `outcomes_through` instant every read behind one view is bounded by. */
  now: () => string
  /** Months in the Pro trend: 12 on the live page, 6 in the report (ADR 0031 s5.3 row 8). */
  trendMonths: number
  /** The live page adds hook_type; the report never does ([mle-6]). */
  liveOnlyBreakdowns: boolean
}

const DEFAULT_DEPS: LoaderDeps = {
  metricsReadAvailable: metricsReadAvailableFor,
  now: () => formatISO(new Date()),
  trendMonths: 12,
  liveOnlyBreakdowns: true,
}

export type Section<T> = { status: 'ok'; data: T } | { status: 'error'; reason: 'ceiling' }

async function guarded<T>(read: () => Promise<T>): Promise<Section<T>> {
  try {
    return { status: 'ok', data: await read() }
  } catch (error) {
    if (error instanceof ReadCeilingExceeded) return { status: 'error', reason: 'ceiling' }
    throw error
  }
}

const UNRECORDED_KEY = 'analytics.account.unrecorded'

// ─── view shapes ───────────────────────────────────────────────────────────────────────────────────────────

export interface ActivityRow {
  platform: string
  accountId: string | null
  label: string | null
  /** Set for the NULL bucket (and an account whose label cannot be read): "Account not recorded or since removed". */
  labelKey: typeof UNRECORDED_KEY | null
  count: number
}

export interface Activity {
  total: number
  previousTotal: number
  rows: ActivityRow[]
  campaigns: { active: number; completed: number }
}

export type BasicPlatformMonthView = Omit<PlatformMonthView, 'breakdowns'>

interface PlatformStateBase {
  platform: string
}
export type PlatformSectionOf<V> =
  | (PlatformStateBase & { state: 'unavailable'; published: number })
  | (PlatformStateBase & { state: 'error'; reason: 'ceiling' })
  | (PlatformStateBase & { state: 'immature' | 'measured'; current: V; pair: MonthPairView | null; finalOn: string | null })

export type BasicPlatformSection = PlatformSectionOf<BasicPlatformMonthView>
export type AdvancedPlatformSection = PlatformSectionOf<PlatformMonthView>

/**
 * A pattern as the report STORES it: the parsed cell of the row's pattern_key plus its evidence, and no text. The sentence is
 * rendered from it at read time, in the reader's language (Session 37-D D2, MINOR-7; D6, MAJOR-2).
 */
export interface PatternCell {
  platform: string
  dimension: string
  value: string
  direction: 'above' | 'below'
  basis: 'rate' | 'count'
  wins: number
  n: number
  campaigns: number
}

/** What the loader returns: the live observation (its sentence is shown on the page only) plus the cell, null when the key does not parse. */
export type PatternObservation = OutcomeObservation & { cell: PatternCell | null }

export function patternCellOf(row: Pick<OutcomePatternRow, 'pattern_key' | 'metric_basis' | 'wins' | 'n' | 'campaigns'>): PatternCell | null {
  const key = parsePatternKey(row.pattern_key)
  if (!key || (key.direction !== 'above' && key.direction !== 'below')) return null
  if (row.metric_basis !== 'rate' && row.metric_basis !== 'count') return null
  return { platform: key.platform, dimension: key.dimension, value: key.value, direction: key.direction, basis: row.metric_basis, wins: row.wins, n: row.n, campaigns: row.campaigns }
}

export interface RetroView {
  verdict: { key: string; params: { n: number } }
  beat: { key: 'outcome.retrospective.posts_beat'; params: { wins: number; n: number } } | null
}

export interface CampaignTableRow {
  campaignId: string
  name: string | null
  status: string | null
  published: number
  href: string
  retro: RetroView | null
}

export interface TrendView {
  months: Array<{ period: string; published: number }>
  series: Array<{ platform: string; points: Array<{ period: string; typical: TypicalView; dots: number[]; stats: { median: number; lo: number; hi: number } | null }> }>
}

export interface RetrospectiveListRow extends RetroView {
  campaignId: string
  campaignName: string | null
  completedAt: string
  href: string
}

export interface AccountComparisonRow {
  platform: string
  accountId: string | null
  label: string | null
  labelKey: typeof UNRECORDED_KEY | null
  n: number
  typical: TypicalView
  wins: WinsView
  /** Bars need 10 on EVERY account of the platform; otherwise counts only (ADR 0031 §8.1). */
  comparison: 'bars' | 'counts'
}

interface PortfolioBase<P> {
  period: string
  previousPeriod: string
  activity: Section<Activity>
  platforms: Section<P[]>
  campaigns: Section<CampaignTableRow[]>
}

export type BasicPortfolio = PortfolioBase<BasicPlatformSection> & { tier: 'basic' }
export type AdvancedPortfolio = PortfolioBase<AdvancedPlatformSection> & {
  tier: 'advanced'
  trend: Section<TrendView>
  patterns: Section<PatternObservation[]>
  retrospectives: Section<RetrospectiveListRow[]>
  accounts: Section<AccountComparisonRow[]>
}
export type Portfolio = BasicPortfolio | AdvancedPortfolio

// ─── helpers ───────────────────────────────────────────────────────────────────────────────────────────────

function retroView(r: Pick<RetrospectiveForAnalytics, 'verdict' | 'n' | 'wins'>): RetroView {
  const params = { n: r.n }
  if (r.verdict === 'supported') {
    return { verdict: { key: 'outcome.retrospective.verdict_supported', params }, beat: { key: 'outcome.retrospective.posts_beat', params: { wins: r.wins, n: r.n } } }
  }
  if (r.verdict === 'not_supported') {
    return { verdict: { key: 'outcome.retrospective.verdict_not_supported', params }, beat: { key: 'outcome.retrospective.posts_beat', params: { wins: r.wins, n: r.n } } }
  }
  // 'inconclusive' states only its n, exactly as RetrospectiveCard does.
  return { verdict: { key: 'outcome.retrospective.inconclusive', params }, beat: null }
}

function labelOf(accountId: string | null, labels: ReadonlyMap<string, SocialAccountLabel>): { label: string | null; labelKey: typeof UNRECORDED_KEY | null } {
  if (accountId === null) return { label: null, labelKey: UNRECORDED_KEY }
  const row = labels.get(accountId)
  if (!row) return { label: null, labelKey: UNRECORDED_KEY }
  return { label: row.platform_display_name ?? row.platform_username, labelKey: null }
}

async function readLabels(r: Readers, businessId: string, accountIds: ReadonlyArray<string | null>): Promise<Map<string, SocialAccountLabel>> {
  const ids = [...new Set(accountIds.filter((id): id is string => id !== null))]
  if (ids.length === 0) return new Map()
  return new Map((await r.listAccountLabels(businessId, ids)).map((l) => [l.id, l]))
}

function toOutcome(row: OutcomeForAnalytics, dimensions: ReadonlyMap<string, DimensionForAnalytics>): AnalyticsOutcome {
  const d = row.ai_original_id ? dimensions.get(row.ai_original_id) : undefined
  return {
    postId: row.post_id,
    platform: row.platform,
    basis: row.metric_basis as MetricBasis,
    value: row.value,
    publishedAt: row.published_at,
    beatBaseline: row.beat_baseline,
    baselineSource: row.baseline_source,
    lengthBand: row.length_band,
    ctaPresent: row.cta_present,
    hookSurvived: row.hook_survived,
    // A snapshot with a null classification is unclassified (no dimensions), not a made-up bucket.
    dimensions: d && d.role !== null && d.format !== null && d.origin_mode !== null ? { role: d.role, format: d.format, originMode: d.origin_mode, hookType: d.hook_type } : null,
  }
}

interface MeasuredPlatform {
  state: 'immature' | 'measured'
  view: PlatformMonthView
  pair: MonthPairView | null
  /** For an immature platform: when the last of its posts becomes final (UTC). Null otherwise. */
  finalOn: string | null
  /** The current month's measured outcomes of this platform. */
  outcomes: AnalyticsOutcome[]
}

function shiftBack(period: string, months: number): string {
  let p = period
  for (let i = 0; i < months; i += 1) p = previousPeriod(p)
  return p
}

// ─── loadPortfolio ─────────────────────────────────────────────────────────────────────────────────────────

export async function loadPortfolioWith(
  r: Readers,
  businessId: string,
  month: string,
  deps: Partial<LoaderDeps> = {},
): Promise<Portfolio> {
  const d: LoaderDeps = { ...DEFAULT_DEPS, ...deps }
  const previous = previousPeriod(month) // validates the month before any read
  const business = await r.getBusinessById(businessId)
  const advanced = hasAdvancedAnalytics(business.plan)
  const timezone = business.timezone
  const now = d.now()
  const current = periodBounds(month, timezone)
  const before = periodBounds(previous, timezone)
  const range = { start: before.start, end: current.end }

  const [campaigns, monthRetros] = await Promise.all([
    r.listCampaigns(businessId),
    r.listCompletedRetrospectivesInRange(businessId, current),
  ])
  const campaignById = new Map(campaigns.map((c) => [c.id, c]))

  const postsSection = await guarded(() => r.listPublishedPostsInRange(businessId, range))
  if (postsSection.status === 'error') {
    return assemble(false, { period: month, previousPeriod: previous, activity: postsSection, platforms: postsSection, campaigns: postsSection }, null)
  }
  const allPosts = postsSection.data
  const monthPosts = allPosts.filter((p) => monthOf(p.published_at, timezone) === month)
  const previousPosts = allPosts.filter((p) => monthOf(p.published_at, timezone) === previous)

  const labels = await readLabels(r, businessId, monthPosts.map((p) => p.social_account_id))

  // Activity: platform x account, the NULL account in its own bucket, in a stable order (platform, then account, NULL last).
  const counts = new Map<string, ActivityRow>()
  for (const p of monthPosts) {
    const key = p.platform + '|' + (p.social_account_id ?? '')
    const row = counts.get(key) ?? { platform: p.platform, accountId: p.social_account_id, ...labelOf(p.social_account_id, labels), count: 0 }
    row.count += 1
    counts.set(key, row)
  }
  const activity: Activity = {
    total: monthPosts.length,
    previousTotal: previousPosts.length,
    rows: [...counts.values()].sort((a, b) => (a.platform === b.platform ? compareAccounts(a.accountId, b.accountId) : a.platform.localeCompare(b.platform))),
    campaigns: {
      active: campaigns.filter((c) => c.status === 'active').length,
      completed: campaigns.filter((c) => c.status === 'completed').length,
    },
  }

  // Platforms present this month, in a stable order. The capability decides each one's state.
  const platformNames = [...new Set(monthPosts.map((p) => p.platform))].sort()
  const measuredByPlatform = new Map<string, MeasuredPlatform>()
  const sections: AdvancedPlatformSection[] = []
  for (const platform of platformNames) {
    const published = monthPosts.filter((p) => p.platform === platform)
    if (!d.metricsReadAvailable(platform as Platform)) {
      sections.push({ platform, state: 'unavailable', published: published.length })
      continue
    }
    const measured = await guarded(() => measurePlatform({ r, businessId, platform, month, previous, timezone, now, range, monthPosts: published, advanced, liveOnly: d.liveOnlyBreakdowns }))
    if (measured.status === 'error') {
      sections.push({ platform, state: 'error', reason: 'ceiling' })
      continue
    }
    measuredByPlatform.set(platform, measured.data)
    sections.push({ platform, state: measured.data.state, current: measured.data.view, pair: measured.data.pair, finalOn: measured.data.finalOn })
  }

  // The campaign table: activity and the retrospective verdict and n only; each row links to the shipped campaign view.
  const published = new Map<string, number>()
  for (const p of monthPosts) published.set(p.campaign_id, (published.get(p.campaign_id) ?? 0) + 1)
  const retroByCampaign = new Map(monthRetros.map((r) => [r.campaign_id, r]))
  const campaignRows: CampaignTableRow[] = [...new Set([...published.keys(), ...retroByCampaign.keys()])]
    .map((id) => {
      const retro = retroByCampaign.get(id)
      return {
        campaignId: id,
        name: campaignById.get(id)?.name ?? null,
        status: campaignById.get(id)?.status ?? null,
        published: published.get(id) ?? 0,
        href: '/campaigns/' + id,
        retro: retro ? retroView(retro) : null,
      }
    })
    .sort((a, b) => b.published - a.published || (a.name ?? '').localeCompare(b.name ?? ''))

  const base: PortfolioBase<AdvancedPlatformSection> = {
    period: month,
    previousPeriod: previous,
    activity: { status: 'ok', data: activity },
    platforms: { status: 'ok', data: sections },
    campaigns: { status: 'ok', data: campaignRows },
  }
  if (!advanced) return assemble(false, base, null)

  // ── Pro only. Nothing below runs for a basic business. ──
  const first = periodBounds(shiftBack(month, d.trendMonths - 1), timezone)
  const trend = await guarded(async (): Promise<TrendView> => {
    const months: TrendView['months'] = []
    for (let i = d.trendMonths - 1; i >= 0; i -= 1) {
      const period = shiftBack(month, i)
      months.push({ period, published: await r.countPublishedPostsInRange(businessId, periodBounds(period, timezone)) })
    }
    const series: TrendView['series'] = []
    for (const [platform, m] of measuredByPlatform) {
      if (m.view.basis !== 'rate') continue
      const rows = await r.listTrendOutcomes(businessId, { platform, start: first.start, end: current.end, outcomesThrough: now })
      series.push({
        platform,
        points: months.map(({ period }) => {
          const values = rows.filter((r) => r.metric_basis === 'rate' && monthOf(r.published_at, timezone) === period).map((r) => r.value)
          const typical = typicalView(values)
          // Dots only for a month that reaches the floor: below it nothing is drawn (a gap, never a mark).
          const t = typical.state === 'number' ? typicalOf(values) : null
          return { period, typical, dots: t ? values : [], stats: t ? { median: t.median, lo: t.range.lo, hi: t.range.hi } : null }
        }),
      })
    }
    return { months, series }
  })
  // Patterns are a Readers member like every other read (Session 37-D D1): the page binds the AUTHENTICATED client, the
  // report worker binds a verified service-role wrapper. The row's identity (business_id, pattern_key) stays inside the
  // reader; the portfolio carries only the observation.
  const patterns = await guarded(async (): Promise<PatternObservation[]> =>
    (await r.listPatterns(businessId, {})).map((row) => ({ platform: row.platform, pattern: row.pattern, wins: row.wins, n: row.n, campaigns: row.campaigns, cell: patternCellOf(row) })),
  )
  const retrospectives = await guarded(async (): Promise<RetrospectiveListRow[]> => {
    const rows = await r.listCompletedRetrospectivesInRange(businessId, { start: first.start, end: current.end })
    return rows.map((r) => ({
      ...retroView(r),
      campaignId: r.campaign_id,
      campaignName: campaignById.get(r.campaign_id)?.name ?? null,
      completedAt: r.completed_at,
      href: '/campaigns/' + r.campaign_id,
    }))
  })

  const accountOf = new Map(monthPosts.map((p) => [p.id, p.social_account_id]))
  const accounts: AccountComparisonRow[] = []
  for (const [platform, m] of measuredByPlatform) {
    if (m.view.basis !== 'rate') continue
    const byAccount = new Map<string, { accountId: string | null; rows: AnalyticsOutcome[] }>()
    for (const o of m.outcomes) {
      const accountId = accountOf.get(o.postId) ?? null
      const group = byAccount.get(accountId ?? '') ?? { accountId, rows: [] }
      group.rows.push(o)
      byAccount.set(accountId ?? '', group)
    }
    const groups = [...byAccount.values()].sort((a, b) => b.rows.length - a.rows.length || compareAccounts(a.accountId, b.accountId))
    const comparison = groups.length >= 2 && groups.every((g) => g.rows.length >= ANALYTICS_COMPARE_FLOOR) ? 'bars' : 'counts'
    for (const g of groups) {
      accounts.push({
        platform,
        accountId: g.accountId,
        ...labelOf(g.accountId, labels),
        n: g.rows.length,
        typical: typicalView(g.rows.map((r) => r.value)),
        wins: winsView(winsOf(g.rows)),
        comparison,
      })
    }
  }

  return assemble(true, base, { trend, patterns, retrospectives, accounts: { status: 'ok', data: accounts } })
}

function compareAccounts(a: string | null, b: string | null): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a.localeCompare(b)
}

interface ProParts {
  trend: Section<TrendView>
  patterns: Section<PatternObservation[]>
  retrospectives: Section<RetrospectiveListRow[]>
  accounts: Section<AccountComparisonRow[]>
}

// The ONE place a Portfolio is assembled: a basic model is cut down to the allowed tier here, on the server.
function assemble(advanced: boolean, base: PortfolioBase<AdvancedPlatformSection>, pro: ProParts | null): Portfolio {
  if (advanced && pro) return { ...base, tier: 'advanced', ...pro }
  const platforms: Section<BasicPlatformSection[]> =
    base.platforms.status === 'ok' ? { status: 'ok', data: base.platforms.data.map(toBasicSection) } : base.platforms
  return { period: base.period, previousPeriod: base.previousPeriod, activity: base.activity, platforms, campaigns: base.campaigns, tier: 'basic' }
}

function toBasicSection(section: AdvancedPlatformSection): BasicPlatformSection {
  if (section.state === 'unavailable' || section.state === 'error') return section
  const { breakdowns: omitted, ...current } = section.current
  void omitted
  return { platform: section.platform, state: section.state, current, pair: section.pair, finalOn: section.finalOn }
}

async function measurePlatform(input: {
  r: Readers
  businessId: string
  platform: string
  month: string
  previous: string
  timezone: string
  now: string
  range: { start: string; end: string }
  monthPosts: PublishedPostForAnalytics[]
  advanced: boolean
  liveOnly: boolean
}): Promise<MeasuredPlatform> {
  const { r, businessId, platform, month, previous, timezone, now, range, monthPosts, advanced, liveOnly } = input
  const raw = await r.listMonthOutcomes(businessId, { platform, start: range.start, end: range.end, outcomesThrough: now })

  // Pro breakdowns need the generation-time dimensions; a basic business never reads them.
  let dimensions = new Map<string, DimensionForAnalytics>()
  if (advanced) {
    const ids = raw.flatMap((r) => (r.ai_original_id ? [r.ai_original_id] : []))
    if (ids.length > 0) dimensions = new Map((await r.listDimensionsForAnalytics(businessId, ids)).map((x) => [x.ai_original_id, x]))
  }
  const outcomes = raw.map((r) => toOutcome(r, dimensions))
  const currentOutcomes = outcomes.filter((o) => monthOf(o.publishedAt, timezone) === month)
  const previousRates = outcomes.filter((o) => monthOf(o.publishedAt, timezone) === previous && o.basis === 'rate').map((o) => o.value)

  const measuredIds = new Set(currentOutcomes.map((o) => o.postId))
  const unmeasured = monthPosts.filter((p) => !measuredIds.has(p.id)).map((p) => p.id)
  const metrics = new Map<string, MetricsForAnalytics>()
  if (unmeasured.length > 0) for (const m of await r.listMetricsForPosts(businessId, unmeasured)) metrics.set(m.post_id, m)

  const byId = new Map(currentOutcomes.map((o) => [o.postId, o]))
  const records: AnalyticsPostRecord[] = monthPosts.map((p) => ({
    post: { postId: p.id, platform: p.platform, publishedAt: p.published_at },
    metrics: metrics.get(p.id) ?? null,
    outcome: byId.get(p.id) ?? null,
  }))
  const view = platformMonthView({ platform, period: month, timezone, now, records, includeLiveOnly: advanced && liveOnly })

  const notFinal = view.exclusions.reasons.find((r) => r.key === 'analytics.exclusions.notFinal')?.count ?? 0
  const state = view.exclusions.params.measured === 0 && notFinal === view.exclusions.params.published ? 'immature' : 'measured'
  const pair =
    view.basis === 'rate'
      ? monthPairView({ period: previous, values: previousRates }, { period: month, values: currentOutcomes.filter((o) => o.basis === 'rate').map((o) => o.value) })
      : null
  const latest = Math.max(...monthPosts.map((p) => new Date(p.published_at).getTime()))
  const finalOn = state === 'immature' ? utcIso(new Date(latest + OUTCOME_MATURITY_DAYS * 86_400_000)) : null
  return { state, view, pair, finalOn, outcomes: currentOutcomes }
}

// ─── loadPosts ─────────────────────────────────────────────────────────────────────────────────────────────

export interface PostFilters {
  /** YYYY-MM in the business timezone. */
  period: string
  platform?: string
  /** An account id, or 'none' for the NULL bucket. */
  accountId?: string
  campaignId?: string
}

export type PostRowState = 'unavailable' | 'measuring' | 'so_far' | 'final' | 'not_measured'

export interface PostRowView {
  postId: string
  platform: string
  publishedAt: string
  accountId: string | null
  accountLabel: string | null
  accountLabelKey: typeof UNRECORDED_KEY | null
  campaignId: string
  campaignName: string | null
  state: PostRowState
  /** state = 'final': the day-7 value, as a rate token (X) or a count (LinkedIn), with its badge. */
  final?: { basis: MetricBasis; value: number; rate: string | null; badge: 'above' | 'below' | 'no_baseline' }
  /** state = 'so_far': the raw counts as of the last sync, never compared. */
  soFar?: { likes: number | null; comments: number | null; shares: number | null; impressions: number | null; asOf: string }
  /** state = 'so_far' or 'measuring': the instant the post becomes final. */
  finalOn?: string
  /** state = 'not_measured': why. */
  reason?: Exclude<ExclusionReason, 'not_final'>
}

export interface PostsView {
  tier: 'basic' | 'advanced'
  period: string
  posts: Section<PostRowView[]>
}

export async function loadPostsWith(
  r: Readers,
  businessId: string,
  filters: PostFilters,
  deps: Partial<LoaderDeps> = {},
): Promise<PostsView> {
  const d: LoaderDeps = { ...DEFAULT_DEPS, ...deps }
  previousPeriod(filters.period) // validates the period before any read
  const business = await r.getBusinessById(businessId)
  const tier = hasAdvancedAnalytics(business.plan) ? 'advanced' : 'basic'
  const timezone = business.timezone
  const now = d.now()
  const bounds = periodBounds(filters.period, timezone)

  const posts = await guarded(async (): Promise<PostRowView[]> => {
    const all = await r.listPublishedPostsInRange(businessId, bounds)
    const wanted = all.filter(
      (p) =>
        (filters.platform === undefined || p.platform === filters.platform) &&
        (filters.accountId === undefined || (filters.accountId === 'none' ? p.social_account_id === null : p.social_account_id === filters.accountId)) &&
        (filters.campaignId === undefined || p.campaign_id === filters.campaignId),
    )
    if (wanted.length === 0) return []

    const labels = await readLabels(r, businessId, wanted.map((p) => p.social_account_id))
    const campaignNames = new Map((await r.listCampaigns(businessId)).map((c) => [c.id, c.name]))

    // Outcomes only for platforms whose capability says metrics are read; never for the others.
    const capable = [...new Set(wanted.map((p) => p.platform))].filter((p) => d.metricsReadAvailable(p as Platform))
    const outcomes = new Map<string, OutcomeForAnalytics>()
    for (const platform of capable) {
      for (const o of await r.listMonthOutcomes(businessId, { platform, start: bounds.start, end: bounds.end, outcomesThrough: now })) outcomes.set(o.post_id, o)
    }
    const unmeasured = wanted.filter((p) => capable.includes(p.platform) && !outcomes.has(p.id)).map((p) => p.id)
    const metrics = new Map<string, MetricsForAnalytics>()
    if (unmeasured.length > 0) for (const m of await r.listMetricsForPosts(businessId, unmeasured)) metrics.set(m.post_id, m)

    return wanted.map((p): PostRowView => {
      const account = labelOf(p.social_account_id, labels)
      const base = {
        postId: p.id,
        platform: p.platform,
        publishedAt: p.published_at,
        accountId: p.social_account_id,
        accountLabel: account.label,
        accountLabelKey: account.labelKey,
        campaignId: p.campaign_id,
        campaignName: campaignNames.get(p.campaign_id) ?? null,
      }
      if (!capable.includes(p.platform)) return { ...base, state: 'unavailable' }
      const outcome = outcomes.get(p.id)
      if (outcome) {
        const value = Number(outcome.value)
        const badge = outcome.beat_baseline === null ? 'no_baseline' : outcome.beat_baseline ? 'above' : 'below'
        return { ...base, state: 'final', final: { basis: outcome.metric_basis as MetricBasis, value, rate: outcome.metric_basis === 'rate' ? formatRate(value) : null, badge } }
      }
      const m = metrics.get(p.id) ?? null
      const reason = exclusionReason({ postId: p.id, platform: p.platform, publishedAt: p.published_at }, null, m, now)
      if (reason === 'not_final') {
        const finalOn = utcIso(new Date(new Date(p.published_at).getTime() + OUTCOME_MATURITY_DAYS * 86_400_000))
        if (!m) return { ...base, state: 'measuring', finalOn }
        return { ...base, state: 'so_far', soFar: { likes: m.likes, comments: m.comments, shares: m.shares, impressions: m.impressions, asOf: m.last_synced_at }, finalOn }
      }
      return { ...base, state: 'not_measured', reason: reason as Exclude<ExclusionReason, 'not_final'> }
    })
  })

  return { tier, period: filters.period, posts }
}

// ─── the readers: authenticated for the pages, business-verified service-role for the report worker ────────

/** Every read the loaders make, with the business id as its first argument. The page binds the caller's AUTHENTICATED client; the report worker binds the service-role wrappers and verifies every row (lib/reports/isolation.ts). */
export interface Readers {
  getBusinessById: (businessId: string) => Promise<BusinessRow>
  listCampaigns: (businessId: string) => Promise<CampaignRow[]>
  listCompletedRetrospectivesInRange: (businessId: string, range: { start: string; end: string }) => Promise<RetrospectiveForAnalytics[]>
  listPublishedPostsInRange: (businessId: string, range: { start: string; end: string }) => Promise<PublishedPostForAnalytics[]>
  countPublishedPostsInRange: (businessId: string, range: { start: string; end: string }) => Promise<number>
  listMonthOutcomes: (businessId: string, q: OutcomeRangeQuery) => Promise<OutcomeForAnalytics[]>
  listTrendOutcomes: (businessId: string, q: OutcomeRangeQuery) => Promise<OutcomeForAnalytics[]>
  listDimensionsForAnalytics: (businessId: string, ids: readonly string[]) => Promise<DimensionForAnalytics[]>
  listMetricsForPosts: (businessId: string, ids: readonly string[]) => Promise<MetricsForAnalytics[]>
  listAccountLabels: (businessId: string, ids: readonly string[]) => Promise<SocialAccountLabel[]>
  /** The business's ACTIVE outcome patterns, already eligible, ranked and capped (lib/memory selectOutcomePatterns). Rows carry business_id so the worker can verify them. */
  listPatterns: (businessId: string, options: { platform?: string }) => Promise<OutcomePatternRow[]>
}

export function authenticatedReaders(client: SupabaseClient): Readers {
  return {
    getBusinessById: (id) => getBusinessById(client, id),
    listCampaigns: (id) => listCampaigns(client, id),
    listCompletedRetrospectivesInRange: (id, range) => listCompletedRetrospectivesInRange(client, id, range),
    listPublishedPostsInRange: (id, range) => listPublishedPostsInRange(client, id, range),
    countPublishedPostsInRange: (id, range) => countPublishedPostsInRange(client, id, range),
    listMonthOutcomes: (id, q) => listMonthOutcomes(client, id, q),
    listTrendOutcomes: (id, q) => listTrendOutcomes(client, id, q),
    listDimensionsForAnalytics: (id, ids) => listDimensionsForAnalytics(client, id, ids),
    listMetricsForPosts: (id, ids) => listMetricsForPosts(client, id, ids),
    listAccountLabels: (id, ids) => listAccountLabels(client, id, ids),
    // listOutcomePatterns takes the caller's client: the performance_memory SELECT policy scopes the read. Never the
    // ForGeneration variant, which acquires the service-role client (scan #16, arm 2).
    listPatterns: async (id, options) => selectOutcomePatterns(await listOutcomePatterns(client, id, { status: 'active', platform: options.platform }), options),
  }
}

export function loadPortfolio(client: SupabaseClient, businessId: string, month: string, deps: Partial<LoaderDeps> = {}): Promise<Portfolio> {
  return loadPortfolioWith(authenticatedReaders(client), businessId, month, deps)
}

export function loadPosts(client: SupabaseClient, businessId: string, filters: PostFilters, deps: Partial<LoaderDeps> = {}): Promise<PostsView> {
  return loadPostsWith(authenticatedReaders(client), businessId, filters, deps)
}
