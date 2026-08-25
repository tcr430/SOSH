// @vitest-environment happy-dom
//
// ADR 0022 §10 (Session 29 F1b.5) — PROMOTE-STATES-RENDERED, PROMOTE-CONTRAST-AA.
// StudioEditor.tsx had NO test file before this session (a pre-existing
// AUTHORED-NOT-EXECUTED gap this file does not fully close — only the
// promote surface added here is covered). PromoteDraftDialog is stubbed
// (mirrors PostCard.test.tsx's stub of RegenerateDialog): the "promoting"
// state it owns is tested in PromoteDraftDialog.test.tsx, not here. The
// stub exposes a single button that fires whatever outcome the test placed
// in promoteOutcomeRef, so each state below is reached the same way a real
// dialog confirm would reach it — through handlePromoteOutcome, not a
// hand-set prop.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href, ...rest }, children),
}))

const promoteOutcomeRef = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('./PromoteDraftDialog', () => ({
  PromoteDraftDialog: ({ open, onOutcome }: { open: boolean; onOutcome: (r: unknown) => void }) =>
    open
      ? React.createElement('button', { onClick: () => onOutcome(promoteOutcomeRef.current) }, 'promote-dialog-confirm-stub')
      : null,
}))

vi.mock('@/app/[locale]/(dashboard)/studio/actions', () => ({
  suggestStudioSuggestions: vi.fn(),
  acceptStudioSuggestion: vi.fn(),
  createStudioDraftAction: vi.fn(),
  saveStudioDraftAction: vi.fn(),
}))

import { StudioEditor } from './StudioEditor'

const LOCALE = 'en'
const DRAFT_ID = 'draft-1'

function baseProps(overrides: Partial<React.ComponentProps<typeof StudioEditor>> = {}) {
  return {
    locale: LOCALE,
    draftId: DRAFT_ID,
    initialContent: 'A real draft with real content.',
    initialPlatform: 'linkedin' as const,
    initialPromotedCampaignId: null,
    isClaimReclaimable: false,
    ...overrides,
  }
}

function renderEditor(props: ReturnType<typeof baseProps>) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(React.createElement(StudioEditor, props))
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
  return Array.from(container.querySelectorAll('button')).find((b) => b.textContent === text)
}

beforeEach(() => {
  vi.clearAllMocks()
  promoteOutcomeRef.current = null
})

// ── ADR 0022 §10 — the seven promote states ─────────────────────────────

describe('promote state 1/7: not promotable — empty content', () => {
  it('shows the empty-draft reason and no promote button', () => {
    const { container, cleanup } = renderEditor(baseProps({ initialContent: '   ' }))
    expect(container.textContent).toContain('promote.notEligible.emptyDraft')
    expect(buttonWithText(container, 'promote.button')).toBeUndefined()
    cleanup()
  })
})

describe('promote state 1/7: not promotable — no platform', () => {
  it('shows the no-platform reason, DISTINCT from the empty-draft reason', () => {
    const { container, cleanup } = renderEditor(baseProps({ initialPlatform: null }))
    expect(container.textContent).toContain('promote.notEligible.noPlatform')
    expect(container.textContent).not.toContain('promote.notEligible.emptyDraft')
    cleanup()
  })
})

describe('promote state 1/7: not promotable — no saved draft yet', () => {
  it('content and platform are both fine but there is no draftId — shows the DISTINCT "not saved" reason, not the empty-draft one', () => {
    const { container, cleanup } = renderEditor(baseProps({ draftId: null, initialPromotedCampaignId: undefined, isClaimReclaimable: undefined }))
    expect(container.textContent).toContain('promote.notEligible.notSaved')
    expect(container.textContent).not.toContain('promote.notEligible.emptyDraft')
    cleanup()
  })
})

describe('promote state 2/7: promotable', () => {
  it('shows an enabled button with the promote label, which opens the confirm dialog', () => {
    const { container, cleanup } = renderEditor(baseProps())
    const button = buttonWithText(container, 'promote.button')
    expect(button).not.toBeUndefined()
    expect(button?.hasAttribute('disabled')).toBe(false)

    act(() => { button?.click() })
    expect(buttonWithText(container, 'promote-dialog-confirm-stub')).not.toBeUndefined()
    cleanup()
  })
})

describe('promote state 4/7: promoted', () => {
  it('renders a REAL link to the brief and the promoted heading, distinct from already-promoted', () => {
    promoteOutcomeRef.current = { outcome: 'promoted', campaignId: 'campaign-1', briefId: 'brief-1', postId: 'post-1' }
    const { container, cleanup } = renderEditor(baseProps())

    act(() => { buttonWithText(container, 'promote.button')?.click() })
    act(() => { buttonWithText(container, 'promote-dialog-confirm-stub')?.click() })

    expect(container.textContent).toContain('promote.promoted.heading')
    expect(container.textContent).not.toContain('promote.alreadyPromoted.heading')
    const link = container.querySelector('a[href="/en/campaigns/campaign-1/brief"]')
    expect(link).not.toBeNull()
    cleanup()
  })

  it('is TERMINAL — stays rendered even if the (now-irrelevant) content is edited to empty', () => {
    promoteOutcomeRef.current = { outcome: 'promoted', campaignId: 'campaign-1', briefId: 'brief-1', postId: 'post-1' }
    const { container, cleanup } = renderEditor(baseProps())
    act(() => { buttonWithText(container, 'promote.button')?.click() })
    act(() => { buttonWithText(container, 'promote-dialog-confirm-stub')?.click() })

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(textarea, '')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(container.textContent).toContain('promote.promoted.heading')
    expect(container.textContent).not.toContain('promote.notEligible')
    cleanup()
  })
})

describe('promote state 6/7: already promoted (the lost-race arm)', () => {
  it('renders THAT DRAFT\'S real current status — a real link, but text DISTINCT from a self-initiated promote', () => {
    promoteOutcomeRef.current = {
      outcome: 'already_promoted',
      draft: { promoted_campaign_id: 'campaign-2' },
    }
    const { container, cleanup } = renderEditor(baseProps())

    act(() => { buttonWithText(container, 'promote.button')?.click() })
    act(() => { buttonWithText(container, 'promote-dialog-confirm-stub')?.click() })

    expect(container.textContent).toContain('promote.alreadyPromoted.heading')
    expect(container.textContent).not.toContain('promote.promoted.heading')
    const link = container.querySelector('a[href="/en/campaigns/campaign-2/brief"]')
    expect(link).not.toBeNull()
    cleanup()
  })
})

describe('claimed by another (a live, non-stale claim held elsewhere)', () => {
  it('renders a distinct in-progress-elsewhere message, no promote button', () => {
    promoteOutcomeRef.current = { outcome: 'claimed_by_another', draft: { promoted_campaign_id: null } }
    const { container, cleanup } = renderEditor(baseProps())

    act(() => { buttonWithText(container, 'promote.button')?.click() })
    act(() => { buttonWithText(container, 'promote-dialog-confirm-stub')?.click() })

    expect(container.textContent).toContain('promote.claimedByAnother')
    expect(buttonWithText(container, 'promote.button')).toBeUndefined()
    cleanup()
  })
})

describe('promote state 7/7: reclaimable', () => {
  it('renders the reclaimable message with a retry button, DISTINCT from not-promotable', () => {
    const { container, cleanup } = renderEditor(baseProps({ isClaimReclaimable: true }))
    expect(container.textContent).toContain('promote.reclaimable')
    expect(container.textContent).not.toContain('promote.notEligible')
    expect(buttonWithText(container, 'promote.retryButton')).not.toBeUndefined()
    cleanup()
  })
})

describe('promote failed', () => {
  it('renders an alert-role error message after a claimed-but-failed attempt, WITHOUT the promote button (impeccable review fix — an immediate retry would just return claimed_by_another)', () => {
    promoteOutcomeRef.current = { outcome: 'error', error: 'generic' }
    const { container, cleanup } = renderEditor(baseProps())

    act(() => { buttonWithText(container, 'promote.button')?.click() })
    act(() => { buttonWithText(container, 'promote-dialog-confirm-stub')?.click() })

    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toBe('promote.failed')
    expect(buttonWithText(container, 'promote.button')).toBeUndefined()
    cleanup()
  })
})

// Session 29-D, D8 (MINOR-8) — PROMOTE-MISSING-DRAFT-TYPED's Tier-2 half:
// a distinct rendered case beside the ADR §10 seven (not a renumbering of
// them), reached the same real way — through handlePromoteOutcome — and
// distinguishable from the generic 'promote failed' message above by its
// own, more specific text.
describe('promote draft not found (soft-deleted or removed since page load)', () => {
  it('renders a distinct alert-role message from a draft_not_found error, WITHOUT the promote button', () => {
    promoteOutcomeRef.current = { outcome: 'error', error: 'draft_not_found' }
    const { container, cleanup } = renderEditor(baseProps())

    act(() => { buttonWithText(container, 'promote.button')?.click() })
    act(() => { buttonWithText(container, 'promote-dialog-confirm-stub')?.click() })

    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toBe('promote.notFound')
    expect(container.textContent).not.toContain('promote.failed')
    expect(buttonWithText(container, 'promote.button')).toBeUndefined()
    cleanup()
  })
})

// ── PROMOTE-CONTRAST-AA — read the SHIPPED app/globals.css tokens at test
// time, mirroring OpportunityFeed.test.tsx's mechanism exactly (not a
// hand-transcribed hex). No NEW tokens were added for this surface — it
// reuses --success/--warning, already proven compliant there — this test
// exists because THIS component's specific pairing (success-foreground on
// success, warning-foreground on warning) is its own constraint per the
// build guide, not inherited automatically from another file's proof. ──

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

function hexTokenLuminance(selector: string, token: string): number {
  const block = cssBlock(selector)
  const m = block.match(new RegExp(`--${token}:\\s*(#[0-9a-fA-F]{6})`))
  if (!m) throw new Error(`globals.css: "${selector}" has no --${token}: #hex`)
  return hexToRelativeLuminance(m[1])
}

describe('StudioEditor promote surface — status-band contrast (PROMOTE-CONTRAST-AA, WCAG AA, both themes)', () => {
  it('success-foreground on success meets the 4.5:1 AA floor in the light theme', () => {
    expect(contrastRatio(hexTokenLuminance(':root', 'success-foreground'), hexTokenLuminance(':root', 'success'))).toBeGreaterThanOrEqual(4.5)
  })

  it('success-foreground on success meets the 4.5:1 AA floor in the dark theme', () => {
    expect(contrastRatio(hexTokenLuminance('.dark', 'success-foreground'), hexTokenLuminance('.dark', 'success'))).toBeGreaterThanOrEqual(4.5)
  })

  it('warning-foreground on warning meets the 4.5:1 AA floor in the light theme', () => {
    expect(contrastRatio(hexTokenLuminance(':root', 'warning-foreground'), hexTokenLuminance(':root', 'warning'))).toBeGreaterThanOrEqual(4.5)
  })

  it('warning-foreground on warning meets the 4.5:1 AA floor in the dark theme', () => {
    expect(contrastRatio(hexTokenLuminance('.dark', 'warning-foreground'), hexTokenLuminance('.dark', 'warning'))).toBeGreaterThanOrEqual(4.5)
  })

  // impeccable review (Session 29 F1b.5) — the "view the brief" link is
  // text-info-foreground NESTED inside a bg-success container (mirroring
  // OpportunityFeed's approved-link pattern, which itself pairs
  // info-foreground against --card, NOT --success). This pairing is new to
  // THIS component and was not covered by any prior test — verify it
  // explicitly rather than assume the --card-proven ratio transfers.
  it('info-foreground (the "view the brief" link) on --success meets the 4.5:1 AA floor in the light theme', () => {
    expect(contrastRatio(hexTokenLuminance(':root', 'info-foreground'), hexTokenLuminance(':root', 'success'))).toBeGreaterThanOrEqual(4.5)
  })

  it('info-foreground (the "view the brief" link) on --success meets the 4.5:1 AA floor in the dark theme', () => {
    expect(contrastRatio(hexTokenLuminance('.dark', 'info-foreground'), hexTokenLuminance('.dark', 'success'))).toBeGreaterThanOrEqual(4.5)
  })

  it('uses the success/warning tokens, not raw Tailwind palette classes, and no such class survives in the promoted/reclaimable renders', () => {
    promoteOutcomeRef.current = { outcome: 'promoted', campaignId: 'campaign-1', briefId: 'brief-1', postId: 'post-1' }
    const promoted = renderEditor(baseProps())
    act(() => { buttonWithText(promoted.container, 'promote.button')?.click() })
    act(() => { buttonWithText(promoted.container, 'promote-dialog-confirm-stub')?.click() })
    expect(promoted.container.innerHTML).not.toMatch(/\b(amber|emerald|sky)-\d/)
    expect(promoted.container.innerHTML).toMatch(/border-success-border/)
    expect(promoted.container.innerHTML).toMatch(/bg-success\b/)
    expect(promoted.container.innerHTML).toMatch(/text-success-foreground/)
    promoted.cleanup()

    const reclaimable = renderEditor(baseProps({ isClaimReclaimable: true }))
    expect(reclaimable.container.innerHTML).not.toMatch(/\b(amber|emerald|sky)-\d/)
    expect(reclaimable.container.innerHTML).toMatch(/border-warning-border/)
    expect(reclaimable.container.innerHTML).toMatch(/bg-warning\b/)
    expect(reclaimable.container.innerHTML).toMatch(/text-warning-foreground/)
    reclaimable.cleanup()
  })
})

// ── PROMOTE-I18N-COMPLETE — every new key present in all three locales ──

describe('promote i18n keys — present in en, pt, and es (PROMOTE-I18N-COMPLETE)', () => {
  function leafKeys(obj: unknown, prefix = ''): string[] {
    if (typeof obj !== 'object' || obj === null) return [prefix]
    return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => leafKeys(v, prefix ? `${prefix}.${k}` : k))
  }

  it('en/pt/es studio.json carry an IDENTICAL key set under editor.promote', () => {
    const en = JSON.parse(readFileSync(path.resolve(process.cwd(), 'i18n/en/studio.json'), 'utf8'))
    const pt = JSON.parse(readFileSync(path.resolve(process.cwd(), 'i18n/pt/studio.json'), 'utf8'))
    const es = JSON.parse(readFileSync(path.resolve(process.cwd(), 'i18n/es/studio.json'), 'utf8'))

    const enKeys = leafKeys(en.editor.promote).sort()
    expect(enKeys.length).toBeGreaterThan(0)
    expect(leafKeys(pt.editor.promote).sort()).toEqual(enKeys)
    expect(leafKeys(es.editor.promote).sort()).toEqual(enKeys)
  })
})
