import { describe, it, expect } from 'vitest'
import { addDays, formatISO, subDays } from 'date-fns'
import { baseline, eligibleValue, liftAgainst, median, normaliseOutcome, type PriorOutcome } from '../normalise'

// ADR 0026 §6.2, §6.3 — OUTCOME-ELIGIBLE-FIELDS-ONLY (10), OUTCOME-NORMALISED-TO-OWN-BASELINE (11),
// OUTCOME-SEED-BASIS-MATCH (12). Tier 2, golden tables — every expected number is a literal.

const POST_AT = new Date('2026-09-10T12:00:00Z')
const at = (daysBefore: number) => formatISO(subDays(POST_AT, daysBefore))
const prior = (n: number, value: (i: number) => number, basis: 'rate' | 'count' = 'rate', daysBefore: (i: number) => number = (i) => 1 + i): PriorOutcome[] =>
  Array.from({ length: n }, (_, i) => ({ postId: `p${i}`, publishedAt: at(daysBefore(i)), value: value(i), basis }))

describe('eligibleValue (OUTCOME-ELIGIBLE-FIELDS-ONLY)', () => {
  it('X: rate = (likes + comments + shares) / impressions', () => {
    expect(eligibleValue('twitter', { likes: 4, comments: 2, shares: 2, impressions: 100 })).toEqual({ ok: true, basis: 'rate', value: 0.08 })
  })

  it('LinkedIn: count = likes + comments + shares, and impressions / reach / saves / clicks are NEVER read', () => {
    const a = eligibleValue('linkedin', { likes: 10, comments: 3, shares: 2, impressions: 99999, reach: 5, saves: 7, clicks: 9 })
    const b = eligibleValue('linkedin', { likes: 10, comments: 3, shares: 2, impressions: null, reach: null, saves: null, clicks: null })
    expect(a).toEqual({ ok: true, basis: 'count', value: 15 })
    expect(b).toEqual(a)
  })

  it('X never reads reach, saves or clicks', () => {
    const base = { likes: 4, comments: 2, shares: 2, impressions: 100 }
    expect(eligibleValue('twitter', { ...base, reach: 1, saves: 500, clicks: 900 })).toEqual(eligibleValue('twitter', base))
  })

  it.each(['likes', 'comments', 'shares', 'impressions'] as const)('X: %s null -> EXCLUDED with a typed reason, never zeroed', (field) => {
    const metrics = { likes: 4, comments: 2, shares: 2, impressions: 100, [field]: null }
    expect(eligibleValue('twitter', metrics)).toEqual({ ok: false, reason: 'null_field', field })
  })

  it.each(['likes', 'comments', 'shares'] as const)('LinkedIn: %s null -> EXCLUDED with a typed reason, never zeroed', (field) => {
    const metrics = { likes: 4, comments: 2, shares: 2, [field]: null }
    expect(eligibleValue('linkedin', metrics)).toEqual({ ok: false, reason: 'null_field', field })
  })

  it('an ABSENT (undefined) field is excluded too, and a genuine 0 is kept', () => {
    expect(eligibleValue('linkedin', { likes: 4, comments: 2 })).toEqual({ ok: false, reason: 'null_field', field: 'shares' })
    expect(eligibleValue('linkedin', { likes: 0, comments: 0, shares: 0 })).toEqual({ ok: true, basis: 'count', value: 0 })
  })

  it('X impressions = 0 is excluded (the rate is undefined), not Infinity and not 0', () => {
    expect(eligibleValue('twitter', { likes: 3, comments: 0, shares: 0, impressions: 0 })).toEqual({ ok: false, reason: 'zero_impressions' })
  })

  it('a non-finite or negative count is treated as a null field', () => {
    expect(eligibleValue('linkedin', { likes: Number.NaN, comments: 1, shares: 1 })).toMatchObject({ ok: false, reason: 'null_field', field: 'likes' })
    expect(eligibleValue('linkedin', { likes: -1, comments: 1, shares: 1 })).toMatchObject({ ok: false, reason: 'null_field', field: 'likes' })
  })

  it('an unsupported platform is excluded', () => {
    expect(eligibleValue('instagram', { likes: 1, comments: 1, shares: 1, impressions: 10 })).toEqual({ ok: false, reason: 'unsupported_platform' })
  })
})

describe('baseline (OUTCOME-NORMALISED-TO-OWN-BASELINE)', () => {
  const x = (over: Partial<Parameters<typeof baseline>[0]> = {}) =>
    baseline({ platform: 'twitter', basis: 'rate', postId: 'self', publishedAt: formatISO(POST_AT), prior: [], seed: null, ...over })

  it('X with 7 own outcomes -> null; with exactly 8 -> the median', () => {
    expect(x({ prior: prior(7, () => 0.05) })).toBeNull()
    expect(x({ prior: prior(8, (i) => (i + 1) / 100) })).toEqual({ baseline: 0.045, baselineN: 8, source: 'own' }) // median of .01..08
  })

  it('the post is EXCLUDED from its own baseline (by id), even with an extreme value', () => {
    const others = prior(7, () => 0.05)
    const self: PriorOutcome = { postId: 'self', publishedAt: at(1), value: 9, basis: 'rate' }
    expect(x({ prior: [...others, self] })).toBeNull() // 7 others + itself is NOT 8
    expect(x({ prior: [...prior(8, () => 0.05), self] })).toEqual({ baseline: 0.05, baselineN: 8, source: 'own' })
  })

  it('X counts only the 90 days BEFORE the post: a 91-day-old outcome does not count, a later one never does', () => {
    const eight = prior(8, () => 0.05)
    expect(x({ prior: [...eight.slice(0, 7), { postId: 'old', publishedAt: at(91), value: 0.05, basis: 'rate' }] })).toBeNull()
    expect(x({ prior: [...eight.slice(0, 7), { postId: 'later', publishedAt: formatISO(addDays(POST_AT, 1)), value: 0.05, basis: 'rate' }] })).toBeNull()
    expect(x({ prior: [...eight.slice(0, 7), { postId: 'edge', publishedAt: at(90), value: 0.05, basis: 'rate' }] })).toMatchObject({ baselineN: 8 })
  })

  it('LinkedIn uses the LAST 20 matured outcomes before the post (a count window), needing >= 8', () => {
    const li = (n: number, value: (i: number) => number) =>
      baseline({ platform: 'linkedin', basis: 'count', postId: 'self', publishedAt: formatISO(POST_AT), prior: prior(n, value, 'count'), seed: null })
    expect(li(7, () => 10)).toBeNull()
    expect(li(8, () => 10)).toEqual({ baseline: 10, baselineN: 8, source: 'own' })
    // 25 outcomes, newest 20 are value 10 (i < 20), the 5 oldest are 1000: the window must ignore the old ones.
    expect(li(25, (i) => (i < 20 ? 10 : 1000))).toEqual({ baseline: 10, baselineN: 20, source: 'own' })
  })

  it('only outcomes of the SAME basis are comparable', () => {
    expect(x({ prior: prior(8, () => 0.05, 'count') })).toBeNull()
  })

  it('SEED: X below 8 own outcomes uses the imported baseline ONLY when its basis is rate (OUTCOME-SEED-BASIS-MATCH)', () => {
    expect(x({ prior: prior(7, () => 0.05), seed: { value: 0.03, basis: 'rate' } })).toEqual({ baseline: 0.03, baselineN: null, source: 'import_seed' })
  })

  it('SEED: a COUNT-basis seed is REFUSED for a rate-basis post — enforced here, never assumed', () => {
    expect(x({ prior: prior(7, () => 0.05), seed: { value: 30, basis: 'count' } })).toBeNull()
  })

  it('SEED: never used on LinkedIn, and never preferred over 8 own outcomes; a non-positive seed is refused', () => {
    expect(baseline({ platform: 'linkedin', basis: 'count', postId: 's', publishedAt: formatISO(POST_AT), prior: prior(7, () => 10, 'count'), seed: { value: 5, basis: 'rate' } })).toBeNull()
    expect(x({ prior: prior(8, () => 0.05), seed: { value: 0.99, basis: 'rate' } })).toMatchObject({ source: 'own', baseline: 0.05 })
    expect(x({ prior: [], seed: { value: 0, basis: 'rate' } })).toBeNull()
    expect(x({ prior: [], seed: { value: Number.NaN, basis: 'rate' } })).toBeNull()
  })

  it('a non-finite timestamp throws rather than silently scoring zero', () => {
    expect(() => x({ publishedAt: 'not a date' })).toThrow(/non-finite/)
  })
})

describe('median', () => {
  it('odd and even', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
  })
})

describe('liftAgainst', () => {
  it('log_lift = ln(value / baseline) for a rate, and beat_baseline = value > baseline', () => {
    const r = liftAgainst(0.06, 0.03, 'rate')
    expect(r.beat).toBe(true)
    expect(r.logLift).toBeCloseTo(Math.log(2), 10)
    expect(liftAgainst(0.03, 0.03, 'rate').beat).toBe(false) // strictly greater
  })

  it('is CLIPPED to [-3, 3] at both ends', () => {
    expect(liftAgainst(1000, 1, 'count').logLift).toBe(3)
    expect(liftAgainst(0, 5, 'count').logLift).toBe(-3) // ln(0) = -Infinity -> -3
    expect(liftAgainst(0.0001, 0.5, 'rate').logLift).toBe(-3)
  })

  it('the COUNT baseline is floored at 1 for the log only; beat compares the RAW baseline', () => {
    const r = liftAgainst(3, 0.2, 'count')
    expect(r.logLift).toBeCloseTo(Math.log(3), 10) // ln(3 / max(0.2, 1)), NOT ln(15)
    expect(r.beat).toBe(true)
  })

  it('a rate baseline of 0 leaves the log undefined (null) while the win/loss is still defined', () => {
    expect(liftAgainst(0.02, 0, 'rate')).toEqual({ logLift: null, beat: true })
  })
})

describe('normaliseOutcome', () => {
  const run = (over: Record<string, unknown> = {}) =>
    normaliseOutcome({
      platform: 'twitter', metrics: { likes: 4, comments: 2, shares: 2, impressions: 100 }, postId: 'self',
      publishedAt: formatISO(POST_AT), prior: prior(8, () => 0.05), seed: null, ...over,
    })

  it('measures a post against its own baseline', () => {
    const r = run()
    expect(r).toMatchObject({ kind: 'measured', basis: 'rate', value: 0.08, baseline: 0.05, baselineN: 8, baselineSource: 'own', beatBaseline: true })
    expect((r as { logLift: number }).logLift).toBeCloseTo(Math.log(0.08 / 0.05), 10)
  })

  it('with no baseline the row STILL records the measurement, with baseline / log_lift / beat_baseline all NULL', () => {
    expect(run({ prior: [] })).toEqual({
      kind: 'measured', basis: 'rate', value: 0.08, baseline: null, baselineN: null, baselineSource: null, logLift: null, beatBaseline: null,
    })
  })

  it('an ineligible post is EXCLUDED with the typed reason and never reaches the baseline', () => {
    expect(run({ metrics: { likes: 4, comments: 2, shares: null, impressions: 100 } })).toEqual({
      kind: 'excluded', reason: { ok: false, reason: 'null_field', field: 'shares' },
    })
  })

  it('records an import seed as such', () => {
    expect(run({ prior: prior(3, () => 0.05), seed: { value: 0.04, basis: 'rate' } })).toMatchObject({ baseline: 0.04, baselineSource: 'import_seed', baselineN: null })
  })
})
