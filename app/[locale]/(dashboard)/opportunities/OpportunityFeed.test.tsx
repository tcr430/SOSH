// @vitest-environment happy-dom
//
// Session 28-D, D5 (MAJOR-6 closed) — OpportunityFeed.tsx was 387 lines of
// AUTHORED-NOT-EXECUTED client component: page.test.tsx mocked it to
// () => null and no dedicated suite existed. This file drives the REAL
// component through every §9.2 state (ADR 0021), named in the test titles
// so a reviewer can count all ten, plus MINOR-5 (the assessment-affordance
// render order/visibility) and MINOR-6 (status-band contrast against the
// shipped app/globals.css tokens — mirrors ApprovalsInbox.test.tsx's
// mechanism, not a hand-transcribed copy, per ADR 0015 §1(c)).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// ── Mocks (hoisted before imports) ────────────────────────────────────────

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href, ...rest }, children),
}))

const approveCardAction = vi.fn().mockResolvedValue({ success: true, outcome: 'ok', currentStatus: 'approved' })
const dismissCardAction = vi.fn().mockResolvedValue({ success: true, outcome: 'ok', currentStatus: 'dismissed' })
const saveCardAction = vi.fn().mockResolvedValue({ success: true, outcome: 'ok', currentStatus: 'saved' })

vi.mock('./actions', () => ({
  approveCardAction: (...args: unknown[]) => approveCardAction(...args),
  dismissCardAction: (...args: unknown[]) => dismissCardAction(...args),
  saveCardAction: (...args: unknown[]) => saveCardAction(...args),
}))

// ── Imports ─────────────────────────────────────────────────────────────

import { OpportunityFeed } from './OpportunityFeed'
import type { InsightCardRow } from '@/lib/db/types'

// ── Fixtures ────────────────────────────────────────────────────────────

function makeCard(overrides: Partial<InsightCardRow> = {}): InsightCardRow {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    business_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    signal_candidate_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    observation: 'Acme shipped SSO support in v2.4.',
    why_it_matters: 'SSO is the #1 blocker cited by enterprise IT buyers.',
    audience: 'Enterprise IT buyers evaluating SSO-gated tools.',
    angle_options: [],
    evidence: ['dddddddd-dddd-4ddd-8ddd-dddddddddddd'],
    suggested_objective: null,
    novelty: 0.8,
    freshness: 0.9,
    sensitivity: 10,
    confidence: 0.75,
    rubric_scores: {},
    score: 0.7,
    occurred_at: '2026-08-01T00:00:00Z',
    status: 'pending',
    dismiss_reason: null,
    expires_at: '2026-08-15T00:00:00Z',
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    ...overrides,
  }
}

type FeedProps = React.ComponentProps<typeof OpportunityFeed>

function baseProps(overrides: Partial<FeedProps> = {}): FeedProps {
  return {
    locale: 'en',
    hasConnection: true,
    cards: [],
    expiredCards: [],
    showExpired: false,
    hasTriageFailures: false,
    isTriagePaused: false,
    ...overrides,
  }
}

function renderFeed(props: FeedProps) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(React.createElement(OpportunityFeed, props))
  })
  return {
    container,
    cleanup: () => {
      act(() => { root.unmount() })
      container.remove()
    },
  }
}

function buttonWithText(container: HTMLElement, text: string) {
  return Array.from(container.querySelectorAll('button')).find(b => b.textContent === text)
}

beforeEach(() => {
  vi.clearAllMocks()
  approveCardAction.mockResolvedValue({ success: true, outcome: 'ok', currentStatus: 'approved' })
  dismissCardAction.mockResolvedValue({ success: true, outcome: 'ok', currentStatus: 'dismissed' })
  saveCardAction.mockResolvedValue({ success: true, outcome: 'ok', currentStatus: 'saved' })
})

// ── §9.2 — all ten states, named so a reviewer can count them ────────────

describe('OpportunityFeed — §9.2 state 1/10: empty feed, no connection', () => {
  it('explains Mode 3 and links to /settings/signals — not an error', () => {
    const { container, cleanup } = renderFeed(baseProps({ hasConnection: false, cards: [] }))
    expect(container.textContent).toContain('empty.noConnectionTitle')
    expect(container.textContent).toContain('empty.noConnectionBody')
    expect(container.textContent).toContain('empty.noConnectionCta')
    expect(container.querySelector('a[href="/en/settings/signals"]')).toBeTruthy()
    expect(container.textContent).not.toContain('empty.connectedNothingYetTitle')
    cleanup()
  })
})

describe('OpportunityFeed — §9.2 state 2/10: empty feed, connected, nothing yet', () => {
  it('says when the next tick runs and is DISTINGUISHABLE from the no-connection empty state', () => {
    const noConnection = renderFeed(baseProps({ hasConnection: false, cards: [] }))
    const connected = renderFeed(baseProps({ hasConnection: true, cards: [] }))

    expect(connected.container.textContent).toContain('empty.connectedNothingYetTitle')
    expect(connected.container.textContent).toContain('empty.connectedNothingYetBody')
    expect(connected.container.textContent).not.toContain('empty.noConnectionTitle')

    // The pair-catching assertion: a single shared empty state passing both
    // individual checks above would still be the exact failure this pair of
    // states exists to catch — the two renders must not be textually equal.
    expect(connected.container.textContent).not.toBe(noConnection.container.textContent)

    noConnection.cleanup()
    connected.cleanup()
  })
})

describe('OpportunityFeed — §9.2 state 3/10: cards pending', () => {
  it('renders the ranked list, each card following the §9.1 hierarchy', () => {
    const card = makeCard({ angle_options: [{ angle: 'Announce the SSO launch', rationale: 'timely, high novelty' }] })
    const { container, cleanup } = renderFeed(baseProps({ cards: [card] }))

    expect(container.textContent).toContain(card.observation)
    expect(container.textContent).toContain(card.why_it_matters)
    expect(container.textContent).toContain(card.audience)
    expect(container.textContent).toContain('card.verifiedEvidence')
    expect(container.textContent).toContain('card.angleOptions')
    expect(container.textContent).toContain('Announce the SSO launch')
    expect(buttonWithText(container, 'actions.approve')).toBeTruthy()
    cleanup()
  })
})

describe('OpportunityFeed — §9.2 state 4/10: high-sensitivity card', () => {
  it('shows an explicit warning band and requires a second confirmation before approving', async () => {
    const card = makeCard({ sensitivity: 75 })
    const { container, cleanup } = renderFeed(baseProps({ cards: [card] }))

    expect(container.textContent).toContain('sensitivity.warning')
    expect(container.textContent).toContain('sensitivity.excludedFromDigest')

    act(() => { buttonWithText(container, 'actions.approve')?.click() })
    expect(approveCardAction).not.toHaveBeenCalled()
    expect(container.textContent).toContain('actions.approveConfirm')

    await act(async () => { buttonWithText(container, 'actions.approveConfirm')?.click() })
    expect(approveCardAction).toHaveBeenCalledWith(card.id)

    cleanup()
  })

  it('a low-sensitivity card approves on the first click — no confirmation gate', async () => {
    const card = makeCard({ sensitivity: 10 })
    const { container, cleanup } = renderFeed(baseProps({ cards: [card] }))

    await act(async () => { buttonWithText(container, 'actions.approve')?.click() })
    expect(approveCardAction).toHaveBeenCalledWith(card.id)

    cleanup()
  })
})

describe('OpportunityFeed — §9.2 state 5/10: expired', () => {
  it('is not rendered in the default feed, is reachable via the explicit filter, labelled, actions disabled', () => {
    const expiredCard = makeCard({ status: 'pending', expires_at: '2000-01-01T00:00:00Z' })

    const defaultFeed = renderFeed(baseProps({ showExpired: false, cards: [], expiredCards: [expiredCard] }))
    expect(defaultFeed.container.textContent).not.toContain(expiredCard.observation)
    defaultFeed.cleanup()

    const filtered = renderFeed(baseProps({ showExpired: true, cards: [], expiredCards: [expiredCard] }))
    expect(filtered.container.textContent).toContain(expiredCard.observation)
    expect(filtered.container.textContent).toContain('status.expiredHint')
    expect(buttonWithText(filtered.container, 'actions.approve')).toBeUndefined()
    expect(buttonWithText(filtered.container, 'actions.dismiss')).toBeUndefined()
    filtered.cleanup()
  })
})

describe('OpportunityFeed — §9.2 state 6/10: saved', () => {
  it('is visually distinct, with no expiry countdown, and does not re-offer Save', () => {
    const card = makeCard({ status: 'saved', expires_at: null })
    const { container, cleanup } = renderFeed(baseProps({ cards: [card] }))

    expect(container.textContent).toContain('status.savedHint')
    expect(container.textContent).not.toContain('status.expiredHint')
    expect(buttonWithText(container, 'actions.save')).toBeUndefined()
    expect(buttonWithText(container, 'actions.approve')).toBeTruthy()
    cleanup()
  })
})

describe('OpportunityFeed — §9.2 state 7/10: approved and in flight', () => {
  it('the gate count is legible, not implied, and no approve/dismiss actions remain', () => {
    const card = makeCard({ status: 'approved' })
    const { container, cleanup } = renderFeed(baseProps({ cards: [card] }))

    expect(container.textContent).toContain('status.approved')
    expect(container.textContent).toContain('status.approvedInFlightBody')
    expect(buttonWithText(container, 'actions.approve')).toBeUndefined()
    expect(buttonWithText(container, 'actions.dismiss')).toBeUndefined()
    cleanup()
  })
})

describe('OpportunityFeed — §9.2 state 8/10: triage failed', () => {
  it('is an operator-visible state, never silently absent (L-3)', () => {
    const { container, cleanup } = renderFeed(baseProps({ hasTriageFailures: true }))
    expect(container.textContent).toContain('status.triageFailedTitle')
    expect(container.textContent).toContain('status.triageFailedBody')
    cleanup()
  })
})

describe('OpportunityFeed — §9.2 state 9/10: triage paused (cap)', () => {
  it('shows the dated daily-limit-reached message', () => {
    const { container, cleanup } = renderFeed(baseProps({ isTriagePaused: true }))
    expect(container.textContent).toContain('status.pausedTitle')
    expect(container.textContent).toContain('status.pausedBody')
    cleanup()
  })
})

describe('OpportunityFeed — §9.2 state 10/10: lost the triage race', () => {
  it('re-renders THAT card in its real current status, never a generic error', async () => {
    const card = makeCard({ status: 'pending' })
    approveCardAction.mockResolvedValueOnce({ outcome: 'already_triaged', currentStatus: 'dismissed' })
    const { container, cleanup } = renderFeed(baseProps({ cards: [card] }))

    await act(async () => { buttonWithText(container, 'actions.approve')?.click() })

    expect(container.textContent).toContain('status.dismissed')
    expect(container.textContent).not.toContain('actions.error')
    expect(container.textContent).toContain('actions.announceAlreadyTriaged')
    cleanup()
  })
})

// ── aria-live announcements as TEXT CONTENT, not attribute presence ───────

describe('OpportunityFeed — aria-live announcements are asserted as text content', () => {
  it('approval is announced in the live region', async () => {
    const card = makeCard()
    const { container, cleanup } = renderFeed(baseProps({ cards: [card] }))
    const live = container.querySelector('[aria-live="polite"]')
    expect(live).toBeTruthy()
    expect(live?.textContent).toBe('')

    await act(async () => { buttonWithText(container, 'actions.approve')?.click() })
    expect(live?.textContent).toBe('actions.announceApproved')
    cleanup()
  })

  it('dismissal is announced in the live region', async () => {
    const card = makeCard()
    const { container, cleanup } = renderFeed(baseProps({ cards: [card] }))

    act(() => { buttonWithText(container, 'actions.dismiss')?.click() }) // reveal reason picker
    await act(async () => { buttonWithText(container, 'actions.dismiss')?.click() }) // confirm

    const live = container.querySelector('[aria-live="polite"]')
    expect(live?.textContent).toBe('actions.announceDismissed')
    cleanup()
  })

  it('save is announced in the live region', async () => {
    const card = makeCard()
    const { container, cleanup } = renderFeed(baseProps({ cards: [card] }))

    await act(async () => { buttonWithText(container, 'actions.save')?.click() })

    const live = container.querySelector('[aria-live="polite"]')
    expect(live?.textContent).toBe('actions.announceSaved')
    cleanup()
  })

  it('the already_triaged outcome is announced in the live region', async () => {
    const card = makeCard()
    approveCardAction.mockResolvedValueOnce({ outcome: 'already_triaged', currentStatus: 'saved' })
    const { container, cleanup } = renderFeed(baseProps({ cards: [card] }))

    await act(async () => { buttonWithText(container, 'actions.approve')?.click() })

    const live = container.querySelector('[aria-live="polite"]')
    expect(live?.textContent).toBe('actions.announceAlreadyTriaged')
    cleanup()
  })
})

// ── MINOR-5: unverified-assessment affordance is VISIBLE TEXT; verified ───
// evidence renders content, not a count ────────────────────────────────────

describe('OpportunityFeed — MINOR-5: assessment affordance is visible text', () => {
  it('observation, whyItMatters and audience each carry the assessment marker as visible text — not only a title attribute', () => {
    const card = makeCard()
    const { container, cleanup } = renderFeed(baseProps({ cards: [card] }))

    const markerCount = Array.from(container.querySelectorAll('p')).filter(
      p => p.textContent === 'card.modelAssessment',
    ).length
    expect(markerCount).toBe(3)

    // The old failure mode: the marker existed ONLY as a `title` attribute
    // (unreliable to assistive tech, not keyboard-reachable). Assert no
    // element still carries it that way instead of as visible text.
    const titleOnlyMarkers = Array.from(container.querySelectorAll('[title="card.modelAssessment"]'))
    expect(titleOnlyMarkers).toHaveLength(0)

    cleanup()
  })

  it('the verified-evidence block renders each evidence id as content, not merely evidence.length as a bare number', () => {
    const card = makeCard({ evidence: ['evidence-one', 'evidence-two', 'evidence-three'] })
    const { container, cleanup } = renderFeed(baseProps({ cards: [card] }))

    expect(container.textContent).toContain('evidence-one')
    expect(container.textContent).toContain('evidence-two')
    expect(container.textContent).toContain('evidence-three')
    // A bare count ("3") is indistinguishable in the DOM from the card's
    // other numerals (confidence/novelty/freshness) — three list items
    // carrying the real ids is the content-bearing alternative.
    const evidenceList = Array.from(container.querySelectorAll('li')).filter(li =>
      ['evidence-one', 'evidence-two', 'evidence-three'].includes(li.textContent ?? ''),
    )
    expect(evidenceList).toHaveLength(3)

    cleanup()
  })

  it('no verified-evidence block renders when a card has no evidence', () => {
    const card = makeCard({ evidence: [] })
    const { container, cleanup } = renderFeed(baseProps({ cards: [card] }))
    expect(container.textContent).not.toContain('card.verifiedEvidence')
    cleanup()
  })
})

// ── MINOR-6: status-band contrast, read from the SHIPPED app/globals.css ──
// tokens at test time — mirrors ApprovalsInbox.test.tsx's mechanism exactly
// (Session 22-E, NEW-4): parse the real file so a token rename or value
// change fails here, rather than pinning a hand-transcribed copy.

function srgbChannelToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function relativeLuminanceFromLinearRgb(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function hexToRelativeLuminance(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16)
  const r = srgbChannelToLinear(((n >> 16) & 255) / 255)
  const g = srgbChannelToLinear(((n >> 8) & 255) / 255)
  const b = srgbChannelToLinear((n & 255) / 255)
  return relativeLuminanceFromLinearRgb(r, g, b)
}

function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

const GLOBALS_CSS = readFileSync(path.resolve(process.cwd(), 'app/globals.css'), 'utf8')

function cssBlock(selector: string): string {
  const start = GLOBALS_CSS.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`globals.css: no "${selector} {" block found`)
  const end = GLOBALS_CSS.indexOf('}', start)
  if (end === -1) throw new Error(`globals.css: "${selector}" block is unterminated`)
  return GLOBALS_CSS.slice(start, end)
}

// The opportunity-feed status tokens (--warning/--success/--info-foreground)
// are stored as literal hex, not oklch — a deliberate, disclosed choice
// (globals.css comment at their definition) to avoid a hand-computed oklch
// conversion introducing its own contrast error; they are still read out of
// the shipped file, never transcribed into this test.
function hexTokenLuminance(selector: string, token: string): number {
  const block = cssBlock(selector)
  const m = block.match(new RegExp(`--${token}:\\s*(#[0-9a-fA-F]{6})`))
  if (!m) throw new Error(`globals.css: "${selector}" has no --${token}: #hex`)
  return hexToRelativeLuminance(m[1])
}

// oklch(L C H) -> linear sRGB -> relative luminance (Björn Ottosson's Oklab
// reference formulas) — needed for --card, which the "saved" info-foreground
// text renders directly onto, and which IS stored as oklch in this file.
function oklchToRelativeLuminance(L: number, C: number, hueDeg: number): number {
  const hueRad = (hueDeg * Math.PI) / 180
  const a = C * Math.cos(hueRad)
  const b = C * Math.sin(hueRad)

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b

  const l = l_ ** 3
  const m = m_ ** 3
  const s = s_ ** 3

  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const bLin = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s

  const clamp = (v: number) => Math.min(1, Math.max(0, v))
  return relativeLuminanceFromLinearRgb(clamp(r), clamp(g), clamp(bLin))
}

function tokenLuminance(selector: string, token: string): number {
  const block = cssBlock(selector)
  const m = block.match(new RegExp(`--${token}:\\s*oklch\\(\\s*([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\s*\\)`))
  if (!m) throw new Error(`globals.css: "${selector}" has no --${token}: oklch(L C H)`)
  return oklchToRelativeLuminance(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]))
}

describe('OpportunityFeed — status-band contrast (MINOR-6, WCAG AA, both themes)', () => {
  it('warning-foreground on warning meets the 4.5:1 AA floor in the light theme', () => {
    expect(
      contrastRatio(hexTokenLuminance(':root', 'warning-foreground'), hexTokenLuminance(':root', 'warning')),
    ).toBeGreaterThanOrEqual(4.5)
  })

  it('warning-foreground on warning meets the 4.5:1 AA floor in the dark theme', () => {
    expect(
      contrastRatio(hexTokenLuminance('.dark', 'warning-foreground'), hexTokenLuminance('.dark', 'warning')),
    ).toBeGreaterThanOrEqual(4.5)
  })

  it('success-foreground on success meets the 4.5:1 AA floor in the light theme', () => {
    expect(
      contrastRatio(hexTokenLuminance(':root', 'success-foreground'), hexTokenLuminance(':root', 'success')),
    ).toBeGreaterThanOrEqual(4.5)
  })

  it('success-foreground on success meets the 4.5:1 AA floor in the dark theme', () => {
    expect(
      contrastRatio(hexTokenLuminance('.dark', 'success-foreground'), hexTokenLuminance('.dark', 'success')),
    ).toBeGreaterThanOrEqual(4.5)
  })

  it('info-foreground (the Saved hint) on --card meets the 4.5:1 AA floor in the light theme', () => {
    expect(
      contrastRatio(hexTokenLuminance(':root', 'info-foreground'), tokenLuminance(':root', 'card')),
    ).toBeGreaterThanOrEqual(4.5)
  })

  it('info-foreground (the Saved hint) on --card meets the 4.5:1 AA floor in the dark theme', () => {
    expect(
      contrastRatio(hexTokenLuminance('.dark', 'info-foreground'), tokenLuminance('.dark', 'card')),
    ).toBeGreaterThanOrEqual(4.5)
  })

  it('the component uses the warning/success/info-foreground tokens, not raw Tailwind palette classes', () => {
    const card = makeCard({ sensitivity: 75, status: 'saved', evidence: ['ev-1'] })
    const { container, cleanup } = renderFeed(baseProps({ cards: [card], isTriagePaused: true }))

    expect(container.innerHTML).not.toMatch(/\b(amber|emerald|sky)-\d/)
    expect(container.innerHTML).toMatch(/border-warning-border/)
    expect(container.innerHTML).toMatch(/bg-warning\b/)
    expect(container.innerHTML).toMatch(/text-warning-foreground/)
    expect(container.innerHTML).toMatch(/border-success-border/)
    expect(container.innerHTML).toMatch(/bg-success\b/)
    expect(container.innerHTML).toMatch(/text-success-foreground/)
    expect(container.innerHTML).toMatch(/text-info-foreground/)

    cleanup()
  })
})
