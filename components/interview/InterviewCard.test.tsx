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

const client = {} as never
const BUSINESS = { id: 'biz-1', interview_snoozed_until: null }

beforeEach(() => {
  vi.resetAllMocks()
})

async function renderCard(isRatifier = false) {
  const element = await InterviewCard({ client, business: BUSINESS, locale: 'en', isRatifier })
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
    const html = await renderCard(true)
    expect(html).toContain('ui.card.awaiting_ratification')
  })
})
