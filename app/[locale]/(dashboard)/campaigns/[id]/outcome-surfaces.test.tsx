// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/i18n/en/outcome.json'
import pt from '@/i18n/pt/outcome.json'
import es from '@/i18n/es/outcome.json'

// ADR 0026 §10.2 (Session 33 J2.12) — every state renders its copy obligation, on the real message files.
// OUTCOME-ATTRIBUTION-CONFIDENCE-FRAMED (27), the component half.

const acknowledge = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('./retrospective-actions', () => ({ acknowledgeRetrospectiveAction: acknowledge }))

import { RetrospectiveCard, type RetrospectiveCardProps } from './RetrospectiveCard'
import { ObservedOutcomesList } from './ObservedOutcomesList'
import { AcknowledgeForm } from './AcknowledgeForm'
import type { CampaignRetrospectiveRow } from '@/lib/db/types'
import type { ObservedRowView } from '@/lib/outcomes/campaign-view'

const mounted: Array<() => void> = []
afterEach(() => {
  while (mounted.length) mounted.pop()?.()
  vi.clearAllMocks()
})

function render(node: React.ReactNode, messages: unknown = en, locale = 'en') {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <NextIntlClientProvider locale={locale} messages={{ outcome: messages } as never}>
        {node}
      </NextIntlClientProvider>,
    )
  })
  mounted.push(() => {
    act(() => root.unmount())
    container.remove()
  })
  return container
}

const retro = (over: Partial<CampaignRetrospectiveRow> = {}): CampaignRetrospectiveRow => ({
  id: 'r1', campaign_id: 'c1', business_id: 'b1', hypothesis_snapshot: 'Threads beat singles for us', hypothesis_source: 'brief',
  criteria_snapshot: {}, verdict: 'supported', n: 11, wins: 9, interval_low: 0.62, interval_high: 0.95, median_log_lift: null,
  by_role: { anchor_thesis: { n: 6, wins: 5 }, customer_proof: { n: 5, wins: 4 } }, status: 'completed',
  completed_at: '2026-09-20T00:00:00Z', acknowledged_at: null, acknowledged_by: null, note: null, ...over,
})

const card = (over: Partial<RetrospectiveCardProps> = {}) =>
  React.createElement(RetrospectiveCard, {
    retro: null, dueAt: null, platformNames: 'X, LinkedIn', unavailablePlatformNames: [], campaignId: 'c1', currentUserId: 'u1', ...over,
  })

describe('RetrospectiveCard — every ADR 0026 §10.2 state', () => {
  it('not yet due: with the date', () => {
    const text = render(card({ dueAt: '2026-10-15T00:00:00Z' })).textContent
    expect(text).toContain('Results are evaluated 7 days after the last post (on ')
    expect(text).toContain('2026')
  })

  it('not yet due, before every post is published: still says when results appear', () => {
    expect(render(card()).textContent).toContain('Results appear once every post is published and 7 days have passed.')
  })

  it('inconclusive: {n} of 5', () => {
    expect(render(card({ retro: retro({ verdict: 'inconclusive', n: 4, wins: 3 }) })).textContent).toContain('Not enough measured posts to judge (4 of 5).')
  })

  it('supported: hypothesis, verdict, "{wins} of {n} posts beat your usual engagement", interval with its n, per-role table', () => {
    const c = render(card({ retro: retro() }))
    const text = c.textContent as string
    expect(text).toContain('Threads beat singles for us')
    expect(text).toContain('Supported')
    expect(text).toContain('9 of 11 posts beat your usual engagement.')
    expect(text).toContain('With 11 posts, the plausible range for the share that beat it is 0.62 to 0.95.')
    const rows = [...c.querySelectorAll('tbody tr')].map((r) => r.textContent)
    expect(rows).toEqual(['Anchor thesis5 of 6', 'Customer proof4 of 5'])
    expect(c.querySelector('table th[scope="col"]')).not.toBeNull()
  })

  it('not supported says so plainly', () => {
    expect(render(card({ retro: retro({ verdict: 'not_supported', wins: 3 }) })).textContent).toContain('Not supported')
  })

  it('implicit hypothesis carries its label instead of a hypothesis the member never wrote', () => {
    const text = render(card({ retro: retro({ hypothesis_source: 'implicit', hypothesis_snapshot: 'stored default' }) })).textContent as string
    expect(text).toContain('No hypothesis was set for this campaign, so it was judged against a default')
    expect(text).not.toContain('stored default')
  })

  it('acknowledged: who, when, note, and no form', () => {
    const c = render(card({ retro: retro({ status: 'acknowledged', acknowledged_by: 'u1', acknowledged_at: '2026-09-21T00:00:00Z', note: 'Looks right' }) }))
    expect(c.textContent).toContain('Reviewed by you on ')
    expect(c.textContent).toContain('Note: Looks right')
    expect(c.querySelector('form')).toBeNull()
    expect(render(card({ retro: retro({ status: 'acknowledged', acknowledged_by: 'someone-else', acknowledged_at: '2026-09-21T00:00:00Z' }) })).textContent).toContain('Reviewed by a team member')
  })

  it('metrics unavailable for a platform', () => {
    expect(render(card({ unavailablePlatformNames: ['LinkedIn'] })).textContent).toContain("Metrics aren't available for LinkedIn yet.")
  })

  it('ALWAYS says it measures engagement, not signups or revenue', () => {
    for (const props of [{}, { retro: retro() }, { retro: retro({ verdict: 'inconclusive' as const }) }]) {
      expect(render(card(props)).textContent).toContain('This measures engagement on X, LinkedIn, not signups or revenue.')
    }
  })

  it('a completed result offers the acknowledge form; an inconclusive one says nothing is saved', () => {
    expect(render(card({ retro: retro() })).textContent).toContain('Confirming saves this result to your brand memory')
    expect(render(card({ retro: retro({ verdict: 'inconclusive', n: 3 }) })).textContent).toContain('Nothing is saved to memory')
  })

  it('never renders a multiplier or a causal verb', () => {
    const text = render(card({ retro: retro() })).textContent as string
    expect(text).not.toMatch(/\d\s?[x×]\b|\bcauses\b|\bleads to\b|\bdrives\b|\bproven\b/i)
  })
})

const row = (over: Partial<ObservedRowView> = {}): ObservedRowView => ({
  cell: 'format:thread:twitter', dimension: 'format', value: 'thread', platform: 'twitter', direction: 'above', basis: 'rate',
  state: 'live', wins: 9, n: 11, campaigns: 3, seeded: false, pausedAt: null, ...over,
})
const list = (rows: ObservedRowView[]) => React.createElement(ObservedOutcomesList, { rows })

describe('ObservedOutcomesList — every ADR 0026 §10.2 state', () => {
  it('none yet', () => {
    expect(render(list([])).textContent).toContain('Nothing learned yet. Patterns need at least 10 measured posts across 3 campaigns.')
  })

  it('live: the sentence with n and campaigns', () => {
    expect(render(list([row()])).textContent).toContain('On X, thread posts beat your usual engagement in 9 of 11 posts (3 campaigns).')
  })

  it('live: singular campaign, the below direction, and the count basis', () => {
    expect(render(list([row({ campaigns: 1 })])).textContent).toContain('(1 campaign)')
    expect(render(list([row({ direction: 'below', wins: 8, n: 10 })])).textContent).toContain('were below your usual engagement in 8 of 10 posts')
    expect(render(list([row({ basis: 'count', platform: 'linkedin' })])).textContent).toContain('beat your usual engagement count')
  })

  it('provisional: {n} of 10 posts so far, not used in writing yet', () => {
    expect(render(list([row({ state: 'provisional', n: 6, wins: 5 })])).textContent).toContain('6 of 10 posts so far. Not used in writing yet.')
  })

  it('contradicted: paused on the date', () => {
    const text = render(list([row({ state: 'contradicted', pausedAt: '2026-09-22T00:00:00Z' })])).textContent as string
    expect(text).toContain('Recent posts no longer support this. Paused on ')
    expect(text).toContain('2026')
  })

  it('not enough variety', () => {
    expect(render(list([row({ state: 'no_variety', dimension: 'origin_mode', value: 'manual', cell: 'origin_mode:manual:twitter' })])).textContent).toContain('All your posts share this value. Nothing to compare yet.')
  })

  it('EVERY LinkedIn row carries the count-basis disclosure; an X row does not', () => {
    const li = render(list([row({ platform: 'linkedin', basis: 'count', cell: 'a' }), row({ platform: 'linkedin', state: 'provisional', cell: 'b' })]))
    expect((li.textContent as string).split('On LinkedIn this counts likes, comments and shares').length - 1).toBe(2)
    expect(render(list([row()])).textContent).not.toContain('On LinkedIn this counts')
  })

  it('EVERY seeded row says it was compared against the imported history', () => {
    const seeded = render(list([row({ seeded: true, cell: 'a' }), row({ seeded: true, cell: 'b', state: 'provisional' })]))
    expect((seeded.textContent as string).split('Compared against the history you imported.').length - 1).toBe(2)
    expect(render(list([row()])).textContent).not.toContain('Compared against the history you imported.')
  })

  it('carries n on every rate: no bare percentage, no per-post metric', () => {
    const text = render(list([row(), row({ state: 'provisional', cell: 'b' })])).textContent as string
    expect(text).not.toMatch(/%|likes:|impressions/i)
  })
})

describe('the surfaces render in pt and es too, on the same states', () => {
  it.each([['pt', pt], ['es', es]] as const)('%s', (locale, messages) => {
    const c = render(card({ retro: retro() }), messages, locale)
    expect(c.textContent).toContain('Confirmada')
    expect(c.textContent).toContain('9 de 11')
    const o = render(list([row()]), messages, locale)
    expect(o.textContent).toContain('9 de 11 publica')
    expect(o.textContent).toMatch(/3 campa/)
  })
})

describe('AcknowledgeForm', () => {
  const submit = async (form: HTMLFormElement) => {
    await act(async () => {
      form.requestSubmit()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  it('shows the action error, translated', async () => {
    acknowledge.mockResolvedValue({ status: 'error', error: 'forbidden' })
    const c = render(React.createElement(AcknowledgeForm, { campaignId: 'c1', conclusive: true }))
    await submit(c.querySelector('form') as HTMLFormElement)
    expect(c.querySelector('[role="alert"]')?.textContent).toBe('Only members who can edit this workspace can confirm results.')
  })

  it('posts only the campaign id and the note: the acting user is never a form field', () => {
    const c = render(React.createElement(AcknowledgeForm, { campaignId: 'c1', conclusive: true }))
    const names = [...c.querySelectorAll('input, textarea')].map((el) => el.getAttribute('name'))
    expect(names.sort()).toEqual(['campaignId', 'note'])
    expect(c.querySelector('textarea')?.getAttribute('maxlength')).toBe('500')
    expect(c.querySelector('label')?.getAttribute('for')).toBe(c.querySelector('textarea')?.id)
  })
})
