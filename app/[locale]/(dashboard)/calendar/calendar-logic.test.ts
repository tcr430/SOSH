import { describe, it, expect, vi } from 'vitest'

// ── Dependency mocks (hoisted) — required for DashboardShell module load ──────

vi.mock('next/link', () => ({ default: vi.fn() }))
vi.mock('next/navigation', () => ({ usePathname: vi.fn(), useRouter: vi.fn() }))
vi.mock('next-intl', () => ({ useTranslations: vi.fn() }))
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: vi.fn(),
  DropdownMenuContent: vi.fn(),
  DropdownMenuItem: vi.fn(),
  DropdownMenuSeparator: vi.fn(),
  DropdownMenuTrigger: vi.fn(),
}))
vi.mock('@/lib/contexts/business-context', () => ({ useActiveBusiness: vi.fn() }))
vi.mock('@/app/[locale]/(dashboard)/actions', () => ({ logoutAction: vi.fn() }))
vi.mock('@/components/ui/button', () => ({ buttonVariants: vi.fn().mockReturnValue('') }))
vi.mock('@/lib/utils', () => ({ cn: (...args: unknown[]) => args.filter(Boolean).join(' ') }))

// ── Imports ───────────────────────────────────────────────────────────────────

import {
  deriveCampaignDayBoxState,
  CALENDAR_PALETTE,
} from '@/components/calendar/CampaignDayBox'
import {
  CREATE_POST_DISABLED,
  campaignCreatePath,
} from '@/components/calendar/CalendarToolbar'
import {
  ACTIVE_NAV,
  COMING_SOON_NAV,
} from '@/components/layout/DashboardShell'
import type { CampaignDayCell } from '@/lib/calendar/types'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeCell(overrides: Partial<CampaignDayCell> = {}): CampaignDayCell {
  return {
    campaignId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    campaignName: 'Test Campaign',
    dayKey: '2026-06-15',
    colorIndex: 0,
    platforms: ['linkedin'],
    postIds: ['id-1'],
    allPublished: false,
    anyDraft: false,
    anyFailed: false,
    allMovable: true,
    allSkipped: false,
    ...overrides,
  }
}

// ── deriveCampaignDayBoxState ─────────────────────────────────────────────────

describe('deriveCampaignDayBoxState — render logic from a cell', () => {
  it('allPublished=true → isTransparent (published work recedes)', () => {
    expect(deriveCampaignDayBoxState(makeCell({ allPublished: true })).isTransparent).toBe(true)
  })

  it('allPublished=false → solid (isTransparent=false)', () => {
    expect(deriveCampaignDayBoxState(makeCell({ allPublished: false })).isTransparent).toBe(false)
  })

  it('anyDraft=true, not skipped → showDraftBadge', () => {
    expect(deriveCampaignDayBoxState(makeCell({ anyDraft: true })).showDraftBadge).toBe(true)
  })

  // NIT-1: showDraftBadge no longer guards on !allSkipped — groupByCampaignDay derives
  // allSkipped as "every status === 'skipped'", so allSkipped=true implies anyDraft=false
  // for any real cell; this input combination is unreachable outside a synthetic fixture.
  it('anyDraft=true → showDraftBadge, even alongside a synthetically-forced allSkipped', () => {
    const state = deriveCampaignDayBoxState(makeCell({ anyDraft: true, allSkipped: true }))
    expect(state.showDraftBadge).toBe(true)
  })

  it('anyFailed=true → showFailedDot', () => {
    expect(deriveCampaignDayBoxState(makeCell({ anyFailed: true })).showFailedDot).toBe(true)
  })

  it('anyFailed=false → no dot', () => {
    expect(deriveCampaignDayBoxState(makeCell({ anyFailed: false })).showFailedDot).toBe(false)
  })

  it('allSkipped=true → isMuted (R7)', () => {
    expect(deriveCampaignDayBoxState(makeCell({ allSkipped: true })).isMuted).toBe(true)
  })

  it('allSkipped=false → not muted', () => {
    expect(deriveCampaignDayBoxState(makeCell({ allSkipped: false })).isMuted).toBe(false)
  })

  it('colorIndex maps to the correct palette slot', () => {
    expect(deriveCampaignDayBoxState(makeCell({ colorIndex: 3 })).color).toBe(CALENDAR_PALETTE[3])
  })

  it('colorIndex wraps when it exceeds palette length', () => {
    const state = deriveCampaignDayBoxState(makeCell({ colorIndex: CALENDAR_PALETTE.length }))
    expect(state.color).toBe(CALENDAR_PALETTE[0])
  })
})

// ── CalendarToolbar contracts ─────────────────────────────────────────────────

describe('CalendarToolbar exported contracts', () => {
  it('CREATE_POST_DISABLED is true (L-F / D-J)', () => {
    expect(CREATE_POST_DISABLED).toBe(true)
  })

  it('campaignCreatePath builds the campaign-create route (D-J / L-C)', () => {
    expect(campaignCreatePath('en')).toBe('/en/campaigns/new')
    expect(campaignCreatePath('pt')).toBe('/pt/campaigns/new')
  })
})

// ── DashboardShell nav structure ──────────────────────────────────────────────

describe('DashboardShell nav (D-Q promotion)', () => {
  it('calendar is in ACTIVE_NAV', () => {
    expect(ACTIVE_NAV.map(n => n.key)).toContain('calendar')
  })

  it('calendar is NOT in COMING_SOON_NAV', () => {
    expect(COMING_SOON_NAV.map(n => n.key)).not.toContain('calendar')
  })

  it('ACTIVE_NAV has no duplicate keys', () => {
    const keys = ACTIVE_NAV.map(n => n.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('calendar ACTIVE_NAV entry has href=calendar (routable)', () => {
    const entry = ACTIVE_NAV.find(n => n.key === 'calendar')
    expect((entry as { href: string } | undefined)?.href).toBe('calendar')
  })
})
