// @vitest-environment happy-dom
//
// ADR 0022 §10 (Session 29 F1b.5) — PROMOTE-STATES-RENDERED's "promoting"
// state lives HERE (the confirm button's label while the action is in
// flight), not in StudioEditor.test.tsx, which stubs this component out —
// mirroring PostCard.test.tsx's stub of RegenerateDialog. Dialog/DialogContent
// etc. (components/ui/dialog.tsx, Base UI) are mocked to plain elements: no
// test in this codebase renders the real Base UI Portal (no
// RegenerateDialog.test.tsx exists either) — this file tests the promote
// dialog's OWN logic, not Base UI's portal machinery.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? React.createElement('div', null, children) : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  DialogHeader: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  DialogTitle: ({ children }: { children: React.ReactNode }) => React.createElement('h2', null, children),
  DialogDescription: ({ children }: { children: React.ReactNode }) => React.createElement('p', null, children),
  DialogFooter: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
}))

const promoteDraftToCampaign = vi.fn()
vi.mock('@/app/[locale]/(dashboard)/studio/actions', () => ({
  promoteDraftToCampaign: (...args: unknown[]) => promoteDraftToCampaign(...args),
}))

import { PromoteDraftDialog } from './PromoteDraftDialog'

function renderDialog(props: { draftId: string; open: boolean; onOpenChange: (o: boolean) => void; onOutcome: (r: unknown) => void }) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(React.createElement(PromoteDraftDialog, props))
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
})

describe('PromoteDraftDialog — closed', () => {
  it('renders nothing when closed', () => {
    const { container, cleanup } = renderDialog({ draftId: 'd1', open: false, onOpenChange: () => {}, onOutcome: () => {} })
    expect(container.innerHTML).toBe('')
    cleanup()
  })
})

describe('PromoteDraftDialog — open, defaults, and the "promoting" state (ADR 0022 §10)', () => {
  it('defaults scheduledAt to a datetime-local value and offers a confirm button labelled "promote"', () => {
    const { container, cleanup } = renderDialog({ draftId: 'd1', open: true, onOpenChange: () => {}, onOutcome: () => {} })
    const input = container.querySelector('input[type="datetime-local"]') as HTMLInputElement
    expect(input).not.toBeNull()
    expect(input.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    expect(buttonWithText(container, 'dialog.confirmButton')).not.toBeUndefined()
    cleanup()
  })

  it('shows "promoting" (dialog.confirmButtonSubmitting) on the confirm button while the action is in flight', async () => {
    let resolvePromote: (v: unknown) => void = () => {}
    promoteDraftToCampaign.mockReturnValue(new Promise((resolve) => { resolvePromote = resolve }))

    const { container, cleanup } = renderDialog({ draftId: 'd1', open: true, onOpenChange: () => {}, onOutcome: () => {} })
    const confirm = buttonWithText(container, 'dialog.confirmButton')
    expect(confirm).not.toBeUndefined()

    act(() => { confirm?.click() })
    // Still in flight — the label swaps to the submitting copy, a visible,
    // accessible-name-bearing distinct state from the idle confirm button.
    expect(buttonWithText(container, 'dialog.confirmButtonSubmitting')).not.toBeUndefined()
    expect(buttonWithText(container, 'dialog.confirmButton')).toBeUndefined()

    await act(async () => { resolvePromote({ outcome: 'promoted', campaignId: 'c1', briefId: 'b1', postId: 'p1' }) })
    cleanup()
  })

  it('calls promoteDraftToCampaign with the draftId and a UTC ISO scheduledAt derived from the local input', async () => {
    promoteDraftToCampaign.mockResolvedValue({ outcome: 'promoted', campaignId: 'c1', briefId: 'b1', postId: 'p1' })
    const { container, cleanup } = renderDialog({ draftId: 'd1', open: true, onOpenChange: () => {}, onOutcome: () => {} })

    await act(async () => { buttonWithText(container, 'dialog.confirmButton')?.click() })

    expect(promoteDraftToCampaign).toHaveBeenCalledTimes(1)
    const [draftIdArg, scheduledAtArg] = promoteDraftToCampaign.mock.calls[0]
    expect(draftIdArg).toBe('d1')
    expect(typeof scheduledAtArg).toBe('string')
    expect(scheduledAtArg).toMatch(/Z$/) // a real UTC ISO string, not the naive local value
    cleanup()
  })

  it('calls onOutcome and closes on ANY outcome, including error — "promote failed" is a persistent page state, not in-dialog text', async () => {
    promoteDraftToCampaign.mockResolvedValue({ outcome: 'error', error: 'generic' })
    const onOutcome = vi.fn()
    const onOpenChange = vi.fn()
    const { container, cleanup } = renderDialog({ draftId: 'd1', open: true, onOpenChange, onOutcome })

    await act(async () => { buttonWithText(container, 'dialog.confirmButton')?.click() })

    expect(onOutcome).toHaveBeenCalledWith({ outcome: 'error', error: 'generic' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
    cleanup()
  })
})
