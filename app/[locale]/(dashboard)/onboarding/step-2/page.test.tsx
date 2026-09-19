import { describe, it, expect, vi, beforeEach } from 'vitest'

// ADR 0025 §10.3 (Session 32-D, D9 / A-7) — step-2 renders the SHARED
// VoiceEditor (via VoiceReviewHost) for a ratified run with an actionable
// voice, and the ordinary Step2Form otherwise.

const getBackfillRunForReviewAction = vi.fn()

vi.mock('../step-4/backfill-actions', () => ({
  getBackfillRunForReviewAction: (...args: unknown[]) => getBackfillRunForReviewAction(...args),
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) } }),
}))
vi.mock('@/lib/db/businesses', () => ({ getBusinessForUser: async () => ({ id: 'b1' }) }))
vi.mock('@/lib/db/brand-voices', () => ({ getBrandVoice: async () => ({ writing_examples: [] }) }))
vi.mock('./Step2Form', () => ({ Step2Form: () => null }))
vi.mock('./VoiceReviewHost', () => ({ VoiceReviewHost: () => null }))

import Step2Page from './page'
import { Step2Form } from './Step2Form'
import { VoiceReviewHost } from './VoiceReviewHost'

async function render(runId?: string) {
  const el = await Step2Page({
    params: Promise.resolve({ locale: 'en' }),
    searchParams: Promise.resolve(runId ? { run: runId } : {}),
  })
  return (el as { type: unknown }).type
}

describe('step-2 page — voice review vs website path', () => {
  beforeEach(() => getBackfillRunForReviewAction.mockReset())

  it('ratified run with a pending voice renders the shared-editor host', async () => {
    getBackfillRunForReviewAction.mockResolvedValue({ id: 'r1', status: 'ratified', voice_status: 'pending' })
    expect(await render('r1')).toBe(VoiceReviewHost)
  })

  it.each(['applied', 'declined', null])('ratified run with voice_status %s falls through to Step2Form', async (vs) => {
    getBackfillRunForReviewAction.mockResolvedValue({ id: 'r1', status: 'ratified', voice_status: vs })
    expect(await render('r1')).toBe(Step2Form)
  })

  it('an un-ratified run falls through to Step2Form', async () => {
    getBackfillRunForReviewAction.mockResolvedValue({ id: 'r1', status: 'awaiting_ratification', voice_status: 'pending' })
    expect(await render('r1')).toBe(Step2Form)
  })

  it('no ?run renders Step2Form', async () => {
    expect(await render()).toBe(Step2Form)
  })
})
