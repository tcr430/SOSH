// @vitest-environment happy-dom

// ADR 0025 §10 (Session 32-D, D4, BLOCKER-3) — proves the step-4 panel
// reaches the ratifiable state for a REAL run: no test in this file ever
// hand-sets `posts_extracted` on a fixture. Instead it drives fetchPhase and
// runExtractionUnit (the real orchestrator/extractor code, only their lib/db
// and lib/ai boundaries mocked — same mocking boundary as
// lib/backfill/__tests__/fetch-phase.test.ts and extract.test.ts) through to
// `awaiting_ratification`, then renders BackfillPanel from whatever state
// that real pipeline actually produced. BACKFILL-NO-PROVIDER-IMPORT-OUTSIDE-SOCIAL
// (ADR 0025 §12 constraint 11) forbids importing '@/lib/social/mock-provider'
// from outside lib/social/**, so this uses a plain SocialProvider-shaped fake
// (fetch-phase.test.ts's own precedent), not the MockProvider class itself.

import { describe, it, expect, vi, afterEach } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { formatISO, subDays } from 'date-fns'

vi.mock('next-intl', () => ({
  useTranslations: () => {
    const t = (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key
    t.has = (key: string) => key.startsWith('failed.reason.')
    return t
  },
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href, ...rest }, children),
}))
vi.mock('./backfill-actions', () => ({
  ratifyBackfillRunAction: vi.fn(),
  discardBackfillRunAction: vi.fn(),
  retryBackfillRunAction: vi.fn(),
  getBackfillRunsAction: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/social', async () => {
  const actual = await vi.importActual<typeof import('@/lib/social')>('@/lib/social')
  return { ...actual, getRegistry: vi.fn() }
})
vi.mock('@/lib/ai/runner', () => ({ runPromptWithCost: vi.fn() }))
vi.mock('@/lib/ai/context', () => ({ buildCustomerContext: vi.fn().mockResolvedValue({}) }))
vi.mock('@/lib/db/backfill-daily-budget', () => ({
  reserveBackfillDailySpend: vi.fn().mockResolvedValue({
    id: 'budget-1', business_id: 'biz-1', purpose: 'backfill_cents', day: '2026-09-01',
    reserved_units: 0, created_at: '', updated_at: '',
  }),
  reconcileBackfillDailySpend: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/db/brand-voices', () => ({ upsertBrandVoice: vi.fn() }))

// ── The in-memory "DB" this pipeline actually mutates ───────────────────────
// Every posts_extracted/candidate value the test later asserts on comes from
// THESE mock implementations running the real orchestrator/extractor logic
// against them — never from a hand-set fixture field.

import type {
  SocialBackfillRunRow,
  SocialBackfillPostRow,
  EvidenceMemoryRow,
} from '@/lib/db/types'

const RUN_ID = 'run-pipeline-1'
const BUSINESS_ID = 'biz-pipeline-1'
const SOCIAL_ACCOUNT_ID = 'sa-pipeline-1'

let runState: SocialBackfillRunRow
let stagedPosts: SocialBackfillPostRow[]
let evidenceRows: EvidenceMemoryRow[]

function resetPipelineState() {
  runState = {
    id: RUN_ID,
    business_id: BUSINESS_ID,
    social_account_id: SOCIAL_ACCOUNT_ID,
    platform: 'twitter',
    status: 'queued',
    partial: false,
    account_role: null,
    weighting: null,
    posts_fetched: 0,
    posts_extracted: 0,
    platform_posts_read: 0,
    spend_cents: 0,
    ceiling_cents: 50,
    passes_done: 0,
    summary: {},
    staged_voice: null,
    voice_status: null,
    voice_applied_to: null,
    voice_applied_at: null,
    error_code: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    started_at: null,
    completed_at: null,
    ratified_at: null,
  }
  stagedPosts = []
  evidenceRows = []
}
resetPipelineState()

vi.mock('@/lib/db/backfill-runs', () => ({
  getBackfillRunById: vi.fn(async () => runState),
  transitionBackfillRun: vi.fn(async (_id: string, from: readonly string[], to: string) => {
    if (!from.includes(runState.status)) return null
    runState = { ...runState, status: to as SocialBackfillRunRow['status'], updated_at: new Date().toISOString() }
    return runState
  }),
  recordBackfillFetchProgress: vi.fn(async (_id: string, staged: number, read: number) => {
    runState = { ...runState, posts_fetched: runState.posts_fetched + staged, platform_posts_read: runState.platform_posts_read + read }
    return runState
  }),
  reserveBackfillSpend: vi.fn(async () => runState),
  reconcileBackfillSpend: vi.fn(async () => runState),
  incrementBackfillPassesDone: vi.fn(async () => {
    runState = { ...runState, passes_done: runState.passes_done + 1 }
    return runState
  }),
  markBackfillRunPartial: vi.fn(async () => runState),
  stageBackfillVoice: vi.fn(async (_id: string, voice: Record<string, unknown>) => {
    runState = { ...runState, staged_voice: voice, voice_status: 'pending' }
    return runState
  }),
  recordBackfillRunSummary: vi.fn(async () => runState),
}))

vi.mock('@/lib/db/backfill-posts', () => ({
  stageBackfillPosts: vi.fn(async (runId: string, businessId: string, socialAccountId: string, posts: ReadonlyArray<{
    platformPostId: string; publishedAt: string; content: string; url: string | null; format: string; metrics: unknown
  }>) => {
    const before = stagedPosts.length
    for (const [i, p] of posts.entries()) {
      stagedPosts.push({
        id: `staged-${before + i}`,
        business_id: businessId,
        run_id: runId,
        social_account_id: socialAccountId,
        platform_post_id: p.platformPostId,
        published_at: p.publishedAt,
        content: p.content,
        url: p.url,
        format: p.format as SocialBackfillPostRow['format'],
        metrics: p.metrics as SocialBackfillPostRow['metrics'],
        lift: null,
        extraction_status: 'pending',
        claimed_at: null,
        created_at: p.publishedAt,
      })
    }
    return posts.length
  }),
  getStagedPostsForRun: vi.fn(async () => stagedPosts),
  updateBackfillPostLifts: vi.fn(async (_runId: string, lifts: ReadonlyArray<{ id: string; lift: number }>) => {
    for (const { id, lift } of lifts) {
      const post = stagedPosts.find((p) => p.id === id)
      if (post) post.lift = lift
    }
    return lifts.length
  }),
  claimBackfillPosts: vi.fn(async (_runId: string, limit: number) => {
    const pending = stagedPosts.filter((p) => p.extraction_status === 'pending').slice(0, limit)
    for (const p of pending) p.extraction_status = 'claimed'
    return pending
  }),
  resolveBackfillPosts: vi.fn(async (ids: readonly string[], status: 'pending' | 'extracted' | 'skipped' | 'failed') => {
    let n = 0
    for (const id of ids) {
      const post = stagedPosts.find((p) => p.id === id)
      if (post && post.extraction_status === 'claimed') {
        post.extraction_status = status
        n += 1
      }
    }
    // Mirrors the D3 migration's resolve_backfill_posts writer exactly:
    // extracted/skipped increment posts_extracted, pending/failed never do.
    if (n > 0 && (status === 'extracted' || status === 'skipped')) {
      runState = { ...runState, posts_extracted: runState.posts_extracted + n }
    }
    return n
  }),
  // Session 32-D, D6 (MAJOR-11) — the finalization check runEvidenceBatch
  // makes before transitioning: mirrors the real query directly off this
  // fixture's own staged-post state, never a hand-set flag.
  hasFailedBackfillPosts: vi.fn(async (_runId: string) => stagedPosts.some((p) => p.extraction_status === 'failed')),
}))

vi.mock('@/lib/memory/import', () => ({
  importEvidenceItem: vi.fn(
    async (args: { businessId: string; runId: string; sourcePostIds: string[]; kind: string; content: string; sourceUrl: string | null }) => {
      const row: EvidenceMemoryRow = {
        id: `evidence-${evidenceRows.length}`,
        business_id: args.businessId,
        source: 'import',
        confidence: 0.5,
        observation_count: 1,
        status: 'candidate',
        sensitivity: 'internal',
        public_use_permission: false,
        scope: 'brand',
        scope_ref: null,
        last_confirmed_at: '2026-09-01T00:00:00Z',
        recency_at: '2026-09-01T00:00:00Z',
        expires_at: null,
        deleted_at: null,
        created_at: '2026-09-01T00:00:00Z',
        updated_at: '2026-09-01T00:00:00Z',
        import_run_id: args.runId,
        import_source_post_ids: args.sourcePostIds,
        kind: args.kind as EvidenceMemoryRow['kind'],
        content: args.content,
        source_url: args.sourceUrl,
      }
      evidenceRows.push(row)
      return row
    },
  ),
  // No audience/performance candidates in this fixture (insights output is
  // empty) — evidence alone is enough to prove candidates render without a
  // hand-set posts_extracted.
  importAudienceItem: vi.fn(),
  importPerformanceItem: vi.fn(),
}))

// ── Imports that must come AFTER the mocks above ────────────────────────────

import { getRegistry } from '@/lib/social'
import type { SocialProvider, RecentPost } from '@/lib/social'
import { runPromptWithCost } from '@/lib/ai/runner'
import { fetchPhase } from '@/lib/backfill/orchestrator'
import { runExtractionUnit } from '@/lib/backfill/extract'
import { BackfillPanel, type BackfillRunViewModel } from './BackfillPanel'

const mockGetRegistry = vi.mocked(getRegistry)
const mockRunPromptWithCost = vi.mocked(runPromptWithCost)

afterEach(() => {
  vi.clearAllMocks()
  resetPipelineState()
})

function makeFakeProvider(posts: RecentPost[]): SocialProvider {
  return {
    platform: 'twitter',
    historicalReadAvailable: true,
    getOAuthAuthorizeUrl: vi.fn(),
    exchangeOAuthCode: vi.fn(),
    publish: vi.fn(),
    fetchPostMetrics: vi.fn(),
    fetchEngagement: vi.fn(),
    refreshAccessToken: vi.fn(),
    revokeAccessToken: vi.fn(),
    fetchRecentPosts: vi.fn().mockResolvedValue({ posts, nextCursor: null }),
  }
}

// Six posts, well within the 24-month lookback. Two of them ("post-0",
// "post-1") will be cited verbatim by the mocked evidence pass below; the
// other four are legitimately skipped (never cited) — proving posts_extracted
// counts BOTH extracted and skipped rows, never staged-but-unresolved ones.
function makeStandardPosts(): RecentPost[] {
  return Array.from({ length: 6 }, (_, i) => ({
    platformPostId: `post-${i}`,
    publishedAt: formatISO(subDays(new Date(), 10 + i)),
    content: `Real customer story number ${i}: we cut onboarding time by 40% for enterprise buyers.`,
    url: null,
    format: 'text' as const,
    metrics: { likes: i * 3, comments: i, shares: 0, saves: 0, clicks: null, reach: null, impressions: i * 20, fetchedAt: formatISO(new Date()) },
  }))
}

async function driveToAwaitingRatification() {
  mockGetRegistry.mockReturnValue({ get: () => makeFakeProvider(makeStandardPosts()), register: vi.fn() })
  await fetchPhase(RUN_ID)
  expect(runState.status).toBe('extracting')

  // Pass 1 (voice) — sequenced by prompt id so each pass gets its own output.
  mockRunPromptWithCost.mockImplementation(async (prompt: { id: string }) => {
    if (prompt.id === 'backfill-voice-synthesis') {
      return {
        output: {
          tone: ['direct'], targetAudience: 'B2B founders', keywords: [], avoidWords: [],
          uniqueValueProp: 'a platform for founders', competitors: [],
          voiceAxes: { formal_casual: 50, expert_peer: 50, serious_playful: 50, reserved_warm: 50, calm_energetic: 50, rational_emotional: 50, exclusive_inclusive: 50 },
        },
        costCents: 1,
      }
    }
    if (prompt.id === 'backfill-insights') {
      return { output: { patterns: [], audienceStatements: [] }, costCents: 1 }
    }
    if (prompt.id === 'backfill-evidence') {
      return {
        output: {
          items: [
            { kind: 'case_study', content: 'Real customer story number 0: we cut onboarding time by 40% for enterprise buyers.', platformPostId: 'post-0' },
            { kind: 'case_study', content: 'Real customer story number 1: we cut onboarding time by 40% for enterprise buyers.', platformPostId: 'post-1' },
          ],
        },
        costCents: 1,
      }
    }
    throw new Error(`unexpected prompt: ${prompt.id}`)
  })

  let result = await runExtractionUnit(RUN_ID) // pass 0: stats/weighting/format
  expect(result.status).toBe('progressed')
  let guard = 0
  while (result.status !== 'awaiting_ratification') {
    result = await runExtractionUnit(RUN_ID)
    guard += 1
    if (guard > 10) throw new Error('runExtractionUnit did not converge to awaiting_ratification')
  }
}

function renderPanel(runs: BackfillRunViewModel[]) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(React.createElement(BackfillPanel, { locale: 'en', initialRuns: runs, supportedPlatformsLabel: 'X (Twitter)' }))
  })
  return { container, cleanup: () => { act(() => { root.unmount() }); container.remove() } }
}

describe('BackfillPanel reaches the ratifiable state for a REAL run (ADR 0025 §10, Session 32-D D4, BLOCKER-3)', () => {
  it('drives fetchPhase + runExtractionUnit with no hand-set posts_extracted, and the panel shows the ratify control and role fieldset', async () => {
    await driveToAwaitingRatification()

    // The whole point of this test: posts_extracted came from the REAL
    // resolve_backfill_posts-equivalent writer path, never from a fixture.
    expect(runState.posts_extracted).toBe(6) // 2 extracted + 4 skipped, all PROCESSED
    expect(evidenceRows).toHaveLength(2)

    const vm: BackfillRunViewModel = {
      run: runState,
      accountLabel: 'Acme Founder',
      candidates: { evidence: evidenceRows, audience: [], performance: [] },
    }
    const { container, cleanup } = renderPanel([vm])
    try {
      expect(container.querySelector('[data-state="nothing-to-learn"]')).toBeNull()
      const el = container.querySelector('[data-state="awaiting-ratification"]')
      expect(el).not.toBeNull()

      const ratifyButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('actions.ratify'))
      expect(ratifyButton).toBeDefined()
      expect(container.querySelector('fieldset')).not.toBeNull()
      expect(container.textContent).toContain('role.question')
    } finally {
      cleanup()
    }
  })

  // The "empty" (zero-candidate, no-staged-voice) nothing-to-learn state is
  // covered at the component level in BackfillPanel.test.tsx — not
  // re-derived here via the full pipeline, because pass 1 (voice synthesis)
  // runs unconditionally regardless of staged-post count and always stages
  // a non-null voice output, so a full-pipeline run can never legitimately
  // reach zero-candidates-AND-null-staged_voice. That would be a real
  // question about whether voice synthesis should gate on post count — out
  // of D4's scope (BLOCKER-3 is about the panel's display logic, not the
  // extraction pipeline's pass-dispatch rules).
})
