import type { OutcomeObservation } from '@/lib/memory'
import type { OutcomeForAnalytics } from '@/lib/db/post-outcomes'
import { loadPortfolioWith, type Activity, type AdvancedPortfolio, type CampaignTableRow, type LoaderDeps, type Readers, type TrendView } from '@/lib/analytics/load'
import { periodBounds } from '@/lib/analytics/period'
import { formatRate } from '@/lib/analytics/rates'
import { ANALYTICS_DISPLAY_FLOOR } from '@/lib/analytics/constants'
import type { BreakdownView, MonthPairView, PlatformMonthView, TypicalView, WinsView } from '@/lib/analytics/view-model'
import { REPORT_KEYS, REPORT_METHODOLOGY_KEYS, REPORT_SCHEMA_VERSION, REPORT_TOP_POSTS, REPORT_TREND_MONTHS } from './constants'
import { verifiedReaders } from './isolation'

// ADR 0031 §5.3, §9.3 — assemble ONE business's report for ONE month, as data: the eleven sections in order, as template
// KEYS and PARAMS, with no post text. Deterministic: no model, no clock (the instant is an argument), no I/O but the
// verified readers.
//
//   * `outcomes_through` is set ONCE (the `now` argument) and bounds every read behind the report ([db-1]).
//   * The aggregation is the loaders' own (loadPortfolioWith over the VERIFIED readers), so the report can never disagree
//     with the live page about what a number is. The report asks for a 6-month trend and no `hook_type` ([mle-6]).
//   * The tier is read HERE from the plan on the business row (hasAdvancedAnalytics inside the loader); a Pro section is
//     simply absent from a basic payload. Nothing in an input can set it.
//   * Cited post ids are drawn ONLY from rows the isolation wrapper has already verified.
//   * Section 5 ranks by `post_outcomes.value`; nothing on this report comes from `post_metrics` except the exclusion
//     reasons, which the view model counts and never ranks.

export interface SummaryLine {
  key: string
  params: Record<string, string | number>
}

export interface TopPost {
  postId: string
  /** The day-7 rate as a token, e.g. "6.4%". */
  rate: string
  badge: 'above' | 'below' | 'no_baseline'
}

export interface PlatformResult {
  platform: string
  state: 'immature' | 'measured'
  current: Omit<PlatformMonthView, 'breakdowns'>
  pair: MonthPairView | null
  finalOn: string | null
}

interface PayloadBase {
  schemaVersion: number
  period: string
  timezone: string
  /** "measured as of": every read behind the report was bounded by it. */
  outcomesThrough: string
  generatedAt: string
  tier: 'basic' | 'advanced'
  stub: boolean
  header: { key: string; params: { business: string; month: string; measuredAsOf: string; generatedOn: string } }
  summary: SummaryLine[]
  /** Section 11: every closed methodology key, in every payload. */
  methodology: { keys: readonly string[] }
}

export interface FullPayloadParts {
  activity: Activity
  xResults: PlatformResult[]
  ratedPosts: { titleKey: string; caveatKey: string; state: 'shown' | 'absent'; byPlatform: Array<{ platform: string; posts: TopPost[] }> }
  /** Section 6: platforms whose capability says metrics are not read: activity only. */
  unavailable: Array<{ platform: string; published: number }>
  campaigns: CampaignTableRow[]
  /** "Posts measured after {date} are not included." */
  lateOutcomes: { key: string; params: { date: string } }
}

export interface ProParts {
  trend: TrendView
  observed: Array<{ platform: string; breakdowns: BreakdownView[] }>
  patterns: OutcomeObservation[]
}

export type ReportPayload = PayloadBase & Partial<FullPayloadParts> & Partial<ProParts>

export interface AssembledReport {
  /** `YYYY-MM-01`. */
  periodMonth: string
  tier: 'basic' | 'advanced'
  stub: boolean
  outcomesThrough: string
  generatedAt: string
  payload: ReportPayload
}

/** Rank by day-7 value DESC, ties by published_at DESC (then post id, so the order is total). A rate basis only. */
export function rankTopPosts(rows: readonly OutcomeForAnalytics[], limit = REPORT_TOP_POSTS): OutcomeForAnalytics[] {
  return rows
    .filter((r) => r.metric_basis === 'rate')
    .sort((a, b) => b.value - a.value || b.published_at.localeCompare(a.published_at) || b.post_id.localeCompare(a.post_id))
    .slice(0, limit)
}

function badgeOf(beat: boolean | null): TopPost['badge'] {
  return beat === null ? 'no_baseline' : beat ? 'above' : 'below'
}

function typicalLines(view: TypicalView | WinsView | null): SummaryLine[] {
  if (!view || view.state === 'thin') return []
  return [{ key: view.key, params: view.params as unknown as Record<string, string | number> }]
}

export interface AssembleInput {
  /** The UNVERIFIED readers (service-role in production); the assembler wraps them. */
  readers: Readers
  businessId: string
  /** `YYYY-MM`. */
  period: string
  /** The instant: `outcomes_through` and `generated_at`. */
  now: string
  loaderDeps?: Partial<LoaderDeps>
}

export async function assembleReport(input: AssembleInput): Promise<AssembledReport> {
  const { businessId, period, now } = input
  const readers = verifiedReaders(input.readers, businessId)
  const business = await readers.getBusinessById(businessId)
  const timezone = business.timezone
  const bounds = periodBounds(period, timezone)

  const portfolio = await loadPortfolioWith(readers, businessId, period, {
    ...input.loaderDeps,
    now: () => now,
    trendMonths: REPORT_TREND_MONTHS,
    liveOnlyBreakdowns: false,
  })
  // A section over the read ceiling fails THIS business's report (the next tick retries); a number over part of the data
  // is never stored.
  if (portfolio.activity.status === 'error' || portfolio.platforms.status === 'error' || portfolio.campaigns.status === 'error') {
    throw new Error('report: a read exceeded its ceiling for business ' + businessId + '; no report is stored')
  }

  const base: PayloadBase = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    period,
    timezone,
    outcomesThrough: now,
    generatedAt: now,
    tier: portfolio.tier,
    stub: false,
    header: { key: REPORT_KEYS.header, params: { business: business.name, month: period, measuredAsOf: now, generatedOn: now } },
    summary: [],
    methodology: { keys: REPORT_METHODOLOGY_KEYS },
  }
  const periodMonth = period + '-01'

  const activity = portfolio.activity.data
  // §5.6: nothing published in the month (a live business): a STUB, so the history has no gap. No email (O2.8).
  if (activity.total === 0) {
    return {
      periodMonth,
      tier: portfolio.tier,
      stub: true,
      outcomesThrough: now,
      generatedAt: now,
      payload: { ...base, stub: true, summary: [{ key: REPORT_KEYS.stub, params: { month: period } }] },
    }
  }

  const sections = portfolio.platforms.data
  const unavailable = sections.flatMap((s) => (s.state === 'unavailable' ? [{ platform: s.platform, published: s.published }] : []))
  const xResults: PlatformResult[] = []
  for (const s of sections) {
    if (s.state === 'unavailable') continue
    if (s.state === 'error') throw new Error('report: the ' + s.platform + ' outcomes read exceeded its ceiling for business ' + businessId + '; no report is stored')
    const { breakdowns: omitted, ...current } = s.current as PlatformMonthView
    void omitted
    xResults.push({ platform: s.platform, state: s.state, current, pair: s.pair, finalOn: s.finalOn })
  }

  // Section 5: per RATE platform with at least the display floor of measured posts; from post_outcomes only.
  const byPlatform: Array<{ platform: string; posts: TopPost[] }> = []
  for (const r of xResults) {
    if (r.current.basis !== 'rate') continue
    const rows = await readers.listMonthOutcomes(businessId, { platform: r.platform, start: bounds.start, end: bounds.end, outcomesThrough: now })
    const rates = rows.filter((o) => o.metric_basis === 'rate')
    if (rates.length < ANALYTICS_DISPLAY_FLOOR) continue
    byPlatform.push({
      platform: r.platform,
      posts: rankTopPosts(rates).map((o) => ({ postId: o.post_id, rate: formatRate(o.value) as string, badge: badgeOf(o.beat_baseline) })),
    })
  }

  const summary: SummaryLine[] = [{ key: 'analytics.activity.total', params: { count: activity.total, prev: activity.previousTotal } }]
  for (const r of xResults) {
    summary.push(...typicalLines(r.current.typical), ...typicalLines(r.current.wins))
  }

  const full: FullPayloadParts = {
    activity,
    xResults,
    ratedPosts: { titleKey: REPORT_KEYS.ratedPostsTitle, caveatKey: REPORT_KEYS.ratedPostsCaveat, state: byPlatform.length > 0 ? 'shown' : 'absent', byPlatform },
    unavailable,
    campaigns: portfolio.campaigns.data,
    lateOutcomes: { key: REPORT_KEYS.lateOutcomes, params: { date: now } },
  }

  // Pro sections exist ONLY on the advanced tier. A basic payload has no such key at all.
  let pro: Partial<ProParts> = {}
  if (portfolio.tier === 'advanced') {
    const adv: AdvancedPortfolio = portfolio
    if (adv.trend.status === 'error' || adv.patterns.status === 'error') throw new Error('report: a Pro read exceeded its ceiling for business ' + businessId + '; no report is stored')
    pro = {
      ...(adv.trend.status === 'ok' ? { trend: adv.trend.data } : {}),
      ...(adv.platforms.status === 'ok'
        ? { observed: adv.platforms.data.flatMap((s) => (s.state === 'measured' ? [{ platform: s.platform, breakdowns: s.current.breakdowns }] : [])) }
        : {}),
      ...(adv.patterns.status === 'ok' ? { patterns: adv.patterns.data } : {}),
    }
  }

  return {
    periodMonth,
    tier: portfolio.tier,
    stub: false,
    outcomesThrough: now,
    generatedAt: now,
    payload: { ...base, summary, ...full, ...pro },
  }
}
