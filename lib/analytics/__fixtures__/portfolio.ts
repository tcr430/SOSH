import type {
  BusinessMemberRow,
  PostMetricsRow,
  PostOutcomeRow,
  PostRow,
  PostRole,
  SocialAccountRow,
} from '@/lib/db/types'

// Session 37 / ADR 0031 §12 — the ONE deterministic seed for Tier 1 (live Postgres) and Tier 2 (vitest).
//
// RULES THE FIXTURE HOLDS ITSELF TO
//   * Every row states its status explicitly ('published', 'active', 'invited', 'revoked', is_active true).
//     A column default can never make a test vacuously green (cerebrum, Session 34 K1).
//   * Two businesses, A and B, share ONE user. A is Europe/Lisbon, B is America/Sao_Paulo: the two timezone
//     boundary cases of ADR 0031 §12.2 live in the rows, one in each business.
//   * B holds at least one ACTIVE row of every kind A holds (the positive control: a test that reads A and
//     finds nothing of B's is only meaningful if B has something to leak).
//   * `EXPECTED` is HAND-COMPUTED and written as LITERALS. It is never derived from the rows, so a bug in the
//     aggregation cannot also be a bug in its own oracle.
//   * LinkedIn rows carry COUNT-basis outcomes ON PURPOSE. Production reads no LinkedIn metrics
//     (metricsReadAvailableFor('linkedin') is false), so these rows prove the surface is unavailable BY
//     CAPABILITY, not by absence of data, and that a count is never pooled with a rate.
//   * The retrospective rows (campaign_retrospectives) are not seeded yet: they land with the report assembler
//     (O2.7), which is the first consumer.

export const FIXTURE_NOW = '2026-04-12T08:00:00Z'
/** The instant the March report is generated against: 06:00 UTC on day 10 of April (ADR 0031 §5.2). */
export const MARCH_REPORT_OUTCOMES_THROUGH = '2026-04-10T06:00:00Z'

type Kind = 'user' | 'business' | 'account' | 'campaign' | 'post' | 'original' | 'member'
const KIND_PREFIX: Record<Kind, string> = {
  user: '1',
  business: '2',
  account: '3',
  campaign: '4',
  post: '5',
  original: '6',
  member: '7',
}
// RFC 4122 v4-shaped (cerebrum 2026-06-27: Zod rejects anything else).
const uid = (kind: Kind, n: number): string =>
  `${KIND_PREFIX[kind]}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`

export const USER_ID = uid('user', 1)
export const OTHER_ADMIN_USER_ID = uid('user', 2)
export const VIEWER_USER_ID = uid('user', 3)

export const BUSINESS_A_ID = uid('business', 1)
export const BUSINESS_B_ID = uid('business', 2)

export const FIXTURE_BUSINESSES = [
  { id: BUSINESS_A_ID, name: 'Fixture A (Lisbon)', timezone: 'Europe/Lisbon', language: 'en', plan: 'pro', owner_id: USER_ID },
  { id: BUSINESS_B_ID, name: 'Fixture B (Sao Paulo)', timezone: 'America/Sao_Paulo', language: 'pt', plan: 'plus', owner_id: USER_ID },
] as const

// ─── Accounts ─────────────────────────────────────────────────────────────────
export const A_X_ACCOUNT_ID = uid('account', 1)
export const A_LI_ACCOUNT_ID = uid('account', 2)
export const B_X_ACCOUNT_ID = uid('account', 3)
export const B_LI_ACCOUNT_ID = uid('account', 4)

type AccountSeed = Pick<
  SocialAccountRow,
  'id' | 'business_id' | 'platform' | 'platform_user_id' | 'platform_username' | 'platform_display_name' | 'is_active'
>
export const FIXTURE_ACCOUNTS: readonly AccountSeed[] = [
  { id: A_X_ACCOUNT_ID, business_id: BUSINESS_A_ID, platform: 'twitter', platform_user_id: 'a-x', platform_username: 'fixture_a_x', platform_display_name: 'Fixture A on X', is_active: true },
  { id: A_LI_ACCOUNT_ID, business_id: BUSINESS_A_ID, platform: 'linkedin', platform_user_id: 'a-li', platform_username: 'fixture-a-li', platform_display_name: null, is_active: true },
  { id: B_X_ACCOUNT_ID, business_id: BUSINESS_B_ID, platform: 'twitter', platform_user_id: 'b-x', platform_username: 'fixture_b_x', platform_display_name: null, is_active: true },
  { id: B_LI_ACCOUNT_ID, business_id: BUSINESS_B_ID, platform: 'linkedin', platform_user_id: 'b-li', platform_username: 'fixture-b-li', platform_display_name: null, is_active: true },
]

// ─── Campaigns ────────────────────────────────────────────────────────────────
export const A_CAMPAIGN_ACTIVE_ID = uid('campaign', 1)
export const A_CAMPAIGN_COMPLETED_ID = uid('campaign', 2)
export const B_CAMPAIGN_ACTIVE_ID = uid('campaign', 3)
export const FIXTURE_CAMPAIGNS = [
  { id: A_CAMPAIGN_ACTIVE_ID, business_id: BUSINESS_A_ID, name: 'A active', status: 'active' },
  { id: A_CAMPAIGN_COMPLETED_ID, business_id: BUSINESS_A_ID, name: 'A completed', status: 'completed' },
  { id: B_CAMPAIGN_ACTIVE_ID, business_id: BUSINESS_B_ID, name: 'B active', status: 'active' },
] as const

// ─── Members (recipients: ADR 0031 §5.4) ──────────────────────────────────────
type MemberSeed = Pick<BusinessMemberRow, 'id' | 'business_id' | 'user_id' | 'email' | 'role' | 'is_admin' | 'status'>
export const FIXTURE_MEMBERS: readonly MemberSeed[] = [
  { id: uid('member', 1), business_id: BUSINESS_A_ID, user_id: USER_ID, email: 'owner@fixture-a.test', role: 'approver', is_admin: true, status: 'active' },
  { id: uid('member', 2), business_id: BUSINESS_A_ID, user_id: OTHER_ADMIN_USER_ID, email: 'admin2@fixture-a.test', role: 'editor', is_admin: true, status: 'active' },
  { id: uid('member', 3), business_id: BUSINESS_A_ID, user_id: VIEWER_USER_ID, email: 'viewer@fixture-a.test', role: 'viewer', is_admin: false, status: 'active' },
  { id: uid('member', 4), business_id: BUSINESS_A_ID, user_id: null, email: 'invited@fixture-a.test', role: 'editor', is_admin: true, status: 'invited' },
  { id: uid('member', 5), business_id: BUSINESS_A_ID, user_id: null, email: 'revoked@fixture-a.test', role: 'editor', is_admin: true, status: 'revoked' },
  { id: uid('member', 6), business_id: BUSINESS_B_ID, user_id: USER_ID, email: 'owner@fixture-b.test', role: 'approver', is_admin: true, status: 'active' },
]

// ─── Post specs → rows ────────────────────────────────────────────────────────
type Metrics = { likes: number | null; comments: number | null; shares: number | null; impressions: number | null }

interface PostSpec {
  key: string
  business: typeof BUSINESS_A_ID | typeof BUSINESS_B_ID
  campaign: string
  platform: 'twitter' | 'linkedin'
  /** UTC instant of publication. */
  at: string
  account: string | null
  status: 'published' | 'draft' | 'failed'
  deleted?: boolean
  /** undefined = NO post_metrics row at all. */
  metrics?: Metrics
  /** Present only for a post the extractor measured (an outcome row exists). */
  outcome?: {
    value: number
    basis: 'rate' | 'count'
    baseline: number | null
    baselineN: number | null
    baselineSource: 'own' | 'import_seed' | null
    logLift: number | null
    beat: boolean | null
    lengthBand: 'short' | 'medium' | 'long'
    cta: boolean
    measuredAt: string
  }
  /** Present only for an AI-written post: its snapshot and its dimensions. */
  ai?: {
    role: PostRole
    format: 'single' | 'thread' | 'carousel'
    origin: 'manual' | 'objective_generated' | 'signal_generated' | 'studio_promoted'
    hook: 'question' | 'statistic' | 'contrarian' | 'story' | 'announcement' | 'how_to' | null
    hookSurvived: boolean
  }
}

const m = (likes: number | null, comments: number | null, shares: number | null, impressions: number | null): Metrics => ({
  likes,
  comments,
  shares,
  impressions,
})

// logLift = ln(value / baseline) clipped to [-3, 3], rounded to 6 dp (only carried so a test can prove it is never rendered).
const P: PostSpec[] = [
  // ── A · March 2026 · X (Europe/Lisbon local month = March). Seven MEASURED posts, 1000 impressions each. ──
  // rate = (likes + comments + shares) / impressions.
  { key: 'a_x01', business: BUSINESS_A_ID, campaign: A_CAMPAIGN_ACTIVE_ID, platform: 'twitter', at: '2026-03-03T09:00:00Z', account: A_X_ACCOUNT_ID, status: 'published',
    metrics: m(0, 0, 0, 1000),
    outcome: { value: 0, basis: 'rate', baseline: 0.03, baselineN: 9, baselineSource: 'own', logLift: -3, beat: false, lengthBand: 'short', cta: false, measuredAt: '2026-03-11T04:00:00Z' } },
  { key: 'a_x02', business: BUSINESS_A_ID, campaign: A_CAMPAIGN_ACTIVE_ID, platform: 'twitter', at: '2026-03-05T09:00:00Z', account: A_X_ACCOUNT_ID, status: 'published',
    metrics: m(12, 4, 2, 1000),
    outcome: { value: 0.018, basis: 'rate', baseline: 0.03, baselineN: 9, baselineSource: 'own', logLift: -0.510826, beat: false, lengthBand: 'short', cta: false, measuredAt: '2026-03-13T04:00:00Z' },
    ai: { role: 'founder_perspective', format: 'single', origin: 'manual', hook: null, hookSurvived: false } },
  { key: 'a_x03', business: BUSINESS_A_ID, campaign: A_CAMPAIGN_ACTIVE_ID, platform: 'twitter', at: '2026-03-09T09:00:00Z', account: A_X_ACCOUNT_ID, status: 'published',
    metrics: m(17, 5, 3, 1000),
    outcome: { value: 0.025, basis: 'rate', baseline: 0.02, baselineN: null, baselineSource: 'import_seed', logLift: 0.223144, beat: true, lengthBand: 'medium', cta: true, measuredAt: '2026-03-17T04:00:00Z' },
    ai: { role: 'anchor_thesis', format: 'single', origin: 'objective_generated', hook: 'question', hookSurvived: true } },
  { key: 'a_x04', business: BUSINESS_A_ID, campaign: A_CAMPAIGN_ACTIVE_ID, platform: 'twitter', at: '2026-03-12T09:00:00Z', account: A_X_ACCOUNT_ID, status: 'published',
    metrics: m(20, 7, 4, 1000),
    outcome: { value: 0.031, basis: 'rate', baseline: 0.03, baselineN: 9, baselineSource: 'own', logLift: 0.03279, beat: true, lengthBand: 'medium', cta: true, measuredAt: '2026-03-20T04:00:00Z' },
    ai: { role: 'anchor_thesis', format: 'thread', origin: 'objective_generated', hook: 'statistic', hookSurvived: true } },
  { key: 'a_x05', business: BUSINESS_A_ID, campaign: A_CAMPAIGN_ACTIVE_ID, platform: 'twitter', at: '2026-03-16T09:00:00Z', account: A_X_ACCOUNT_ID, status: 'published',
    metrics: m(26, 9, 5, 1000),
    outcome: { value: 0.04, basis: 'rate', baseline: 0.03, baselineN: 9, baselineSource: 'own', logLift: 0.287682, beat: true, lengthBand: 'medium', cta: false, measuredAt: '2026-03-24T04:00:00Z' },
    ai: { role: 'customer_proof', format: 'single', origin: 'signal_generated', hook: 'question', hookSurvived: false } },
  // social_account_id NULL: the "Account not recorded or since removed" bucket (ADR 0031 §4.4).
  { key: 'a_x06', business: BUSINESS_A_ID, campaign: A_CAMPAIGN_ACTIVE_ID, platform: 'twitter', at: '2026-03-20T09:00:00Z', account: null, status: 'published',
    metrics: m(30, 11, 6, 1000),
    outcome: { value: 0.047, basis: 'rate', baseline: 0.03, baselineN: 9, baselineSource: 'own', logLift: 0.448805, beat: true, lengthBand: 'long', cta: true, measuredAt: '2026-03-28T04:00:00Z' },
    ai: { role: 'customer_proof', format: 'single', origin: 'objective_generated', hook: 'story', hookSurvived: true } },
  // beat_baseline NULL: no baseline yet (nothing earlier to compare this post against).
  { key: 'a_x07', business: BUSINESS_A_ID, campaign: A_CAMPAIGN_ACTIVE_ID, platform: 'twitter', at: '2026-03-24T09:00:00Z', account: A_X_ACCOUNT_ID, status: 'published',
    metrics: m(41, 15, 8, 1000),
    outcome: { value: 0.064, basis: 'rate', baseline: null, baselineN: null, baselineSource: null, logLift: null, beat: null, lengthBand: 'medium', cta: true, measuredAt: '2026-04-01T04:00:00Z' } },
  // ── A · March · X · three published posts the extractor did NOT measure (no outcome row, past day 9) ──
  { key: 'a_x08_null_field', business: BUSINESS_A_ID, campaign: A_CAMPAIGN_ACTIVE_ID, platform: 'twitter', at: '2026-03-26T09:00:00Z', account: A_X_ACCOUNT_ID, status: 'published',
    metrics: m(5, null, 1, 900) },
  { key: 'a_x09_zero_impressions', business: BUSINESS_A_ID, campaign: A_CAMPAIGN_ACTIVE_ID, platform: 'twitter', at: '2026-03-27T09:00:00Z', account: A_X_ACCOUNT_ID, status: 'published',
    metrics: m(0, 0, 0, 0) },
  { key: 'a_x10_no_metrics_row', business: BUSINESS_A_ID, campaign: A_CAMPAIGN_ACTIVE_ID, platform: 'twitter', at: '2026-03-28T09:00:00Z', account: A_X_ACCOUNT_ID, status: 'published' },
  // ── A · March · LinkedIn · COUNT basis rows that must never be shown or pooled ──
  { key: 'a_l01', business: BUSINESS_A_ID, campaign: A_CAMPAIGN_ACTIVE_ID, platform: 'linkedin', at: '2026-03-04T09:00:00Z', account: A_LI_ACCOUNT_ID, status: 'published',
    metrics: m(10, 3, 1, null),
    outcome: { value: 14, basis: 'count', baseline: null, baselineN: null, baselineSource: null, logLift: null, beat: null, lengthBand: 'medium', cta: false, measuredAt: '2026-03-12T04:00:00Z' } },
  { key: 'a_l02', business: BUSINESS_A_ID, campaign: A_CAMPAIGN_ACTIVE_ID, platform: 'linkedin', at: '2026-03-11T09:00:00Z', account: A_LI_ACCOUNT_ID, status: 'published',
    metrics: m(4, 1, 1, null),
    outcome: { value: 6, basis: 'count', baseline: null, baselineN: null, baselineSource: null, logLift: null, beat: null, lengthBand: 'short', cta: true, measuredAt: '2026-03-19T04:00:00Z' } },
  { key: 'a_l03', business: BUSINESS_A_ID, campaign: A_CAMPAIGN_COMPLETED_ID, platform: 'linkedin', at: '2026-03-18T09:00:00Z', account: A_LI_ACCOUNT_ID, status: 'published',
    metrics: m(15, 4, 2, null),
    outcome: { value: 21, basis: 'count', baseline: null, baselineN: null, baselineSource: null, logLift: null, beat: null, lengthBand: 'long', cta: true, measuredAt: '2026-03-26T04:00:00Z' } },
  // ── A · rows that must NOT count anywhere (explicit statuses, ADR 0031 §9.1 filters) ──
  { key: 'a_draft', business: BUSINESS_A_ID, campaign: A_CAMPAIGN_ACTIVE_ID, platform: 'twitter', at: '2026-03-14T09:00:00Z', account: A_X_ACCOUNT_ID, status: 'draft' },
  { key: 'a_failed', business: BUSINESS_A_ID, campaign: A_CAMPAIGN_ACTIVE_ID, platform: 'twitter', at: '2026-03-15T09:00:00Z', account: A_X_ACCOUNT_ID, status: 'failed' },
  { key: 'a_deleted', business: BUSINESS_A_ID, campaign: A_CAMPAIGN_ACTIVE_ID, platform: 'twitter', at: '2026-03-17T09:00:00Z', account: A_X_ACCOUNT_ID, status: 'published', deleted: true,
    metrics: m(99, 99, 99, 1000) },
  // ── A · February 2026 · X · n = 5 measured (the "month before"; both sides reach the display floor) ──
  { key: 'a_f01', business: BUSINESS_A_ID, campaign: A_CAMPAIGN_ACTIVE_ID, platform: 'twitter', at: '2026-02-03T09:00:00Z', account: A_X_ACCOUNT_ID, status: 'published', metrics: m(14, 5, 3, 1000),
    outcome: { value: 0.022, basis: 'rate', baseline: null, baselineN: null, baselineSource: null, logLift: null, beat: null, lengthBand: 'medium', cta: false, measuredAt: '2026-02-11T04:00:00Z' } },
  { key: 'a_f02', business: BUSINESS_A_ID, campaign: A_CAMPAIGN_ACTIVE_ID, platform: 'twitter', at: '2026-02-06T09:00:00Z', account: A_X_ACCOUNT_ID, status: 'published', metrics: m(18, 6, 4, 1000),
    outcome: { value: 0.028, basis: 'rate', baseline: null, baselineN: null, baselineSource: null, logLift: null, beat: null, lengthBand: 'medium', cta: true, measuredAt: '2026-02-14T04:00:00Z' } },
  { key: 'a_f03', business: BUSINESS_A_ID, campaign: A_CAMPAIGN_ACTIVE_ID, platform: 'twitter', at: '2026-02-10T09:00:00Z', account: A_X_ACCOUNT_ID, status: 'published', metrics: m(19, 7, 4, 1000),
    outcome: { value: 0.03, basis: 'rate', baseline: null, baselineN: null, baselineSource: null, logLift: null, beat: null, lengthBand: 'short', cta: false, measuredAt: '2026-02-18T04:00:00Z' } },
  { key: 'a_f04', business: BUSINESS_A_ID, campaign: A_CAMPAIGN_ACTIVE_ID, platform: 'twitter', at: '2026-02-17T09:00:00Z', account: A_X_ACCOUNT_ID, status: 'published', metrics: m(23, 8, 5, 1000),
    outcome: { value: 0.036, basis: 'rate', baseline: null, baselineN: null, baselineSource: null, logLift: null, beat: null, lengthBand: 'medium', cta: true, measuredAt: '2026-02-25T04:00:00Z' } },
  { key: 'a_f05', business: BUSINESS_A_ID, campaign: A_CAMPAIGN_ACTIVE_ID, platform: 'twitter', at: '2026-02-24T09:00:00Z', account: A_X_ACCOUNT_ID, status: 'published', metrics: m(28, 10, 6, 1000),
    outcome: { value: 0.044, basis: 'rate', baseline: null, baselineN: null, baselineSource: null, logLift: null, beat: null, lengthBand: 'long', cta: true, measuredAt: '2026-03-04T04:00:00Z' } },
  // ── A · January 2026 · X · n = 4 measured (below the display floor of 5: renders the thin state) ──
  { key: 'a_j01', business: BUSINESS_A_ID, campaign: A_CAMPAIGN_ACTIVE_ID, platform: 'twitter', at: '2026-01-07T09:00:00Z', account: A_X_ACCOUNT_ID, status: 'published', metrics: m(9, 4, 2, 1000),
    outcome: { value: 0.015, basis: 'rate', baseline: null, baselineN: null, baselineSource: null, logLift: null, beat: null, lengthBand: 'short', cta: false, measuredAt: '2026-01-15T04:00:00Z' } },
  { key: 'a_j02', business: BUSINESS_A_ID, campaign: A_CAMPAIGN_ACTIVE_ID, platform: 'twitter', at: '2026-01-14T09:00:00Z', account: A_X_ACCOUNT_ID, status: 'published', metrics: m(12, 5, 3, 1000),
    outcome: { value: 0.02, basis: 'rate', baseline: null, baselineN: null, baselineSource: null, logLift: null, beat: null, lengthBand: 'medium', cta: false, measuredAt: '2026-01-22T04:00:00Z' } },
  { key: 'a_j03', business: BUSINESS_A_ID, campaign: A_CAMPAIGN_ACTIVE_ID, platform: 'twitter', at: '2026-01-21T09:00:00Z', account: A_X_ACCOUNT_ID, status: 'published', metrics: m(16, 6, 4, 1000),
    outcome: { value: 0.026, basis: 'rate', baseline: null, baselineN: null, baselineSource: null, logLift: null, beat: null, lengthBand: 'medium', cta: true, measuredAt: '2026-01-29T04:00:00Z' } },
  { key: 'a_j04', business: BUSINESS_A_ID, campaign: A_CAMPAIGN_ACTIVE_ID, platform: 'twitter', at: '2026-01-28T09:00:00Z', account: A_X_ACCOUNT_ID, status: 'published', metrics: m(20, 8, 5, 1000),
    outcome: { value: 0.033, basis: 'rate', baseline: null, baselineN: null, baselineSource: null, logLift: null, beat: null, lengthBand: 'long', cta: true, measuredAt: '2026-02-05T04:00:00Z' } },
  // ── A · the Europe/Lisbon boundary: 2026-03-31T23:30Z is 00:30 on 1 April in Lisbon (UTC+1) → APRIL; UTC says March ──
  { key: 'a_boundary_lisbon', business: BUSINESS_A_ID, campaign: A_CAMPAIGN_ACTIVE_ID, platform: 'twitter', at: '2026-03-31T23:30:00Z', account: A_X_ACCOUNT_ID, status: 'published', metrics: m(14, 4, 2, 1000),
    outcome: { value: 0.02, basis: 'rate', baseline: null, baselineN: null, baselineSource: null, logLift: null, beat: null, lengthBand: 'medium', cta: false, measuredAt: '2026-04-08T04:00:00Z' } },
  // ── A · two IMMATURE posts (day 2 at FIXTURE_NOW): "so far" counts, no outcome row, not final yet ──
  { key: 'a_immature_1', business: BUSINESS_A_ID, campaign: A_CAMPAIGN_ACTIVE_ID, platform: 'twitter', at: '2026-04-10T09:00:00Z', account: A_X_ACCOUNT_ID, status: 'published', metrics: m(3, 1, 0, 120) },
  { key: 'a_immature_2', business: BUSINESS_A_ID, campaign: A_CAMPAIGN_ACTIVE_ID, platform: 'twitter', at: '2026-04-10T15:00:00Z', account: A_X_ACCOUNT_ID, status: 'published', metrics: m(7, 0, 1, 260) },
  // ── B · the positive control: ACTIVE rows of every kind, including the America/Sao_Paulo boundary ──
  // 2026-04-01T00:30Z is 21:30 on 31 March in Sao Paulo (UTC-3, no DST) → MARCH; UTC says April.
  { key: 'b_boundary_sao_paulo', business: BUSINESS_B_ID, campaign: B_CAMPAIGN_ACTIVE_ID, platform: 'twitter', at: '2026-04-01T00:30:00Z', account: B_X_ACCOUNT_ID, status: 'published', metrics: m(23, 7, 3, 1000),
    outcome: { value: 0.033, basis: 'rate', baseline: null, baselineN: null, baselineSource: null, logLift: null, beat: null, lengthBand: 'medium', cta: true, measuredAt: '2026-04-09T04:00:00Z' } },
  { key: 'b_x02', business: BUSINESS_B_ID, campaign: B_CAMPAIGN_ACTIVE_ID, platform: 'twitter', at: '2026-03-10T09:00:00Z', account: B_X_ACCOUNT_ID, status: 'published', metrics: m(33, 12, 5, 1000),
    outcome: { value: 0.05, basis: 'rate', baseline: 0.04, baselineN: 8, baselineSource: 'own', logLift: 0.223144, beat: true, lengthBand: 'medium', cta: true, measuredAt: '2026-03-18T04:00:00Z' },
    ai: { role: 'anchor_thesis', format: 'single', origin: 'objective_generated', hook: 'question', hookSurvived: true } },
  { key: 'b_l01', business: BUSINESS_B_ID, campaign: B_CAMPAIGN_ACTIVE_ID, platform: 'linkedin', at: '2026-03-12T09:00:00Z', account: B_LI_ACCOUNT_ID, status: 'published', metrics: m(8, 2, 1, null),
    outcome: { value: 11, basis: 'count', baseline: null, baselineN: null, baselineSource: null, logLift: null, beat: null, lengthBand: 'medium', cta: true, measuredAt: '2026-03-20T04:00:00Z' } },
]

const postId = (key: string): string => uid('post', P.findIndex((p) => p.key === key) + 1)
const originalId = (key: string): string => uid('original', P.findIndex((p) => p.key === key) + 1)

type PostSeed = Pick<
  PostRow,
  'id' | 'campaign_id' | 'business_id' | 'platform' | 'content' | 'scheduled_at' | 'published_at' | 'status' | 'deleted_at' | 'social_account_id' | 'role'
>

export const FIXTURE_POSTS: readonly PostSeed[] = P.map((p) => ({
  id: postId(p.key),
  campaign_id: p.campaign,
  business_id: p.business,
  platform: p.platform,
  content: `Fixture post ${p.key}`,
  scheduled_at: p.at,
  published_at: p.status === 'published' ? p.at : null,
  status: p.status,
  deleted_at: p.deleted ? '2026-04-02T00:00:00Z' : null,
  social_account_id: p.account,
  role: p.ai?.role ?? null,
}))

type MetricsSeed = Pick<
  PostMetricsRow,
  'post_id' | 'business_id' | 'likes' | 'comments' | 'shares' | 'impressions' | 'last_synced_at'
>
export const FIXTURE_POST_METRICS: readonly MetricsSeed[] = P.flatMap((p) =>
  p.metrics
    ? [
        {
          post_id: postId(p.key),
          business_id: p.business,
          likes: p.metrics.likes,
          comments: p.metrics.comments,
          shares: p.metrics.shares,
          impressions: p.metrics.impressions,
          last_synced_at: p.outcome?.measuredAt ?? '2026-04-11T04:00:00Z',
        },
      ]
    : [],
)

export const FIXTURE_POST_OUTCOMES: readonly PostOutcomeRow[] = P.flatMap((p) =>
  p.outcome
    ? [
        {
          post_id: postId(p.key),
          business_id: p.business,
          campaign_id: p.campaign,
          platform: p.platform,
          published_at: p.at,
          ai_original_id: p.ai ? originalId(p.key) : null,
          metric_basis: p.outcome.basis,
          value: p.outcome.value,
          baseline: p.outcome.baseline,
          baseline_n: p.outcome.baselineN,
          baseline_source: p.outcome.baselineSource,
          log_lift: p.outcome.logLift,
          beat_baseline: p.outcome.beat,
          length_band: p.outcome.lengthBand,
          cta_present: p.outcome.cta,
          hook_survived: p.ai ? p.ai.hookSurvived : null,
          measured_at: p.outcome.measuredAt,
        } satisfies PostOutcomeRow,
      ]
    : [],
)

export interface DimensionSeed {
  ai_original_id: string
  business_id: string
  post_id: string
  campaign_id: string
  platform: string
  role: PostRole
  format: 'single' | 'thread' | 'carousel'
  origin_mode: 'manual' | 'objective_generated' | 'signal_generated' | 'studio_promoted'
  hook_type: string | null
}
export const FIXTURE_POST_DIMENSIONS: readonly DimensionSeed[] = P.flatMap((p) =>
  p.ai
    ? [
        {
          ai_original_id: originalId(p.key),
          business_id: p.business,
          post_id: postId(p.key),
          campaign_id: p.campaign,
          platform: p.platform,
          role: p.ai.role,
          format: p.ai.format,
          origin_mode: p.ai.origin,
          hook_type: p.ai.hook,
        },
      ]
    : [],
)

/** The id of a fixture post by its spec key (e.g. `postIdFor('a_x07')`). Throws on an unknown key. */
export function postIdFor(key: string): string {
  if (!P.some((p) => p.key === key)) throw new Error(`portfolio fixture: unknown post key ${key}`)
  return postId(key)
}

// ═══ EXPECTED — hand-computed LITERALS. Never derive these from the rows above. ═══════════════════════════════
//
// March 2026, business A (Europe/Lisbon), X. Measured rates (sorted): 0, .018, .025, .031, .040, .047, .064
//   n = 7 (odd) → median is the 4th value = 0.031 (3.1%); range min–max = 0 – 0.064 (0.0% – 6.4%); n < 10 so min–max, no IQR.
// Exclusions: 10 X posts published, 7 measured, 3 not included: no data returned (a_x10, no post_metrics row) = 1,
//   a field was missing (a_x08, comments NULL) = 1, zero impressions (a_x09) = 1, not final yet = 0.
// Wins ("beat your usual"): beat_baseline true for a_x03, a_x04, a_x05, a_x06 = 4; false for a_x01, a_x02 = 2;
//   NULL for a_x07 (no baseline). So 4 of 6 (the wins n is 6, shown separately from the median's n of 7).
// Top three by day-7 rate (post_outcomes.value): a_x07 .064, a_x06 .047, a_x05 .040.
export const EXPECTED = {
  march: {
    period: '2026-03',
    x: {
      published: 10,
      measured: 7,
      medianRate: 0.031,
      rangeMin: 0,
      rangeMax: 0.064,
      exclusions: { noDataReturned: 1, fieldMissing: 1, zeroImpressions: 1, notFinal: 0 },
      wins: { wins: 4, of: 6 },
      topThreePostKeys: ['a_x07', 'a_x06', 'a_x05'],
      importSeedRowKeys: ['a_x03'],
    },
    activity: {
      totalPublished: 13,
      byPlatformAccount: [
        { platform: 'twitter', accountId: A_X_ACCOUNT_ID, count: 9 },
        { platform: 'twitter', accountId: null, count: 1 },
        { platform: 'linkedin', accountId: A_LI_ACCOUNT_ID, count: 3 },
      ],
      previousMonthTotal: 5,
    },
    // AI posts a_x02..a_x06 only (5 of the 7 measured). Win share per value; counts only because every n < 10.
    breakdowns: {
      coverage: { covers: 5, ofMeasured: 7 },
      role: { founder_perspective: { wins: 0, of: 1 }, anchor_thesis: { wins: 2, of: 2 }, customer_proof: { wins: 2, of: 2 } },
      // length_band and cta_present are measured from the artefact, so they cover ALL 7 measured posts (beat NULL rows drop out of "of").
      lengthBand: { short: { wins: 0, of: 2 }, medium: { wins: 3, of: 3 }, long: { wins: 1, of: 1 } },
      ctaPresent: { true: { wins: 3, of: 3 }, false: { wins: 1, of: 3 } },
      // hook_type counts only where hook_survived = true: a_x03 question, a_x04 statistic, a_x06 story (a_x05's opening did not survive).
      hookTypeSurvivedKeys: ['a_x03', 'a_x04', 'a_x06'],
    },
  },
  february: { period: '2026-02', x: { measured: 5, medianRate: 0.03, rangeMin: 0.022, rangeMax: 0.044 } },
  // n = 4 → below the floor: thin state, no number. (The median of the four would be (0.020 + 0.026) / 2 = 0.023: it must NOT render.)
  january: { period: '2026-01', x: { measured: 4, medianRate: 0.023, belowFloor: true } },
  // April for A: a_boundary_lisbon (measured) + two immature posts = 3 published, 1 measured, 2 not final yet.
  april: { period: '2026-04', x: { published: 3, measured: 1, exclusions: { notFinal: 2 } } },
  boundaries: {
    lisbon: { postKey: 'a_boundary_lisbon', at: '2026-03-31T23:30:00Z', timezone: 'Europe/Lisbon', localPeriod: '2026-04', utcPeriod: '2026-03' },
    saoPaulo: { postKey: 'b_boundary_sao_paulo', at: '2026-04-01T00:30:00Z', timezone: 'America/Sao_Paulo', localPeriod: '2026-03', utcPeriod: '2026-04' },
  },
  // Business B, March (Sao Paulo local): b_x02 (.050) and the boundary post (.033) → n = 2 measured X posts.
  businessB: { period: '2026-03', xMeasured: 2, xPublished: 2, linkedinPublished: 1 },
  // ADR 0031 §5.4: admins (the owner included) by default; every active member for 'all_members'; invited and revoked never.
  recipients: {
    admins: ['owner@fixture-a.test', 'admin2@fixture-a.test'],
    allMembers: ['owner@fixture-a.test', 'admin2@fixture-a.test', 'viewer@fixture-a.test'],
  },
} as const
