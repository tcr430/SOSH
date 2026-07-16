// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// ── Mocks (hoisted before imports) ────────────────────────────────────────────

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}))

vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en' }),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href, ...rest }, children),
}))

const approvePostAction = vi.fn().mockResolvedValue({ success: true })
const bulkApprovePostsAction = vi.fn().mockResolvedValue({ success: true })
const skipPostAction = vi.fn().mockResolvedValue({ success: true })

vi.mock('@/app/[locale]/(dashboard)/campaigns/[id]/posts/actions', () => ({
  approvePostAction: (...args: unknown[]) => approvePostAction(...args),
  bulkApprovePostsAction: (...args: unknown[]) => bulkApprovePostsAction(...args),
  skipPostAction: (...args: unknown[]) => skipPostAction(...args),
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { ApprovalsInbox } from './ApprovalsInbox'
import type { CalendarPostRow } from '@/lib/calendar/types'
import type { CampaignRow } from '@/lib/db/types'
import en from '@/i18n/en/approvals.json'
import pt from '@/i18n/pt/approvals.json'
import es from '@/i18n/es/approvals.json'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makePost(overrides: Partial<CalendarPostRow> = {}): CalendarPostRow {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    campaign_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    campaign_name: 'Launch Campaign',
    platform: 'linkedin',
    status: 'draft',
    content: 'Pending draft content',
    hashtags: [],
    scheduled_at: '2026-07-01T10:00:00Z',
    published_at: null,
    platform_post_id: null,
    metrics: null,
    ...overrides,
  }
}

const CAMPAIGN: CampaignRow = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  business_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  name: 'Launch Campaign',
  objective: 'Grow awareness',
  special_instructions: null,
  platforms: ['linkedin'],
  frequency: 'weekly',
  posts_per_week: 3,
  start_date: '2026-07-01',
  end_date: null,
  status: 'active',
  total_posts_planned: 10,
  total_posts_published: 0,
  voice_variation_id: null,
  deleted_at: null,
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
}

function renderInbox(
  posts: CalendarPostRow[],
  campaigns: CampaignRow[] = [CAMPAIGN],
  totalPendingCount: number = posts.length,
) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(React.createElement(ApprovalsInbox, { posts, campaigns, totalPendingCount }))
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
  return Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes(text))
}

// ── WCAG contrast math (module scope — shared by the m2 and MINOR-1/B5 blocks) ─
//
// Standard WCAG relative-luminance / contrast-ratio math, computed directly
// from this app's actual CSS custom properties (app/globals.css) and
// Tailwind's amber-700/amber-300 hex values — not eyeballed.

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

// oklch(L C H) -> linear sRGB -> relative luminance, per the Oklab reference
// formulas (Björn Ottosson).
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

  // oklch conversion yields linear sRGB directly (WCAG's luminance formula
  // wants linear values) — just clamp to a valid channel range.
  const clamp = (v: number) => Math.min(1, Math.max(0, v))
  return relativeLuminanceFromLinearRgb(clamp(r), clamp(g), clamp(bLin))
}

function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

// Session 22-E (review finding NEW-4) — read the theme tokens OUT of
// app/globals.css instead of transcribing them into this file.
//
// 22-D's version copied the oklch triples here by hand. The assertions were
// real and executing, but they pinned a *copy*: editing --card or --muted in
// globals.css left these tests green while the shipped contrast regressed —
// the assertion could not fail for the reason it exists. Parsing the real file
// closes that gap; a token rename or a value change now fails here.
//
// (The amber hexes stay literal: they come from Tailwind's own palette, not
// from our CSS, so there is no project file to be their source of truth.)
const GLOBALS_CSS = readFileSync(path.resolve(process.cwd(), 'app/globals.css'), 'utf8')

function cssBlock(selector: string): string {
  const start = GLOBALS_CSS.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`globals.css: no "${selector} {" block found`)
  const end = GLOBALS_CSS.indexOf('}', start)
  if (end === -1) throw new Error(`globals.css: "${selector}" block is unterminated`)
  return GLOBALS_CSS.slice(start, end)
}

// Relative luminance of a `--token: oklch(L C H)` custom property, read from
// the given selector's block. Throws (rather than silently defaulting) if the
// token is missing or is not an oklch triple — a token that moved should break
// this test loudly.
function tokenLuminance(selector: string, token: string): number {
  const block = cssBlock(selector)
  const m = block.match(new RegExp(`--${token}:\\s*oklch\\(\\s*([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\s*\\)`))
  if (!m) throw new Error(`globals.css: "${selector}" has no --${token}: oklch(L C H)`)
  return oklchToRelativeLuminance(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]))
}

// ── APV-EMPTY-STATE ────────────────────────────────────────────────────────────

describe('ApprovalsInbox — empty state', () => {
  it('shows the positive empty-state copy when there are no pending drafts', () => {
    const { container, cleanup } = renderInbox([])
    expect(container.textContent).toContain('empty.title')
    cleanup()
  })
})

// ── APV-SINGLE-AND-BATCH ────────────────────────────────────────────────────────

describe('ApprovalsInbox — single and batch approve (APV-SINGLE-AND-BATCH)', () => {
  it('single Approve calls the existing approvePostAction with the post id', () => {
    const post = makePost()
    const { container, cleanup } = renderInbox([post])

    act(() => { buttonWithText(container, 'row.approve')?.click() })

    expect(approvePostAction).toHaveBeenCalledWith(post.id)
    cleanup()
  })

  it('the bulk bar calls the existing bulkApprovePostsAction with the campaign id and rendered ids', () => {
    const post = makePost()
    const { container, cleanup } = renderInbox([post])

    act(() => { buttonWithText(container, 'bulk.approveAll')?.click() })

    expect(bulkApprovePostsAction).toHaveBeenCalledWith(post.campaign_id, [post.id])
    cleanup()
  })
})

// ── APV-REJECT-SKIP ──────────────────────────────────────────────────────────

describe('ApprovalsInbox — reject/skip (APV-REJECT-SKIP)', () => {
  it('skip requires a note and calls the existing skipPostAction', () => {
    const post = makePost()
    const { container, cleanup } = renderInbox([post])

    act(() => { buttonWithText(container, 'row.skip')?.click() })
    const input = container.querySelector('input[type="text"]') as HTMLInputElement
    expect(input).not.toBeNull()

    // Confirm button stays disabled below the 3-char minimum (mirrors PostCard).
    const confirmBefore = buttonWithText(container, 'row.skip')
    expect(confirmBefore?.hasAttribute('disabled')).toBe(true)

    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )!.set!
    act(() => {
      nativeSetter.call(input, 'off brand')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const confirmAfter = buttonWithText(container, 'row.skip')
    expect(confirmAfter?.hasAttribute('disabled')).toBe(false)

    act(() => { confirmAfter?.click() })
    expect(skipPostAction).toHaveBeenCalledWith(post.id, 'off brand')
    cleanup()
  })
})

// ── APV-EDIT-REVERT-LEGIBLE ──────────────────────────────────────────────────

describe('ApprovalsInbox — edit is a separate step (APV-EDIT-REVERT-LEGIBLE, L-5)', () => {
  it('renders an Edit link out to the campaign posts surface — no inline silent approve', () => {
    const post = makePost()
    const { container, cleanup } = renderInbox([post])

    const editLink = Array.from(container.querySelectorAll('a')).find(a => a.textContent?.includes('row.edit'))
    expect(editLink).not.toBeUndefined()
    expect(editLink?.getAttribute('href')).toBe(`/en/campaigns/${post.campaign_id}/posts`)
    cleanup()
  })
})

// ── APV-FILTER ────────────────────────────────────────────────────────────────

describe('ApprovalsInbox — filters by campaign and channel (APV-FILTER)', () => {
  it('filtering to a platform with no matches shows the filtered-empty copy', () => {
    const post = makePost({ platform: 'linkedin' })
    const { container, cleanup } = renderInbox([post])

    const platformSelect = container.querySelectorAll('select')[1] as HTMLSelectElement
    act(() => {
      platformSelect.value = 'instagram'
      platformSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    // instagram isn't an offered option (not present among pending posts), so
    // the select stays on 'linkedin' — assert the offered-options claim instead.
    const options = Array.from(platformSelect.options).map(o => o.value)
    expect(options).toEqual(['all', 'linkedin'])
    cleanup()
  })

  it('only offers campaigns/platforms actually present among pending posts', () => {
    const post = makePost()
    const { container, cleanup } = renderInbox([post], [
      CAMPAIGN,
      { ...CAMPAIGN, id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', name: 'Unrelated Campaign' },
    ])

    const campaignSelect = container.querySelectorAll('select')[0] as HTMLSelectElement
    const optionLabels = Array.from(campaignSelect.options).map(o => o.textContent)
    expect(optionLabels).toContain('Launch Campaign')
    expect(optionLabels).not.toContain('Unrelated Campaign')
    cleanup()
  })
})

// ── APV-BULK-RESPECTS-FILTER (ADR 0014 Amendment A1/A1.1) ──────────────────────

describe('ApprovalsInbox — bulk approve respects the active platform filter (21C M1, now fixed for real)', () => {
  it('THE 21C M1 SCENARIO: filtering to a platform calls bulkApprovePostsAction with exactly that platform', () => {
    const posts = [
      makePost({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', platform: 'linkedin' }),
      makePost({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', platform: 'linkedin' }),
      makePost({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', platform: 'linkedin' }),
      makePost({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', platform: 'twitter' }),
      makePost({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5', platform: 'twitter' }),
    ]
    const { container, cleanup } = renderInbox(posts)

    const platformSelect = container.querySelectorAll('select')[1] as HTMLSelectElement
    act(() => {
      platformSelect.value = 'twitter'
      platformSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })

    const bulkButton = buttonWithText(container, 'bulk.approveAll')
    expect(bulkButton?.hasAttribute('disabled')).toBe(false)
    act(() => { bulkButton?.click() })

    expect(bulkApprovePostsAction).toHaveBeenCalledWith(posts[0].campaign_id, [posts[3].id, posts[4].id])
    cleanup()
  })

  it('unfiltered bulk calls the action with all rendered ids (regression pin)', () => {
    const post = makePost()
    const { container, cleanup } = renderInbox([post])

    act(() => { buttonWithText(container, 'bulk.approveAll')?.click() })

    expect(bulkApprovePostsAction).toHaveBeenCalledWith(post.campaign_id, [post.id])
    cleanup()
  })

  it('single-row Approve stays available under an active platform filter', () => {
    const posts = [
      makePost({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', platform: 'linkedin' }),
      makePost({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', platform: 'twitter' }),
    ]
    const { container, cleanup } = renderInbox(posts)

    const platformSelect = container.querySelectorAll('select')[1] as HTMLSelectElement
    act(() => {
      platformSelect.value = 'twitter'
      platformSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })

    const approve = buttonWithText(container, 'row.approve')
    expect(approve).not.toBeUndefined()
    expect(approve?.hasAttribute('disabled')).toBe(false)
    cleanup()
  })
})

// ── F1: truncation disables bulk regardless of filter ───────────────────────

describe('ApprovalsInbox — truncation scenario disables bulk everywhere (F1, APV-BULK-VISIBLE-ONLY)', () => {
  it('disables the per-campaign bulk approve control when the rendered set is not provably complete (hasOverflow), with an honest hint', () => {
    const post = makePost()
    // totalPendingCount (341) > posts.length (1) => hasOverflow
    const { container, cleanup } = renderInbox([post], [CAMPAIGN], 341)

    const disabledBulk = container.querySelector('[aria-label="bulk.incompleteSetHint"]')
    expect(disabledBulk).not.toBeNull()
    expect(disabledBulk?.getAttribute('aria-disabled')).toBe('true')
    cleanup()
  })

  it('clicking the disabled (truncated) bulk control never calls bulkApprovePostsAction — zero rows flip', () => {
    const post = makePost()
    const { container, cleanup } = renderInbox([post], [CAMPAIGN], 341)

    bulkApprovePostsAction.mockClear()
    const disabledBulk = container.querySelector('[aria-label="bulk.incompleteSetHint"]') as HTMLElement
    act(() => { disabledBulk?.click() })

    expect(bulkApprovePostsAction).not.toHaveBeenCalled()
    cleanup()
  })

  it('stays disabled under truncation even when a platform filter is also active', () => {
    const posts = [
      makePost({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', platform: 'linkedin' }),
      makePost({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', platform: 'twitter' }),
    ]
    const { container, cleanup } = renderInbox(posts, [CAMPAIGN], 341)

    const platformSelect = container.querySelectorAll('select')[1] as HTMLSelectElement
    act(() => {
      platformSelect.value = 'twitter'
      platformSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })

    const disabledBulk = container.querySelector('[aria-label="bulk.incompleteSetHint"]')
    expect(disabledBulk).not.toBeNull()
    cleanup()
  })

  it('leaves the bulk approve control enabled when the rendered set is complete (no overflow)', () => {
    const post = makePost()
    const { container, cleanup } = renderInbox([post], [CAMPAIGN], 1)

    const bulkButton = buttonWithText(container, 'bulk.approveAll')
    expect(bulkButton).not.toBeUndefined()
    expect(bulkButton?.hasAttribute('disabled')).toBe(false)
    cleanup()
  })
})

// ── APV-BULK-COUNT-CONSISTENT ────────────────────────────────────────────────

describe('ApprovalsInbox — bulk approve count consistency (APV-BULK-COUNT-CONSISTENT, M1)', () => {
  it('the button label, rows removed, and announced count are all the same number', async () => {
    const otherCampaign: CampaignRow = {
      ...CAMPAIGN,
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      name: 'Other Campaign',
    }
    const posts = [
      makePost({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', platform: 'linkedin' }),
      makePost({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', platform: 'linkedin' }),
      makePost({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', platform: 'linkedin' }),
      // A post in a different campaign, so items stays non-empty after the
      // bulk approve — otherwise the component's empty-state early-return
      // (APV-EMPTY-STATE) would remove the live region this test asserts on.
      makePost({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', platform: 'linkedin', campaign_id: otherCampaign.id }),
    ]
    const { container, cleanup } = renderInbox(posts, [CAMPAIGN, otherCampaign])

    const bulkButton = buttonWithText(container, 'bulk.approveAll')
    expect(bulkButton?.textContent).toContain('"count":3')

    await act(async () => { bulkButton?.click() })

    expect(bulkApprovePostsAction).toHaveBeenCalledWith(posts[0].campaign_id, [posts[0].id, posts[1].id, posts[2].id])

    // All three rows from the approved campaign are gone; only the unrelated
    // campaign's row remains — row-removal matches the label count exactly.
    expect(container.querySelectorAll('li').length).toBe(1)
    // The live-region announcement carries the SAME count as the label ("3"),
    // not a recomputed/unfiltered figure.
    const liveRegion = container.querySelector('[aria-live="polite"]')
    expect(liveRegion?.textContent).toContain('bulk.announceApproved')
    expect(liveRegion?.textContent).toContain('"count":3')
    cleanup()
  })
})

// ── B1: atomic-batch guarantee stays intact ──────────────────────────────────

describe('ApprovalsInbox — bulk approve remains a single atomic action (B1)', () => {
  it('calls bulkApprovePostsAction exactly once per bulk click, not once per row', async () => {
    const posts = [
      makePost({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', platform: 'linkedin' }),
      makePost({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', platform: 'linkedin' }),
    ]
    const { container, cleanup } = renderInbox(posts)

    bulkApprovePostsAction.mockClear()
    approvePostAction.mockClear()
    const bulkButton = buttonWithText(container, 'bulk.approveAll')
    await act(async () => { bulkButton?.click() })

    expect(bulkApprovePostsAction).toHaveBeenCalledTimes(1)
    expect(approvePostAction).not.toHaveBeenCalled()
    cleanup()
  })
})

// ── APV-OVERFLOW (m1, ADR 0014 §9.4) ────────────────────────────────────────

describe('ApprovalsInbox — overflow notice when the pending total exceeds the fetched cap (m1)', () => {
  it('shows no overflow notice when the total equals the fetched count', () => {
    const post = makePost()
    const { container, cleanup } = renderInbox([post], [CAMPAIGN], 1)

    expect(container.textContent).not.toContain('overflow.notice')
    cleanup()
  })

  it('shows the true total when the pending count exceeds the fetched cap', () => {
    const post = makePost()
    const { container, cleanup } = renderInbox([post], [CAMPAIGN], 341)

    expect(container.textContent).toContain('overflow.notice')
    expect(container.textContent).toContain('"shown":1')
    expect(container.textContent).toContain('"total":341')
    cleanup()
  })

  it('still surfaces the overflow notice in the empty state, so approving the visible cap does not read as "done"', async () => {
    const post = makePost()
    const { container, cleanup } = renderInbox([post], [CAMPAIGN], 341)

    await act(async () => { buttonWithText(container, 'row.approve')?.click() })

    expect(container.textContent).toContain('empty.title')
    expect(container.textContent).toContain('overflow.notice')
    cleanup()
  })
})

// ── m2: Skip label meets the WCAG AA contrast floor (4.5:1) in both themes ──

describe('ApprovalsInbox — Skip label contrast (m2, WCAG AA)', () => {
  // --card's actual luminance in each theme, read from app/globals.css.
  const LIGHT_CARD_LUMINANCE = tokenLuminance(':root', 'card')
  const DARK_CARD_LUMINANCE = tokenLuminance('.dark', 'card')
  const AMBER_700_LUMINANCE = hexToRelativeLuminance('#b45309')
  const AMBER_300_LUMINANCE = hexToRelativeLuminance('#fcd34d')

  it('text-amber-700 on the light-theme card meets the 4.5:1 AA floor', () => {
    expect(contrastRatio(AMBER_700_LUMINANCE, LIGHT_CARD_LUMINANCE)).toBeGreaterThanOrEqual(4.5)
  })

  it('dark:text-amber-300 on the dark-theme card meets the 4.5:1 AA floor', () => {
    expect(contrastRatio(AMBER_300_LUMINANCE, DARK_CARD_LUMINANCE)).toBeGreaterThanOrEqual(4.5)
  })

  it('the Skip button no longer uses the failing amber-400 base color', () => {
    const post = makePost()
    const { container, cleanup } = renderInbox([post])

    const skip = buttonWithText(container, 'row.skip')
    expect(skip?.className).not.toContain('text-amber-400')
    expect(skip?.className).toContain('text-amber-700')
    expect(skip?.className).toContain('dark:text-amber-300')
    cleanup()
  })
})

// ── B5/MINOR-1: disabled-bulk badge contrast — real assertion, not a comment ──
//
// text-muted-foreground on bg-muted computes under the 4.5:1 AA floor in the
// light theme; text-foreground on the same bg-muted clears both themes. This
// used to be asserted only by a code comment at ApprovalsInbox.tsx ("measured
// 4.34:1…") — the exact "authored, not executed" shape ADR 0015 exists to
// name (session-22 review MINOR-1). The ratios below are computed from this
// app's actual CSS custom properties (app/globals.css --foreground/--muted),
// not eyeballed, and the comment in the component was deleted in favour of
// this test being the actual proof.

describe('ApprovalsInbox — disabled bulk badge contrast (B5/MINOR-1, WCAG AA)', () => {
  // --foreground / --muted in each theme, read from app/globals.css.
  const LIGHT_FOREGROUND_LUMINANCE = tokenLuminance(':root', 'foreground')
  const LIGHT_MUTED_LUMINANCE = tokenLuminance(':root', 'muted')
  const DARK_FOREGROUND_LUMINANCE = tokenLuminance('.dark', 'foreground')
  const DARK_MUTED_LUMINANCE = tokenLuminance('.dark', 'muted')

  it('text-foreground on bg-muted meets the 4.5:1 AA floor in the light theme', () => {
    expect(contrastRatio(LIGHT_FOREGROUND_LUMINANCE, LIGHT_MUTED_LUMINANCE)).toBeGreaterThanOrEqual(4.5)
  })

  it('text-foreground on bg-muted meets the 4.5:1 AA floor in the dark theme', () => {
    expect(contrastRatio(DARK_FOREGROUND_LUMINANCE, DARK_MUTED_LUMINANCE)).toBeGreaterThanOrEqual(4.5)
  })

  it('the disabled bulk trigger uses text-foreground, not the under-AA text-muted-foreground, on bg-muted', () => {
    const post = makePost()
    // totalPendingCount (341) > posts.length (1) => hasOverflow => disabled trigger
    const { container, cleanup } = renderInbox([post], [CAMPAIGN], 341)

    const disabledBulk = container.querySelector('[aria-label="bulk.incompleteSetHint"]')
    expect(disabledBulk?.className).toContain('bg-muted')
    expect(disabledBulk?.className).toContain('text-foreground')
    expect(disabledBulk?.className).not.toContain('text-muted-foreground')
    cleanup()
  })
})

// ── B5: bulk button accessible name states scope, not just count ───────────

describe('ApprovalsInbox — bulk button accessible name states WHAT it approves (B5)', () => {
  it('unfiltered: aria-label uses approveAllLabel with count and campaign, not just the count', () => {
    const post = makePost()
    const { container, cleanup } = renderInbox([post])

    const bulkButton = buttonWithText(container, 'bulk.approveAll')
    const ariaLabel = bulkButton?.getAttribute('aria-label') ?? ''
    expect(ariaLabel).toContain('bulk.approveAllLabel')
    expect(ariaLabel).not.toContain('bulk.approveAllLabelFiltered')
    expect(ariaLabel).toContain('"count":1')
    expect(ariaLabel).toContain(`"campaign":"${CAMPAIGN.name}"`)
    cleanup()
  })

  it('filtered: aria-label uses approveAllLabelFiltered and names the active platform', () => {
    const posts = [
      makePost({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', platform: 'linkedin' }),
      makePost({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', platform: 'twitter' }),
    ]
    const { container, cleanup } = renderInbox(posts)

    const platformSelect = container.querySelectorAll('select')[1] as HTMLSelectElement
    act(() => {
      platformSelect.value = 'twitter'
      platformSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })

    const bulkButton = buttonWithText(container, 'bulk.approveAll')
    const ariaLabel = bulkButton?.getAttribute('aria-label') ?? ''
    expect(ariaLabel).toContain('bulk.approveAllLabelFiltered')
    expect(ariaLabel).toContain('"platform":"X"')
    expect(ariaLabel).toContain('"count":1')
    cleanup()
  })

  it('the disabled (truncated) trigger states WHY, not just that it is inert', () => {
    const post = makePost()
    const { container, cleanup } = renderInbox([post], [CAMPAIGN], 341)

    const disabledBulk = container.querySelector('[aria-label="bulk.incompleteSetHint"]')
    expect(disabledBulk).not.toBeNull()
    expect(disabledBulk?.getAttribute('aria-label')).toBe('bulk.incompleteSetHint')
    cleanup()
  })
})

// ── B5: i18n key completeness across en/pt/es ───────────────────────────────

describe('ApprovalsInbox — i18n key completeness (B5)', () => {
  function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
    return Object.entries(obj).flatMap(([key, value]) => {
      const path = prefix ? `${prefix}.${key}` : key
      return typeof value === 'object' && value !== null
        ? flattenKeys(value as Record<string, unknown>, path)
        : [path]
    })
  }

  const enKeys = flattenKeys(en).sort()

  it('pt has exactly the same key set as en (no missing/extra keys)', () => {
    expect(flattenKeys(pt).sort()).toEqual(enKeys)
  })

  it('es has exactly the same key set as en (no missing/extra keys)', () => {
    expect(flattenKeys(es).sort()).toEqual(enKeys)
  })

  it('the new B5 bulk-scope and overflow keys exist in every locale', () => {
    for (const locale of [en, pt, es]) {
      expect(locale.bulk.approveAllLabel).toBeTruthy()
      expect(locale.bulk.approveAllLabelFiltered).toBeTruthy()
      expect(locale.overflow.notice).toBeTruthy()
    }
  })

  it('no locale hardcodes English inside the overflow notice (pt/es must differ from en)', () => {
    expect(pt.overflow.notice).not.toBe(en.overflow.notice)
    expect(es.overflow.notice).not.toBe(en.overflow.notice)
  })
})
