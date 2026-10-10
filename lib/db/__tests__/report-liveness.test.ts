import { describe, it, expect } from 'vitest'
import { isLiveForReports, TRIAL_LENGTH_DAYS } from '../businesses'

// ADR 0031 §5.2, founder ruling O-2: the ONE business-liveness predicate. A live trial is plan = 'trial' AND the clock
// started AND under 14 days old; a live paid business has a non-null subscription id; anything else gets no report.
const NOW = '2026-04-10T06:00:00Z'
const daysBefore = (n: number) => new Date(Date.parse(NOW) - n * 86_400_000).toISOString()

describe('isLiveForReports', () => {
  it('the trial length is 14 days', () => expect(TRIAL_LENGTH_DAYS).toBe(14))

  it('TRIAL LIVE: started 5 days ago', () => {
    expect(isLiveForReports({ plan: 'trial', stripe_subscription_id: null, trial_started_at: daysBefore(5) }, NOW)).toBe(true)
  })
  it('TRIAL EXPIRED: started 15 days ago', () => {
    expect(isLiveForReports({ plan: 'trial', stripe_subscription_id: null, trial_started_at: daysBefore(15) }, NOW)).toBe(false)
  })
  it('the boundary is exact: 14 days to the millisecond is expired, one millisecond short is live', () => {
    const started = Date.parse(NOW) - 14 * 86_400_000
    expect(isLiveForReports({ plan: 'trial', stripe_subscription_id: null, trial_started_at: new Date(started).toISOString() }, NOW)).toBe(false)
    expect(isLiveForReports({ plan: 'trial', stripe_subscription_id: null, trial_started_at: new Date(started + 1).toISOString() }, NOW)).toBe(true)
  })
  it('a trial whose clock NEVER started gets no report (and so no stub)', () => {
    expect(isLiveForReports({ plan: 'trial', stripe_subscription_id: null, trial_started_at: null }, NOW)).toBe(false)
  })
  it('PAID ACTIVE: a paid plan with a subscription id', () => {
    for (const plan of ['plus', 'pro', 'agency']) expect(isLiveForReports({ plan, stripe_subscription_id: 'sub_1', trial_started_at: null }, NOW), plan).toBe(true)
  })
  it('CANCELLED: clearBillingOnCancellation leaves plan = trial and a null subscription, with an old trial clock', () => {
    expect(isLiveForReports({ plan: 'trial', stripe_subscription_id: null, trial_started_at: daysBefore(90) }, NOW)).toBe(false)
  })
  it('a paid plan WITHOUT a subscription id (lapsed) is not live, and neither is an empty id', () => {
    expect(isLiveForReports({ plan: 'pro', stripe_subscription_id: null, trial_started_at: null }, NOW)).toBe(false)
    expect(isLiveForReports({ plan: 'pro', stripe_subscription_id: '', trial_started_at: null }, NOW)).toBe(false)
  })
  it('an UNKNOWN plan on a live subscription is live (it is served the basic tier); without one it is not', () => {
    expect(isLiveForReports({ plan: 'enterprise', stripe_subscription_id: 'sub_9', trial_started_at: null }, NOW)).toBe(true)
    expect(isLiveForReports({ plan: 'enterprise', stripe_subscription_id: null, trial_started_at: null }, NOW)).toBe(false)
    expect(isLiveForReports({ plan: null, stripe_subscription_id: null, trial_started_at: null }, NOW)).toBe(false)
  })
  it('a non-finite timestamp THROWS rather than answering', () => {
    expect(() => isLiveForReports({ plan: 'trial', stripe_subscription_id: null, trial_started_at: 'garbage' }, NOW)).toThrow(/timestamp/)
  })
})
