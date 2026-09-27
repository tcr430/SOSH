import { describe, it, expect, vi, beforeEach } from 'vitest'

// Session 35-D · D1 · MINOR-8 — before this test, step-4/page.tsx was the
// ONLY member-RLS reader of backfill candidates (listEvidenceCandidatesForRun,
// listAudienceCandidatesForRun) with no test at all: AUTHORED-NOT-EXECUTED at
// Tier 2 for the M2.2 member-write closure. This pins that the page reads
// through the caller's own anon/RLS client — never createServiceRoleClient —
// and renders what those functions return. The DB half (member SELECT) is
// already Tier 1 via interview-member-write-closed.test.ts.

// A distinct object identity stands in for "the caller's own RLS client".
// If the page ever swaps to a service-role client, the candidate functions
// below receive a DIFFERENT object than this one and the assertion fails.
const rlsClient = { auth: { getUser: vi.fn() }, __marker: 'rls-client' }

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => rlsClient,
}))

const createServiceRoleClient = vi.fn(() => {
  throw new Error('step-4/page.tsx must never construct a service-role client')
})
vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient }))

vi.mock('@/lib/db/businesses', () => ({
  getBusinessForUser: vi.fn(),
}))
vi.mock('@/lib/db/backfill-runs', () => ({
  getBackfillRunsForBusiness: vi.fn(),
}))
vi.mock('@/lib/db/social-accounts', () => ({
  getSocialAccountById: vi.fn(),
}))
vi.mock('@/lib/db/memory-evidence', () => ({
  listEvidenceCandidatesForRun: vi.fn(),
}))
vi.mock('@/lib/db/memory-audience', () => ({
  listAudienceCandidatesForRun: vi.fn(),
}))
vi.mock('@/lib/db/memory-performance', () => ({
  listPerformanceCandidatesForRun: vi.fn(),
}))
vi.mock('./actions', () => ({ completeOnboardingAction: vi.fn() }))
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}))
vi.mock('@/components/onboarding/OnboardingProgress', () => ({
  OnboardingProgress: () => null,
}))

vi.mock('./BackfillPanel', () => ({
  BackfillPanel: () => null,
}))

import Step4Page from './page'
import { BackfillPanel } from './BackfillPanel'
import { getBusinessForUser } from '@/lib/db/businesses'
import { getBackfillRunsForBusiness } from '@/lib/db/backfill-runs'
import { getSocialAccountById } from '@/lib/db/social-accounts'
import { listEvidenceCandidatesForRun } from '@/lib/db/memory-evidence'
import { listAudienceCandidatesForRun } from '@/lib/db/memory-audience'
import { listPerformanceCandidatesForRun } from '@/lib/db/memory-performance'

const RUN = {
  id: 'run-1',
  business_id: 'b1',
  social_account_id: 'acct-1',
  platform: 'x',
  status: 'awaiting_ratification',
  partial: false,
  account_role: null,
  weighting: null,
  posts_fetched: 10,
  posts_extracted: 10,
  platform_posts_read: 10,
  spend_cents: 0,
  ceiling_cents: 0,
  passes_done: 1,
  summary: {},
  staged_voice: null,
  voice_status: null,
  voice_applied_to: null,
  voice_applied_at: null,
  error_code: null,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
  started_at: '2026-09-01T00:00:00.000Z',
  completed_at: '2026-09-01T00:00:00.000Z',
  ratified_at: null,
}

type Loose = { type?: unknown; props?: { children?: unknown } }

// Step4Page is a Server Component: calling it directly returns a React
// element tree without rendering child components. Find the BackfillPanel
// element by identity and read its props straight off the tree.
function findByType(node: unknown, type: unknown): Loose | undefined {
  const n = node as Loose
  if (!n || typeof n !== 'object') return undefined
  if (n.type === type) return n
  const children = n.props?.children
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findByType(child, type)
      if (found) return found
    }
    return undefined
  }
  return findByType(children, type)
}

describe('step-4 page — member-RLS candidate read (Session 35-D · D1 · MINOR-8)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rlsClient.auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    vi.mocked(getBusinessForUser).mockResolvedValue({ id: 'b1' } as never)
    vi.mocked(getSocialAccountById).mockResolvedValue({
      platform_display_name: 'Acme',
      platform_username: 'acme',
    } as never)
    vi.mocked(listEvidenceCandidatesForRun).mockResolvedValue([{ id: 'e1' }] as never)
    vi.mocked(listAudienceCandidatesForRun).mockResolvedValue([{ id: 'a1' }] as never)
    vi.mocked(listPerformanceCandidatesForRun).mockResolvedValue([])
  })

  it('reads candidates through the caller\'s own RLS client for an awaiting_ratification run, and renders them', async () => {
    vi.mocked(getBackfillRunsForBusiness).mockResolvedValue([RUN] as never)

    const el = await Step4Page({ params: Promise.resolve({ locale: 'en' }) })

    expect(listEvidenceCandidatesForRun).toHaveBeenCalledWith(rlsClient, 'run-1')
    expect(listAudienceCandidatesForRun).toHaveBeenCalledWith(rlsClient, 'run-1')
    expect(createServiceRoleClient).not.toHaveBeenCalled()

    const panel = findByType(el, BackfillPanel)
    expect(panel).toBeDefined()
    const props = panel!.props as unknown as {
      initialRuns: Array<{ candidates: { evidence: unknown[]; audience: unknown[] } }>
    }
    expect(props.initialRuns).toHaveLength(1)
    expect(props.initialRuns[0].candidates.evidence).toEqual([{ id: 'e1' }])
    expect(props.initialRuns[0].candidates.audience).toEqual([{ id: 'a1' }])
  })

  it('does not read candidates for a run that is not awaiting_ratification', async () => {
    vi.mocked(getBackfillRunsForBusiness).mockResolvedValue([
      { ...RUN, status: 'extracting' },
    ] as never)

    const el = await Step4Page({ params: Promise.resolve({ locale: 'en' }) })

    expect(listEvidenceCandidatesForRun).not.toHaveBeenCalled()
    expect(listAudienceCandidatesForRun).not.toHaveBeenCalled()
    const panel = findByType(el, BackfillPanel)
    const props = panel!.props as unknown as {
      initialRuns: Array<{ candidates: { evidence: unknown[]; audience: unknown[] } }>
    }
    expect(props.initialRuns[0].candidates).toEqual({ evidence: [], audience: [], performance: [] })
  })
})
