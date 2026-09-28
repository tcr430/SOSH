import { describe, it, expect, vi, beforeEach } from 'vitest'

// ADR 0029 §8.1 (Session 35 M2.10) — loadInterviewPageState only fetches what the CURRENT round status needs:
// answers for 'open', candidates for 'awaiting_ratification' + a ratifier, selection inputs otherwise.

vi.mock('@/lib/db/founder-interview-answers', () => ({ listAnswersForRound: vi.fn(), listInterviewCooldownRows: vi.fn() }))
vi.mock('@/lib/db/founder-interview-rounds', () => ({ getLatestInterviewRound: vi.fn() }))
vi.mock('@/lib/memory/interview', () => ({ listInterviewCandidatesForRound: vi.fn() }))
vi.mock('@/lib/memory/interview-coverage', () => ({ readInterviewSlotRows: vi.fn() }))

import { listAnswersForRound, listInterviewCooldownRows } from '@/lib/db/founder-interview-answers'
import { getLatestInterviewRound } from '@/lib/db/founder-interview-rounds'
import { listInterviewCandidatesForRound } from '@/lib/memory/interview'
import { readInterviewSlotRows } from '@/lib/memory/interview-coverage'
import { loadInterviewPageState } from './load-page-state'

const client = {} as never
const BUSINESS = { id: 'biz-1', interview_snoozed_until: null }

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(readInterviewSlotRows).mockResolvedValue([])
  vi.mocked(listInterviewCooldownRows).mockResolvedValue([])
})

describe('loadInterviewPageState', () => {
  it('an open round: fetches answers, NOT candidates, NOT the selection inputs', async () => {
    vi.mocked(getLatestInterviewRound).mockResolvedValue({ id: 'r-1', status: 'open' } as never)
    vi.mocked(listAnswersForRound).mockResolvedValue([{ id: 'a-1' }] as never)

    const state = await loadInterviewPageState(client, BUSINESS, false)

    expect(state).toMatchObject({ kind: 'in_progress' })
    expect(listAnswersForRound).toHaveBeenCalledTimes(1)
    expect(listAnswersForRound).toHaveBeenCalledWith(client, 'r-1')
    expect(listInterviewCandidatesForRound).not.toHaveBeenCalled()
    expect(readInterviewSlotRows).not.toHaveBeenCalled()
    expect(listInterviewCooldownRows).not.toHaveBeenCalled()
  })

  it('awaiting_ratification as a ratifier: fetches the round answers once for the candidate lookup, and the candidates', async () => {
    vi.mocked(getLatestInterviewRound).mockResolvedValue({ id: 'r-1', status: 'awaiting_ratification' } as never)
    vi.mocked(listAnswersForRound).mockResolvedValue([{ id: 'a-1' }, { id: 'a-2' }] as never)
    vi.mocked(listInterviewCandidatesForRound).mockResolvedValue({ brand: [], audience: [], evidence: [] })

    const state = await loadInterviewPageState(client, BUSINESS, true)

    expect(state).toMatchObject({
      kind: 'awaiting_ratification',
      isRatifier: true,
      candidates: { brand: [], audience: [], evidence: [] },
      answers: [{ id: 'a-1' }, { id: 'a-2' }],
    })
    expect(listAnswersForRound).toHaveBeenCalledTimes(1) // fetched once, reused for both the candidate lookup and the state's own `answers`
    expect(listInterviewCandidatesForRound).toHaveBeenCalledWith(client, ['a-1', 'a-2'])
    expect(readInterviewSlotRows).not.toHaveBeenCalled()
  })

  it('awaiting_ratification as a plain author (not a ratifier): candidates stay null, but the answers are still fetched (RLS-scoped, no new exposure) so the round still resolves', async () => {
    vi.mocked(getLatestInterviewRound).mockResolvedValue({ id: 'r-1', status: 'awaiting_ratification' } as never)
    vi.mocked(listAnswersForRound).mockResolvedValue([{ id: 'a-1' }] as never)

    const state = await loadInterviewPageState(client, BUSINESS, false)

    expect(state).toMatchObject({ kind: 'awaiting_ratification', isRatifier: false, candidates: null, answers: [{ id: 'a-1' }] })
    expect(listInterviewCandidatesForRound).not.toHaveBeenCalled()
  })

  it('no round at all: fetches the selection inputs (thinness + cooldowns), not answers or candidates', async () => {
    vi.mocked(getLatestInterviewRound).mockResolvedValue(null)

    await loadInterviewPageState(client, BUSINESS, false)

    expect(readInterviewSlotRows).toHaveBeenCalledTimes(1)
    expect(listInterviewCooldownRows).toHaveBeenCalledTimes(1)
    expect(listAnswersForRound).not.toHaveBeenCalled()
  })

  it('a terminal round (ratified) also fetches the selection inputs, to know whether a NEW round is due', async () => {
    vi.mocked(getLatestInterviewRound).mockResolvedValue({ id: 'r-1', status: 'ratified', created_at: '2020-01-01T00:00:00Z' } as never)

    await loadInterviewPageState(client, BUSINESS, false)

    expect(readInterviewSlotRows).toHaveBeenCalledTimes(1)
    expect(listInterviewCooldownRows).toHaveBeenCalledTimes(1)
  })

  it('a non-terminal, non-open, non-ratification round (extracting) fetches NEITHER answers/candidates NOR the selection inputs', async () => {
    vi.mocked(getLatestInterviewRound).mockResolvedValue({ id: 'r-1', status: 'extracting' } as never)

    const state = await loadInterviewPageState(client, BUSINESS, false)

    expect(state).toMatchObject({ kind: 'extracting' })
    expect(listAnswersForRound).not.toHaveBeenCalled()
    expect(readInterviewSlotRows).not.toHaveBeenCalled()
  })
})
