import { parseISO } from 'date-fns'
import type { Readers } from '@/lib/analytics/load'
import type { ReportLabels } from '@/lib/analytics/labels'
import type { OutcomePatternRow } from '@/lib/memory'
import {
  FIXTURE_ACCOUNTS,
  FIXTURE_BUSINESSES,
  FIXTURE_CAMPAIGNS,
  FIXTURE_POSTS,
  FIXTURE_POST_DIMENSIONS,
  FIXTURE_POST_METRICS,
  FIXTURE_POST_OUTCOMES,
  BUSINESS_A_ID,
} from '@/lib/analytics/__fixtures__/portfolio'

// Test-side fakes of the report worker's readers, driven by the O2.1 portfolio fixture: every row carries its
// business_id (the worker's contract) so the isolation wrapper can verify it. They do the filtering a database would and
// nothing else: no aggregation lives here.
const inRange = (at: string | null, start: string, end: string) => at !== null && parseISO(at) >= parseISO(start) && parseISO(at) < parseISO(end)

export const RETROS = [
  { id: 'r1', campaign_id: FIXTURE_CAMPAIGNS[1].id, business_id: BUSINESS_A_ID, verdict: 'supported' as const, n: 12, wins: 8, interval_low: 0.4, interval_high: 0.85, status: 'completed' as const, completed_at: '2026-03-27T10:00:00+00:00', acknowledged_at: null },
]

export interface FixtureReaderOptions {
  /** Per-business plan override (the fixture says A is pro and B is plus). */
  plan?: Record<string, unknown>
  /** The outcome patterns the fixture's `listPatterns` returns (default none). Every row carries its business_id, like the real reader. */
  patterns?: OutcomePatternRow[]
}

export function fixtureReaders(options: FixtureReaderOptions = {}): Readers {
  const outcomes = async (biz: string, q: { platform: string; start: string; end: string; outcomesThrough: string }) =>
    FIXTURE_POST_OUTCOMES.filter((o) => o.business_id === biz && o.platform === q.platform && inRange(o.published_at, q.start, q.end) && parseISO(o.measured_at) <= parseISO(q.outcomesThrough)).map((o) => ({
      post_id: o.post_id, business_id: o.business_id, platform: o.platform, published_at: o.published_at, ai_original_id: o.ai_original_id, metric_basis: o.metric_basis, value: o.value,
      beat_baseline: o.beat_baseline, baseline_source: o.baseline_source, length_band: o.length_band, cta_present: o.cta_present, hook_survived: o.hook_survived, measured_at: o.measured_at,
    }))
  return {
    getBusinessById: async (id) => {
      const b = FIXTURE_BUSINESSES.find((x) => x.id === id)
      if (!b) throw new Error('not found')
      return { ...b, plan: id in (options.plan ?? {}) ? (options.plan as Record<string, unknown>)[id] : b.plan, stripe_subscription_id: 'sub_fixture', language: b.language } as never
    },
    listCampaignsByIds: async (biz, ids) => FIXTURE_CAMPAIGNS.filter((c) => c.business_id === biz && ids.includes(c.id)).map((c) => ({ id: c.id, business_id: c.business_id, name: c.name, status: c.status })) as never,
    listCompletedRetrospectivesInRange: async (biz, r) => RETROS.filter((x) => x.business_id === biz && inRange(x.completed_at, r.start, r.end)).sort((a, b) => b.completed_at.localeCompare(a.completed_at)),
    listPublishedPostsInRange: async (biz, r) =>
      FIXTURE_POSTS.filter((p) => p.business_id === biz && p.status === 'published' && p.deleted_at === null && inRange(p.published_at, r.start, r.end))
        .sort((a, b) => (a.published_at === b.published_at ? b.id.localeCompare(a.id) : (b.published_at as string).localeCompare(a.published_at as string)))
        .map((p) => ({ id: p.id, business_id: p.business_id, platform: p.platform, published_at: p.published_at as string, social_account_id: p.social_account_id, campaign_id: p.campaign_id })),
    countPublishedPostsInRange: async (biz, r) => FIXTURE_POSTS.filter((p) => p.business_id === biz && p.status === 'published' && p.deleted_at === null && inRange(p.published_at, r.start, r.end)).length,
    listMonthOutcomes: outcomes,
    listTrendOutcomes: outcomes,
    listDimensionsForAnalytics: async (biz, ids) =>
      FIXTURE_POST_DIMENSIONS.filter((d) => d.business_id === biz && ids.includes(d.ai_original_id)).map((d) => ({ ai_original_id: d.ai_original_id, business_id: d.business_id, role: d.role, format: d.format, origin_mode: d.origin_mode, hook_type: d.hook_type })),
    listMetricsForPosts: async (biz, ids) => FIXTURE_POST_METRICS.filter((m) => m.business_id === biz && ids.includes(m.post_id)),
    listAccountLabels: async (biz, ids) =>
      FIXTURE_ACCOUNTS.filter((a) => a.business_id === biz && ids.includes(a.id)).map((a) => ({ id: a.id, business_id: a.business_id, platform: a.platform, platform_username: a.platform_username, platform_display_name: a.platform_display_name })),
    listPatterns: async (biz, q) => (options.patterns ?? []).filter((p) => p.business_id === biz && (q.platform === undefined || p.platform === q.platform)),
  }
}

/** The business the report tests render for, and the names and labels its ids stand for (resolved at read time, never stored: D2). */
export const FIXTURE_NAME_A = FIXTURE_BUSINESSES.find((b) => b.id === BUSINESS_A_ID)?.name as string
export const FIXTURE_LABELS_A: ReportLabels = {
  campaigns: Object.fromEntries(FIXTURE_CAMPAIGNS.filter((c) => c.business_id === BUSINESS_A_ID).map((c) => [c.id, c.name])),
  accounts: Object.fromEntries(FIXTURE_ACCOUNTS.filter((a) => a.business_id === BUSINESS_A_ID).map((a) => [a.id, a.platform_display_name ?? a.platform_username])),
}

/** One ACTIVE outcome pattern row of business A, with a REAL cell key (the English sentence is what memory stores; a report never prints it). */
export function fixturePatternRow(over: Partial<OutcomePatternRow> = {}): OutcomePatternRow {
  return {
    business_id: BUSINESS_A_ID,
    pattern_key: 'outcome:format:thread:above:twitter',
    metric_basis: 'rate',
    platform: 'twitter',
    pattern: "On X, thread posts beat this brand's usual engagement.",
    wins: 7,
    n: 10,
    campaigns: 3,
    ...over,
  }
}
