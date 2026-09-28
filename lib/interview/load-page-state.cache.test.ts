import { describe, it, expect, vi, beforeEach } from 'vitest'

// ADR 0029 §8.1, Session 35-D D7 (Reviewer MINOR-9) — loadInterviewPageState is memoised PER REQUEST with React's cache(), keyed on
// primitives, so the dashboard layout (the nav badge), the campaigns card and the /interview page of ONE request share one load
// instead of each reading up to 3 x 500 memory rows plus the cooldown rows.
//
// React's cache() only memoises inside a server render; in a plain vitest process it is a pass-through. So this file replaces it
// with a faithful memoiser (arguments compared as primitives, as React does) and an explicit "new request" reset. The unwrapped
// function would call the reads once per caller, which is exactly what the first test catches.

const scope = vi.hoisted(() => ({ memos: [] as Array<Map<string, unknown>> }))
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    cache: <A extends unknown[], R>(fn: (...args: A) => R) => {
      const memo = new Map<string, unknown>()
      scope.memos.push(memo)
      return (...args: A): R => {
        const key = JSON.stringify(args)
        if (!memo.has(key)) memo.set(key, fn(...args))
        return memo.get(key) as R
      }
    },
  }
})

vi.mock('@/lib/db/founder-interview-answers', () => ({ listAnswersForRound: vi.fn(), listInterviewCooldownRows: vi.fn() }))
vi.mock('@/lib/db/founder-interview-rounds', () => ({ getLatestInterviewRound: vi.fn() }))
vi.mock('@/lib/memory/interview', () => ({ listInterviewCandidatesForRound: vi.fn() }))
vi.mock('@/lib/memory/interview-coverage', () => ({ readInterviewSlotRows: vi.fn() }))

import { listAnswersForRound, listInterviewCooldownRows } from '@/lib/db/founder-interview-answers'
import { getLatestInterviewRound } from '@/lib/db/founder-interview-rounds'
import { readInterviewSlotRows } from '@/lib/memory/interview-coverage'
import { loadInterviewBadge, loadInterviewPageState } from './load-page-state'

const BUSINESS = { id: 'biz-1', interview_snoozed_until: null }
const newRequest = () => scope.memos.forEach((memo) => memo.clear())

beforeEach(() => {
  vi.resetAllMocks()
  newRequest()
  vi.mocked(readInterviewSlotRows).mockResolvedValue([])
  vi.mocked(listInterviewCooldownRows).mockResolvedValue([])
  vi.mocked(getLatestInterviewRound).mockResolvedValue({ id: 'r-1', status: 'open' } as never)
  vi.mocked(listAnswersForRound).mockResolvedValue([{ id: 'a-1' }] as never)
})

describe('loadInterviewPageState — one load per request (MINOR-9)', () => {
  it('two calls with the same arguments inside one request run the underlying reads ONCE, and share the result', async () => {
    const [a, b] = await Promise.all([loadInterviewPageState({} as never, BUSINESS, false), loadInterviewPageState({} as never, BUSINESS, false)])
    expect(getLatestInterviewRound).toHaveBeenCalledTimes(1)
    expect(listAnswersForRound).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
    expect(a).toMatchObject({ kind: 'in_progress' })
  })

  it('the layout, the card and the page of one request (three callers, three different client objects) share ONE load', async () => {
    const layout = loadInterviewPageState({ who: 'layout' } as never, BUSINESS, false)
    const card = loadInterviewPageState({ who: 'card' } as never, BUSINESS, false)
    const page = loadInterviewPageState({ who: 'page' } as never, BUSINESS, false)
    await Promise.all([layout, card, page])
    expect(getLatestInterviewRound).toHaveBeenCalledTimes(1)
  })

  it("the FIRST caller's client does the reads (a client is not part of the key: it is an object, and every client of a request is the same user's session)", async () => {
    const first = { who: 'first' } as never
    await loadInterviewPageState(first, BUSINESS, false)
    await loadInterviewPageState({ who: 'second' } as never, BUSINESS, false)
    expect(vi.mocked(getLatestInterviewRound).mock.calls[0][0]).toBe(first)
    expect(getLatestInterviewRound).toHaveBeenCalledTimes(1)
  })

  it('a different business, snooze instant or ratifier flag is a DIFFERENT key and loads separately', async () => {
    await loadInterviewPageState({} as never, BUSINESS, false)
    await loadInterviewPageState({} as never, BUSINESS, true)
    await loadInterviewPageState({} as never, { id: 'biz-2', interview_snoozed_until: null }, false)
    await loadInterviewPageState({} as never, { id: 'biz-1', interview_snoozed_until: '2026-10-04T00:00:00Z' }, false)
    expect(getLatestInterviewRound).toHaveBeenCalledTimes(4)
  })

  it("a NEW request (a Server Action revalidation, the panel's polling refresh) reads fresh state, not the previous request's", async () => {
    await loadInterviewPageState({} as never, BUSINESS, false)
    newRequest()
    vi.mocked(getLatestInterviewRound).mockResolvedValue({ id: 'r-1', status: 'extracting', claimed_at: null, submitted_at: null } as never)
    const next = await loadInterviewPageState({} as never, BUSINESS, false)
    expect(getLatestInterviewRound).toHaveBeenCalledTimes(2)
    expect(next).toMatchObject({ kind: 'extracting' })
  })

  it('the nav badge (loadInterviewBadge) and a card in the same request share that one load', async () => {
    await loadInterviewBadge({} as never, BUSINESS, { role: 'editor', isAdmin: false })
    await loadInterviewPageState({} as never, BUSINESS, false) // the card's call for the same editor
    expect(getLatestInterviewRound).toHaveBeenCalledTimes(1)
  })

  it('a failing load is shared within the request too: every caller sees the same rejection and the reads are not retried per caller', async () => {
    vi.mocked(getLatestInterviewRound).mockRejectedValue(new Error('db down'))
    const results = await Promise.allSettled([
      loadInterviewPageState({} as never, BUSINESS, false),
      loadInterviewPageState({} as never, BUSINESS, false),
    ])
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected'])
    expect(getLatestInterviewRound).toHaveBeenCalledTimes(1)
  })
})

// ADR 0029 §5.5, Session 35-D D7 (MINOR-2) — the layout's nav badge follows the same role rule as the card: authors get due / open,
// ratifiers get awaiting ratification, and a viewer never triggers the load.
describe('loadInterviewBadge — the nav badge is role-aware (§5.5)', () => {
  const MEMBERS = {
    viewer: { role: 'viewer', isAdmin: false },
    editor: { role: 'editor', isAdmin: false },
    approver: { role: 'approver', isAdmin: false },
    'admin (viewer + admin)': { role: 'viewer', isAdmin: true },
  } as const
  const open = () => vi.mocked(getLatestInterviewRound).mockResolvedValue({ id: 'r-1', status: 'open' } as never)
  const awaiting = () => {
    vi.mocked(getLatestInterviewRound).mockResolvedValue({ id: 'r-1', status: 'awaiting_ratification' } as never)
    vi.mocked(listAnswersForRound).mockResolvedValue([])
  }

  it('a VIEWER gets no badge and the load is never made (no reads for a member who can act on nothing)', async () => {
    open()
    expect(await loadInterviewBadge({} as never, BUSINESS, MEMBERS.viewer)).toBe(false)
    expect(getLatestInterviewRound).not.toHaveBeenCalled()
  })

  it('an EDITOR gets the badge for an open round, but NOT for a ratification they cannot perform', async () => {
    open()
    expect(await loadInterviewBadge({} as never, BUSINESS, MEMBERS.editor)).toBe(true)
    newRequest()
    awaiting()
    expect(await loadInterviewBadge({} as never, BUSINESS, MEMBERS.editor)).toBe(false)
  })

  it('an APPROVER gets the badge for an open round and for a ratification', async () => {
    open()
    expect(await loadInterviewBadge({} as never, BUSINESS, MEMBERS.approver)).toBe(true)
    newRequest()
    awaiting()
    expect(await loadInterviewBadge({} as never, BUSINESS, MEMBERS.approver)).toBe(true)
  })

  it('an ADMIN who cannot author gets the ratification badge only (the ratify RPC admits is_admin), and is told they are a ratifier', async () => {
    open()
    expect(await loadInterviewBadge({} as never, BUSINESS, MEMBERS['admin (viewer + admin)'])).toBe(false)
    newRequest()
    awaiting()
    expect(await loadInterviewBadge({} as never, BUSINESS, MEMBERS['admin (viewer + admin)'])).toBe(true)
  })
})
