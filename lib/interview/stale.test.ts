import { describe, it, expect } from 'vitest'
import { isExtractionStale } from './stale'

// ADR 0029 §5.3, Session 35-D D6 (MAJOR-2) — INTERVIEW-EXTRACTION-RECOVERABLE, the pure rule. It mirrors
// claim_interview_extraction's `status = 'extracting' AND claimed_at < now() - interval '10 minutes'` (STRICT less-than) and treats
// a submitted round by its submitted_at. The Tier-1 half (the RPC itself re-entering at 11 minutes and refusing at 9) is
// supabase/__tests__/interview-lifecycle.test.ts.

const NOW = new Date('2026-09-28T12:00:00.000Z')
const ago = (minutes: number, seconds = 0) => new Date(NOW.getTime() - (minutes * 60 + seconds) * 1000).toISOString()
const round = (over: Partial<{ status: string; claimed_at: string | null; submitted_at: string | null }> = {}) => ({
  status: 'extracting',
  claimed_at: null,
  submitted_at: ago(30),
  ...over,
})

describe('isExtractionStale — an extracting round is judged by claimed_at, at the literal 10-minute boundary', () => {
  it('10 minutes + 1 second old is stale; exactly 10 minutes and 9 minutes 59 seconds are not (strict less-than, as the SQL)', () => {
    expect(isExtractionStale(round({ claimed_at: ago(10, 1) }), NOW)).toBe(true)
    expect(isExtractionStale(round({ claimed_at: ago(10) }), NOW)).toBe(false)
    expect(isExtractionStale(round({ claimed_at: ago(9, 59) }), NOW)).toBe(false)
  })

  it('11 minutes is stale and 9 minutes is not (the two cases the build guide names)', () => {
    expect(isExtractionStale(round({ claimed_at: ago(11) }), NOW)).toBe(true)
    expect(isExtractionStale(round({ claimed_at: ago(9) }), NOW)).toBe(false)
  })

  it('a FRESH claim on a round submitted long ago is NOT stale: an extracting round is judged by its claim clock, not submitted_at', () => {
    expect(isExtractionStale(round({ claimed_at: ago(1), submitted_at: ago(120) }), NOW)).toBe(false)
  })
})

describe('isExtractionStale — a submitted round that was never claimed is judged by submitted_at', () => {
  it('stale once submitted more than 10 minutes ago, not before', () => {
    expect(isExtractionStale(round({ status: 'submitted', submitted_at: ago(11) }), NOW)).toBe(true)
    expect(isExtractionStale(round({ status: 'submitted', submitted_at: ago(9) }), NOW)).toBe(false)
  })
})

describe('isExtractionStale — never a false offer', () => {
  it('a missing clock is not stale (the SQL comparison against NULL is not true either)', () => {
    expect(isExtractionStale(round({ claimed_at: null }), NOW)).toBe(false)
    expect(isExtractionStale(round({ status: 'submitted', submitted_at: null }), NOW)).toBe(false)
  })

  it('an unparseable clock is not stale', () => {
    expect(isExtractionStale(round({ claimed_at: 'not a timestamp' }), NOW)).toBe(false)
  })

  it.each(['open', 'extraction_failed', 'awaiting_ratification', 'no_records', 'ratified', 'skipped', 'expired', 'failed'])(
    'a %s round is never stale, however old its clocks (extraction_failed is retryable at once, and is not judged here)',
    (status) => {
      expect(isExtractionStale(round({ status, claimed_at: ago(600), submitted_at: ago(600) }), NOW)).toBe(false)
    },
  )
})
