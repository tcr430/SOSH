import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// ADR 0029 §5.5/§8.1 (Session 35 M2.10) — the dashboard card: shown for due/open/awaiting-ratification only,
// hidden otherwise (not_due, nothing_thin, every terminal confirmation).

vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}))
vi.mock('@/lib/interview/load-page-state', () => ({ loadInterviewPageState: vi.fn() }))

import { loadInterviewPageState } from '@/lib/interview/load-page-state'
import { InterviewCard } from './InterviewCard'
import type { MemberCapabilityContext } from '@/lib/members/capabilities'

const client = {} as never
const BUSINESS = { id: 'biz-1', interview_snoozed_until: null }

beforeEach(() => {
  vi.resetAllMocks()
})

// The default member is an approver, who holds BOTH interview roles (author and ratifier), so the pre-D7 cases below are unchanged.
const APPROVER: MemberCapabilityContext = { role: 'approver', isAdmin: false }

async function renderCard(member: MemberCapabilityContext = APPROVER) {
  const element = await InterviewCard({ client, business: BUSINESS, locale: 'en', member })
  return element ? renderToStaticMarkup(element as never) : null
}

describe('InterviewCard', () => {
  it('renders nothing for not_due', async () => {
    vi.mocked(loadInterviewPageState).mockResolvedValue({ kind: 'not_due', nextEligibleAt: null })
    expect(await renderCard()).toBeNull()
  })

  it('renders nothing for nothing_thin', async () => {
    vi.mocked(loadInterviewPageState).mockResolvedValue({ kind: 'nothing_thin' })
    expect(await renderCard()).toBeNull()
  })

  it.each(['ratified', 'no_records', 'skipped', 'expired', 'failed'] as const)('renders nothing for the terminal state %s', async (status) => {
    vi.mocked(loadInterviewPageState).mockResolvedValue({ kind: status, round: { id: 'r-1' } } as never)
    expect(await renderCard()).toBeNull()
  })

  it('renders the due card with a link to /en/interview', async () => {
    vi.mocked(loadInterviewPageState).mockResolvedValue({ kind: 'due', questionCount: 6 })
    const html = await renderCard()
    expect(html).toContain('ui.card.due')
    expect(html).toContain('href="/en/interview"')
  })

  it('renders the in_progress card', async () => {
    vi.mocked(loadInterviewPageState).mockResolvedValue({ kind: 'in_progress', round: { id: 'r-1' }, answers: [] } as never)
    const html = await renderCard()
    expect(html).toContain('ui.card.in_progress')
  })

  it('renders the awaiting_ratification card for a ratifier', async () => {
    vi.mocked(loadInterviewPageState).mockResolvedValue({ kind: 'awaiting_ratification', round: { id: 'r-1' }, isRatifier: true, candidates: null, answers: [] } as never)
    const html = await renderCard()
    expect(html).toContain('ui.card.awaiting_ratification')
  })
})

// ADR 0029 §5.5, Session 35-D D7 (MINOR-2): the card is role-aware. A viewer used to see "due" with a Start link the RPC refuses;
// an editor used to see a ratification card for a ratification they cannot perform.
describe('InterviewCard — per role (§5.5)', () => {
  const VIEWER: MemberCapabilityContext = { role: 'viewer', isAdmin: false }
  const EDITOR: MemberCapabilityContext = { role: 'editor', isAdmin: false }
  const ADMIN_VIEWER: MemberCapabilityContext = { role: 'viewer', isAdmin: true }
  const DUE = { kind: 'due', questionCount: 6 } as const
  const OPEN = { kind: 'in_progress', round: { id: 'r-1' }, answers: [] } as never
  const AWAITING = { kind: 'awaiting_ratification', round: { id: 'r-1' }, isRatifier: true, candidates: null, answers: [] } as never

  it('a VIEWER sees no card in any state, and the shared load is not even made', async () => {
    for (const state of [DUE, OPEN, AWAITING]) {
      vi.mocked(loadInterviewPageState).mockResolvedValue(state)
      expect(await renderCard(VIEWER)).toBeNull()
    }
    expect(loadInterviewPageState).not.toHaveBeenCalled()
  })

  it('an EDITOR sees due and open, but NOT a ratification they cannot perform', async () => {
    vi.mocked(loadInterviewPageState).mockResolvedValue(DUE)
    expect(await renderCard(EDITOR)).toContain('ui.card.due')
    vi.mocked(loadInterviewPageState).mockResolvedValue(OPEN)
    expect(await renderCard(EDITOR)).toContain('ui.card.in_progress')
    vi.mocked(loadInterviewPageState).mockResolvedValue(AWAITING)
    expect(await renderCard(EDITOR)).toBeNull()
  })

  it('an APPROVER sees due, open and awaiting ratification', async () => {
    for (const [state, key] of [[DUE, 'ui.card.due'], [OPEN, 'ui.card.in_progress'], [AWAITING, 'ui.card.awaiting_ratification']] as const) {
      vi.mocked(loadInterviewPageState).mockResolvedValue(state)
      expect(await renderCard(APPROVER)).toContain(key)
    }
  })

  it('an ADMIN who is not an approver ratifies (the ratify RPC admits is_admin) but, as a viewer, cannot author: no due card, an awaiting card', async () => {
    vi.mocked(loadInterviewPageState).mockResolvedValue(DUE)
    expect(await renderCard(ADMIN_VIEWER)).toBeNull()
    vi.mocked(loadInterviewPageState).mockResolvedValue(AWAITING)
    expect(await renderCard(ADMIN_VIEWER)).toContain('ui.card.awaiting_ratification')
  })

  it('the loader is told the member is a ratifier exactly when they can ratify (approver-or-admin, not the AUTHOR capability)', async () => {
    vi.mocked(loadInterviewPageState).mockResolvedValue(DUE)
    await renderCard(EDITOR)
    await renderCard(APPROVER)
    await renderCard(ADMIN_VIEWER)
    expect(vi.mocked(loadInterviewPageState).mock.calls.map((c) => c[2])).toEqual([false, true, true])
  })
})
