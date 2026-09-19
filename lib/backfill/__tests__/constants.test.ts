import { describe, it, expect } from 'vitest'
import * as constants from '../constants'

// ADR 0025 §2.3/§4/§6/§8.3/§9.1 (Session 32 I2.1, binding rule 1: transcribe,
// never re-derive). Every bound in lib/backfill/constants.ts is pinned here
// to an exact value — a later "tweak" (someone rounding 24 months to 2
// years, or nudging a cap because a single account looked thin) reddens
// this test instead of silently drifting from the ADR's own numbers.
describe('lib/backfill/constants.ts — frozen values (ADR 0025)', () => {
  it('pins every exported constant to its ADR-cited value', () => {
    expect(constants.BACKFILL_MAX_POSTS).toBe(200)
    expect(constants.BACKFILL_LOOKBACK_MONTHS).toBe(24)
    expect(constants.BACKFILL_MAX_PAGES).toBe(5)
    expect(constants.BACKFILL_MAX_PLATFORM_READS).toBe(500)
    expect(constants.BACKFILL_RUN_CEILING_CENTS).toBe(50)
    expect(constants.BACKFILL_DAILY_CENTS).toBe(150)
    expect(constants.BACKFILL_WEIGHTED_SUBSET).toBe(30)
    expect(constants.BACKFILL_VOICE_INPUT_POSTS).toBe(20)
    expect(constants.BACKFILL_EVIDENCE_BATCH).toBe(20)
    expect(constants.BACKFILL_EXTRACTION_TRUNCATE_CHARS).toBe(1000)
    expect(constants.BACKFILL_VOICE_EXAMPLES).toBe(3)
    expect(constants.BACKFILL_VOICE_EXAMPLE_MAX_CHARS).toBe(1000)
    expect(constants.BACKFILL_PERFORMANCE_CAP).toBe(15)
    expect(constants.BACKFILL_PATTERN_MIN_N).toBe(5)
    expect(constants.BACKFILL_PATTERN_MIN_LIFT).toBe(1.25)
    expect(constants.BACKFILL_CONFIDENCE_CEILING).toBe(0.6)
    expect(constants.BACKFILL_AUDIENCE_CAP).toBe(25)
    expect(constants.BACKFILL_AUDIENCE_CONFIDENCE).toBe(0.3)
    expect(constants.BACKFILL_AUDIENCE_MIN_BACKING).toBe(2)
    expect(constants.BACKFILL_EVIDENCE_CAP).toBe(40)
    expect(constants.BACKFILL_EVIDENCE_CONFIDENCE).toBe(0.5)
    expect(constants.BACKFILL_EVIDENCE_MAX_CHARS).toBe(500)
    expect(constants.BACKFILL_EXPIRY_MONTHS).toBe(12)
    expect(constants.BACKFILL_MAX_RUNS_PER_ACCOUNT).toBe(3)
    expect(constants.BACKFILL_LATENCY_TARGET_MINUTES).toBe(10)
    expect(constants.BACKFILL_STALL_MINUTES).toBe(30)
    expect(constants.BACKFILL_STAGING_TTL_DAYS).toBe(30)
  })

  // Guards against a constant being added to the module without being added
  // to the pin above (or vice versa) — an unpinned export is exactly the
  // silent-drift gap this test exists to close.
  it('exports exactly the 27 pinned constant names, no more, no fewer', () => {
    const exported = Object.keys(constants).sort()
    const pinned = [
      'BACKFILL_AUDIENCE_CAP',
      'BACKFILL_AUDIENCE_CONFIDENCE',
      'BACKFILL_AUDIENCE_MIN_BACKING',
      'BACKFILL_CONFIDENCE_CEILING',
      'BACKFILL_DAILY_CENTS',
      'BACKFILL_EVIDENCE_BATCH',
      'BACKFILL_EVIDENCE_CAP',
      'BACKFILL_EVIDENCE_CONFIDENCE',
      'BACKFILL_EVIDENCE_MAX_CHARS',
      'BACKFILL_EXPIRY_MONTHS',
      'BACKFILL_EXTRACTION_TRUNCATE_CHARS',
      'BACKFILL_LATENCY_TARGET_MINUTES',
      'BACKFILL_LOOKBACK_MONTHS',
      'BACKFILL_MAX_PAGES',
      'BACKFILL_MAX_PLATFORM_READS',
      'BACKFILL_MAX_POSTS',
      'BACKFILL_MAX_RUNS_PER_ACCOUNT',
      'BACKFILL_PATTERN_MIN_LIFT',
      'BACKFILL_PATTERN_MIN_N',
      'BACKFILL_PERFORMANCE_CAP',
      'BACKFILL_RUN_CEILING_CENTS',
      'BACKFILL_STAGING_TTL_DAYS',
      'BACKFILL_STALL_MINUTES',
      'BACKFILL_VOICE_EXAMPLES',
      'BACKFILL_VOICE_EXAMPLE_MAX_CHARS',
      'BACKFILL_VOICE_INPUT_POSTS',
      'BACKFILL_WEIGHTED_SUBSET',
    ].sort()
    expect(exported).toEqual(pinned)
  })
})
