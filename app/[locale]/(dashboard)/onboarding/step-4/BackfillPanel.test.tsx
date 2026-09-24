// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

// ── Mocks (hoisted before imports) ──────────────────────────────────────────

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

const ratifyBackfillRunAction = vi.fn().mockResolvedValue({ ok: true })
const discardBackfillRunAction = vi.fn().mockResolvedValue({ ok: true })
const retryBackfillRunAction = vi.fn().mockResolvedValue({ ok: true })
const getBackfillRunsAction = vi.fn().mockResolvedValue([])

vi.mock('./backfill-actions', () => ({
  ratifyBackfillRunAction: (...args: unknown[]) => ratifyBackfillRunAction(...args),
  discardBackfillRunAction: (...args: unknown[]) => discardBackfillRunAction(...args),
  retryBackfillRunAction: (...args: unknown[]) => retryBackfillRunAction(...args),
  getBackfillRunsAction: (...args: unknown[]) => getBackfillRunsAction(...args),
}))

// ── Imports ──────────────────────────────────────────────────────────────────

import { BackfillPanel, type BackfillRunViewModel } from './BackfillPanel'
import { computeBackfillStats } from '@/lib/backfill/stats'
import type {
  SocialBackfillRunRow,
  SocialBackfillPostRow,
  EvidenceMemoryRow,
  AudienceMemoryRow,
  PerformanceMemoryRow,
} from '@/lib/db/types'

// ── Fixtures ─────────────────────────────────────────────────────────────────

const RUN_ID = '11111111-1111-4111-8111-111111111111'

function makeRun(overrides: Partial<SocialBackfillRunRow> = {}): SocialBackfillRunRow {
  return {
    id: RUN_ID,
    business_id: '22222222-2222-4222-8222-222222222222',
    social_account_id: '33333333-3333-4333-8333-333333333333',
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
    ...overrides,
  }
}

function makeCandidates(overrides: Partial<{ evidence: EvidenceMemoryRow[]; audience: AudienceMemoryRow[]; performance: PerformanceMemoryRow[] }> = {}) {
  return { evidence: [], audience: [], performance: [], ...overrides }
}

function makePost(platformPostId: string, publishedAt: string, format: SocialBackfillPostRow['format']): SocialBackfillPostRow {
  return {
    id: `row-${platformPostId}`,
    business_id: '22222222-2222-4222-8222-222222222222',
    run_id: RUN_ID,
    social_account_id: '33333333-3333-4333-8333-333333333333',
    platform_post_id: platformPostId,
    published_at: publishedAt,
    content: `content for ${platformPostId}`,
    url: null,
    format,
    metrics: null,
    lift: null,
    extraction_status: 'pending',
    claimed_at: null,
    created_at: publishedAt,
  }
}

function makePerformanceCandidate(run: SocialBackfillRunRow, id: string, pattern: string, observationCount: number): PerformanceMemoryRow {
  return {
    id, business_id: run.business_id, source: 'import', confidence: 0.6, observation_count: observationCount,
    status: 'candidate', sensitivity: 'internal', public_use_permission: false, scope: 'brand', scope_ref: null,
    last_confirmed_at: null, recency_at: '2026-09-01T00:00:00Z', expires_at: null, deleted_at: null,
    created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', import_run_id: run.id,
    import_source_post_ids: ['p1'], dimension: 'topic', pattern, platform: 'twitter', pattern_key: null,
    outcome_n: null, outcome_wins: null, outcome_distinct_campaigns: null, interval_low: null, interval_high: null, metric_basis: null, baseline_seeded: null, contradicted_at: null,
  }
}

function makeAudienceCandidate(run: SocialBackfillRunRow, id: string, statement: string): AudienceMemoryRow {
  return {
    id, business_id: run.business_id, source: 'import', confidence: 0.5, observation_count: 1,
    status: 'candidate', sensitivity: 'internal', public_use_permission: false, scope: 'brand', scope_ref: null,
    last_confirmed_at: null, recency_at: '2026-09-01T00:00:00Z', expires_at: null, deleted_at: null,
    created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', import_run_id: run.id,
    import_source_post_ids: ['p1'], segment: null, kind: 'problem', statement,
  }
}

function makeEvidenceCandidate(run: SocialBackfillRunRow, id: string, content: string): EvidenceMemoryRow {
  return {
    id, business_id: run.business_id, source: 'import', confidence: 0.5, observation_count: 1,
    status: 'candidate', sensitivity: 'internal', public_use_permission: false, scope: 'brand', scope_ref: null,
    last_confirmed_at: null, recency_at: '2026-09-01T00:00:00Z', expires_at: null, deleted_at: null,
    created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', import_run_id: run.id,
    import_source_post_ids: ['p1'], kind: 'usage_data', content, source_url: null,
  }
}

function renderPanel(runs: BackfillRunViewModel[]) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      React.createElement(BackfillPanel, {
        locale: 'en',
        initialRuns: runs,
        supportedPlatformsLabel: 'X (Twitter)',
      }),
    )
  })
  return {
    container,
    cleanup: () => {
      act(() => { root.unmount() })
      container.remove()
    },
  }
}

let cleanupFns: (() => void)[] = []
afterEach(() => {
  cleanupFns.forEach((fn) => fn())
  cleanupFns = []
  vi.clearAllMocks()
})

// ── Tests: one per Section 10.2 state ───────────────────────────────────────

describe('BackfillPanel — Section 10.2 states', () => {
  it('not started: no run at all', () => {
    const { container, cleanup } = renderPanel([])
    cleanupFns.push(cleanup)
    expect(container.textContent).toContain('not_started.body')
    expect(container.querySelector('[data-state="progress"]')).toBeNull()
  })

  it('queued/fetching/extracting: renders no spinner claim, shows counts and keep-going copy, no permission control', () => {
    const run = makeRun({ status: 'fetching', posts_fetched: 12, posts_extracted: 3 })
    const { container, cleanup } = renderPanel([{ run, accountLabel: 'acme', candidates: makeCandidates() }])
    cleanupFns.push(cleanup)
    const el = container.querySelector('[data-state="progress"]')
    expect(el).not.toBeNull()
    expect(el?.textContent).toContain('progress.keep_going')
  })

  it('unsupported: renders no spinner/progress element, states honestly', () => {
    const run = makeRun({ status: 'unsupported', platform: 'linkedin' })
    const { container, cleanup } = renderPanel([{ run, accountLabel: 'acme', candidates: makeCandidates() }])
    cleanupFns.push(cleanup)
    expect(container.querySelector('[data-state="progress"]')).toBeNull()
    expect(container.querySelector('[data-state="unsupported"]')).not.toBeNull()
    // no discard control for an unsupported run (nothing to review or undo)
    expect(container.textContent).not.toContain('actions.discard')
  })

  it('failed, resumable: shows plain-language reason and a retry control', () => {
    const run = makeRun({ status: 'failed', error_code: 'reconnect_needed' })
    const { container, cleanup } = renderPanel([{ run, accountLabel: 'acme', candidates: makeCandidates() }])
    cleanupFns.push(cleanup)
    const el = container.querySelector('[data-state="failed"]')
    expect(el?.textContent).toContain('reconnect_needed')
    expect(container.querySelector('button')?.textContent).toContain('actions.retry')
  })

  it('failed, not resumable (caller_bug): no retry control offered', () => {
    const run = makeRun({ status: 'failed', error_code: 'caller_bug' })
    const { container, cleanup } = renderPanel([{ run, accountLabel: 'acme', candidates: makeCandidates() }])
    cleanupFns.push(cleanup)
    expect(container.textContent).not.toContain('actions.retry')
  })

  it('nothing to learn: stated, not an empty candidate list', () => {
    const run = makeRun({ status: 'awaiting_ratification', posts_extracted: 0 })
    const { container, cleanup } = renderPanel([{ run, accountLabel: 'acme', candidates: makeCandidates() }])
    cleanupFns.push(cleanup)
    expect(container.querySelector('[data-state="nothing-to-learn"]')).not.toBeNull()
    expect(container.querySelector('[data-state="awaiting-ratification"]')).toBeNull()
  })

  // BLOCKER-3 (Session 32-D, D4) — zero candidates with a staged voice is
  // NOT nothing-to-learn: the old condition (posts_extracted === 0 ||
  // totalCandidates === 0) hid the voice notice in exactly this case.
  // MAJOR-1 (Session 32-D, D8) — the pre-ratify view shows a plain staged-
  // voice NOTICE now, never a "Review voice" link (voice only applies
  // after ratify, ADR §4.2/§10.3).
  it('zero candidates but a staged voice: NOT nothing-to-learn, voice notice renders (no pre-ratify review link)', () => {
    const run = makeRun({
      status: 'awaiting_ratification',
      posts_extracted: 3,
      staged_voice: { voiceAxes: { formal_casual: 50 } },
    })
    const { container, cleanup } = renderPanel([{ run, accountLabel: 'acme', candidates: makeCandidates() }])
    cleanupFns.push(cleanup)
    expect(container.querySelector('[data-state="nothing-to-learn"]')).toBeNull()
    expect(container.querySelector('[data-state="awaiting-ratification"]')).not.toBeNull()
    expect(container.textContent).toContain('voice.summary_title')
    expect(container.textContent).not.toContain('voice.review')
  })

  it('awaiting_ratification, complete: renders headline, groups with observation counts, evidence permission OFF, CTA enabled', () => {
    // BLOCKER-3 (Session 32-D, D4) — posts_extracted is deliberately LEFT at
    // its makeRun() default (0) here: this test is about candidate-group
    // rendering, not the count copy (that's the "partial" test below), and
    // the old nothing-to-learn condition required a nonzero posts_extracted
    // to even reach this branch — hand-setting it here would mask exactly
    // the defect D4 closes.
    const run = makeRun({
      status: 'awaiting_ratification',
      weighting: 'weighted',
      staged_voice: { voiceAxes: { formal_casual: 50 } },
    })
    const candidates = makeCandidates({
      performance: [
        {
          id: 'perf-1',
          business_id: run.business_id,
          source: 'import',
          confidence: 0.6,
          observation_count: 7,
          status: 'candidate',
          sensitivity: 'internal',
          public_use_permission: false,
          scope: 'brand',
          scope_ref: null,
          last_confirmed_at: null,
          recency_at: '2026-09-01T00:00:00Z',
          expires_at: null,
          deleted_at: null,
          created_at: '2026-09-01T00:00:00Z',
          updated_at: '2026-09-01T00:00:00Z',
          import_run_id: run.id,
          import_source_post_ids: ['p1'],
          dimension: 'topic',
          pattern: 'Short posts perform best',
          platform: 'twitter',
          pattern_key: null,
          outcome_n: null, outcome_wins: null, outcome_distinct_campaigns: null, interval_low: null, interval_high: null, metric_basis: null, baseline_seeded: null, contradicted_at: null,
        },
      ],
    })
    const { container, cleanup } = renderPanel([{ run, accountLabel: 'Acme Founder', candidates }])
    cleanupFns.push(cleanup)
    const el = container.querySelector('[data-state="awaiting-ratification"]')
    expect(el).not.toBeNull()
    expect(el?.getAttribute('data-partial')).toBe('false')
    // "based on 7 posts" — the observation count, never phrased as an instruction
    expect(el?.textContent).toContain('"count":7')
    expect(el?.textContent).not.toMatch(/^(Post|Write|Try) /)
    // no evidence permission control anywhere
    expect(container.querySelector('input[type="checkbox"][data-permission]')).toBeNull()
    const button = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('actions.ratify'))
    expect(button).toBeDefined()
  })

  // MAJOR-12 (Session 32-D, D9) — ADR §10.4's six-item hierarchy, in DOM
  // order, from a summary produced by the REAL computeBackfillStats (never
  // a hand-written fixture) — the exact defect being closed is a summary
  // field nothing writes.
  it('renders all six §10.4 items in DOM order, with a non-empty date range and pattern counts, from a real computeBackfillStats summary', () => {
    const posts: SocialBackfillPostRow[] = [
      makePost('p1', '2026-01-05T09:00:00Z', 'text'), // Monday 09:00
      makePost('p2', '2026-01-05T09:00:00Z', 'text'), // Monday 09:00
      makePost('p3', '2026-01-06T14:00:00Z', 'image'), // Tuesday 14:00
      makePost('p4', '2026-01-11T09:00:00Z', 'text'), // Monday 09:00
    ]
    const summary = computeBackfillStats(posts)
    expect(summary.dateRange).not.toBeNull() // sanity: the real function actually produced one

    const run = makeRun({
      status: 'awaiting_ratification',
      posts_extracted: 4,
      weighting: 'weighted',
      staged_voice: { voiceAxes: { formal_casual: 90, expert_peer: 50, serious_playful: 50, reserved_warm: 50, calm_energetic: 50, rational_emotional: 50, exclusive_inclusive: 50 } },
      summary: summary as unknown as Record<string, unknown>,
    })
    const candidates = makeCandidates({
      performance: [makePerformanceCandidate(run, 'perf-1', 'Short posts perform best', 7)],
      audience: [makeAudienceCandidate(run, 'aud-1', 'Founders ask about pricing')],
      evidence: [makeEvidenceCandidate(run, 'ev-1', 'We hit 10,000 signups')],
    })
    const { container, cleanup } = renderPanel([{ run, accountLabel: 'Acme Founder', candidates }])
    cleanupFns.push(cleanup)

    const el = container.querySelector('[data-state="awaiting-ratification"]')!
    expect(el).not.toBeNull()

    // Item 1 — headline carries a non-empty, real date range (not the old
    // summary.date_range field, which this run's summary never sets).
    expect(el.textContent).toMatch(/"dateRange":"[^"]+–[^"]+"/)

    // Item 2 — voice summary section exists with a descriptor and strongest axes.
    const voiceSection = el.querySelector('[data-section="voice-summary"]')
    expect(voiceSection).not.toBeNull()
    expect(voiceSection!.textContent).toContain('strongest_axes')

    // Item 3 — pattern carries its observation count ("based on N posts").
    expect(el.textContent).toContain('"count":7')

    // Item 6 — cadence section exists, after the candidate groups.
    const cadenceSection = el.querySelector('[data-section="cadence"]')
    expect(cadenceSection).not.toBeNull()
    expect(cadenceSection!.textContent).toContain('cadence.title')

    // DOM order: headline -> voice summary -> performed -> audience ->
    // evidence -> cadence -> role fieldset.
    const positions = [
      el.textContent!.indexOf('headline.line'),
      el.textContent!.indexOf('voice.summary_title'),
      el.textContent!.indexOf('performed.title'),
      el.textContent!.indexOf('audience.title'),
      el.textContent!.indexOf('evidence.title'),
      el.textContent!.indexOf('cadence.title'),
      el.textContent!.indexOf('role.question'),
    ]
    expect(positions.every((p) => p !== -1)).toBe(true)
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1])
    }
  })

  it('awaiting_ratification, partial: shows the real extracted count and the stop reason', () => {
    const run = makeRun({ status: 'awaiting_ratification', posts_extracted: 4, partial: true })
    const candidates = makeCandidates({
      audience: [
        {
          id: 'aud-1',
          business_id: run.business_id,
          source: 'import',
          confidence: 0.5,
          observation_count: 1,
          status: 'candidate',
          sensitivity: 'internal',
          public_use_permission: false,
          scope: 'brand',
          scope_ref: null,
          last_confirmed_at: null,
          recency_at: '2026-09-01T00:00:00Z',
          expires_at: null,
          deleted_at: null,
          created_at: '2026-09-01T00:00:00Z',
          updated_at: '2026-09-01T00:00:00Z',
          import_run_id: run.id,
          import_source_post_ids: ['p1'],
          segment: null,
          kind: 'question',
          statement: 'How do you price seats?',
        },
      ],
    })
    const { container, cleanup } = renderPanel([{ run, accountLabel: 'acme', candidates }])
    cleanupFns.push(cleanup)
    const el = container.querySelector('[data-state="awaiting-ratification"]')
    expect(el?.getAttribute('data-partial')).toBe('true')
    expect(el?.textContent).toContain('"extracted":4')
  })

  it('ratified: shows a confirmation and no further ratify/discard prompt', () => {
    const run = makeRun({ status: 'ratified', account_role: 'founder', voice_status: 'applied' })
    const { container, cleanup } = renderPanel([{ run, accountLabel: 'acme', candidates: makeCandidates() }])
    cleanupFns.push(cleanup)
    expect(container.querySelector('[data-state="ratified"]')).not.toBeNull()
    expect(container.textContent).not.toContain('actions.ratify')
    expect(container.textContent).not.toContain('actions.discard')
  })

  it('discarded: removed from the visible list entirely (no further prompt)', () => {
    const run = makeRun({ status: 'discarded' })
    const { container, cleanup } = renderPanel([{ run, accountLabel: 'acme', candidates: makeCandidates() }])
    cleanupFns.push(cleanup)
    expect(container.querySelector('[data-run-status]')).toBeNull()
    expect(container.textContent).toContain('not_started.body')
  })
})
