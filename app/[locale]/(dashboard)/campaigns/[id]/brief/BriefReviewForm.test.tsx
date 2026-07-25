// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, string | number>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

vi.mock('./actions', () => ({
  approveBriefAction: vi.fn(),
  rejectBriefAction: vi.fn(),
  editBriefAction: vi.fn(),
}))

import { BriefReviewForm } from './BriefReviewForm'
import { approveBriefAction, rejectBriefAction, editBriefAction } from './actions'
import type { CampaignBriefRow } from '@/lib/db/types'

function makeBrief(overrides: Partial<CampaignBriefRow> = {}): CampaignBriefRow {
  return {
    id: 'brief-1',
    business_id: 'biz-1',
    campaign_id: 'camp-1',
    content: {
      narrative: 'The narrative',
      proofPlan: 'The proof plan',
      pinnedEvidence: [],
      roleSequence: [{ order: 0, role: 'anchor_thesis', platform: 'linkedin', angle: 'the angle' }],
    },
    status: 'critiqued',
    version: 1,
    overall_score: 85,
    critique: { critique: ['note'] },
    frozen_at: null,
    deleted_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

// react-reviewer finding (Session 24-D, D5) — a hardcoded double
// `await Promise.resolve()` after requestSubmit() is timing-dependent on how
// many MICROTASK hops React 19's useActionState needs internally between the
// action promise resolving and the state update committing; that's an
// implementation detail, not a documented guarantee. `vi.waitFor` (tried
// first) polls via real timers, which don't resolve reliably nested inside a
// single `act(async () => ...)` in this happy-dom setup (timed out on all
// three cases). A macrotask flush (`setTimeout(resolve, 0)`) is the standard
// "drain every pending microtask, whatever the count" trick — robust to
// however many hops React needs internally, unlike counting Promise.resolve()
// calls by hand.
async function submitAndWaitForStatus(form: HTMLFormElement) {
  await act(async () => {
    form.requestSubmit()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function renderForm(brief: CampaignBriefRow) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(React.createElement(BriefReviewForm, { campaignId: 'camp-1', brief }))
  })
  return {
    container,
    cleanup: () => {
      act(() => { root.unmount() })
      container.remove()
    },
  }
}

// Session 24-D (NIT-1 correction) — approved_success/rejected_success/
// saved_success were authored in en/pt/es but never consumed; router.refresh()
// alone gave no user-facing feedback. These tests submit each form (through
// React 19's real `action={formAction}` form-submission mechanism, not a
// simulated state injection) and assert the corresponding confirmation text
// appears in the rendered DOM — proving the wiring, not just that the i18n
// keys exist.
describe('BriefReviewForm — success confirmation renders after each action (NIT-1)', () => {
  it('renders approved_success after a successful approve submission', async () => {
    vi.mocked(approveBriefAction).mockResolvedValue({ status: 'approved' })
    const { container, cleanup } = renderForm(makeBrief())

    const approveForm = container.querySelectorAll('form')[0] as HTMLFormElement
    await submitAndWaitForStatus(approveForm)

    const status = container.querySelector('[role="status"]')
    expect(status?.textContent).toBe('approved_success')
    cleanup()
  })

  it('renders rejected_success after a successful reject submission', async () => {
    vi.mocked(rejectBriefAction).mockResolvedValue({ status: 'rejected' })
    const { container, cleanup } = renderForm(makeBrief())

    const rejectForm = container.querySelectorAll('form')[1] as HTMLFormElement
    await submitAndWaitForStatus(rejectForm)

    const status = container.querySelector('[role="status"]')
    expect(status?.textContent).toBe('rejected_success')
    cleanup()
  })

  it('renders saved_success after a successful edit submission', async () => {
    vi.mocked(editBriefAction).mockResolvedValue({ status: 'saved' })
    const { container, cleanup } = renderForm(makeBrief())

    const editForm = container.querySelectorAll('form')[2] as HTMLFormElement
    await submitAndWaitForStatus(editForm)

    const status = container.querySelector('[role="status"]')
    expect(status?.textContent).toBe('saved_success')
    cleanup()
  })

  it('renders no confirmation before any action is submitted', () => {
    const { container, cleanup } = renderForm(makeBrief())
    expect(container.querySelector('[role="status"]')).toBeNull()
    cleanup()
  })
})
