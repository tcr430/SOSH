import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import * as constants from '../constants'

// ADR 0026 rule 1 — "TRANSCRIBE, DO NOT RE-DERIVE". A constant re-typed from
// memory is the failure this test exists to catch, so it reads ADR 0026 §6.4's
// fenced block from the repo and compares every line to the export of the same
// name. The other sections have no machine-readable block, so their values are
// pinned here beside their section number.

const ADR = fs.readFileSync(path.join(process.cwd(), 'docs', 'decisions', '0026-outcome-loop.md'), 'utf8')

function adrBlockConstants(): Record<string, number> {
  const found: Record<string, number> = {}
  const re = /^(OUTCOME_[A-Z_]+)\s*=\s*([0-9]+(?:\.[0-9]+)?)\b/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(ADR)) !== null) found[m[1]] = Number(m[2])
  return found
}

describe('lib/outcomes/constants.ts — transcribed from ADR 0026 (rule 1)', () => {
  const block = adrBlockConstants()

  it('found the whole §6.4 block (12 constants) — a moved or reformatted block must not pass vacuously', () => {
    expect(Object.keys(block).sort()).toEqual(
      [
        'OUTCOME_CAP',
        'OUTCOME_CONFIDENCE_SHRINK_K',
        'OUTCOME_FAST_CONTRA_LAST',
        'OUTCOME_FAST_CONTRA_MIN',
        'OUTCOME_MATURITY_DAYS',
        'OUTCOME_MATURITY_GRACE_DAYS',
        'OUTCOME_MIN_DISTINCT_CAMPAIGNS',
        'OUTCOME_MIN_N',
        'OUTCOME_PATTERN_TTL_DAYS',
        'OUTCOME_PROVISIONAL_N',
        'OUTCOME_WILSON_Z',
        'OUTCOME_WINDOW_DAYS',
      ].sort(),
    )
  })

  it.each(Object.entries(adrBlockConstants()))('%s equals the ADR §6.4 value (%s)', (name, value) => {
    expect((constants as Record<string, unknown>)[name]).toBe(value)
  })

  it('the §6.4 values, spelled out (a second, independent pin)', () => {
    expect(constants.OUTCOME_MIN_N).toBe(10)
    expect(constants.OUTCOME_MIN_DISTINCT_CAMPAIGNS).toBe(3)
    expect(constants.OUTCOME_WILSON_Z).toBe(1.96)
    expect(constants.OUTCOME_PROVISIONAL_N).toBe(5)
    expect(constants.OUTCOME_CONFIDENCE_SHRINK_K).toBe(10)
    expect(constants.OUTCOME_WINDOW_DAYS).toBe(180)
    expect(constants.OUTCOME_PATTERN_TTL_DAYS).toBe(90)
    expect(constants.OUTCOME_FAST_CONTRA_LAST).toBe(5)
    expect(constants.OUTCOME_FAST_CONTRA_MIN).toBe(4)
    expect(constants.OUTCOME_CAP).toBe(3)
    expect(constants.OUTCOME_MATURITY_DAYS).toBe(7)
    expect(constants.OUTCOME_MATURITY_GRACE_DAYS).toBe(2)
  })

  it('§4.2 / §6.3 / §8.2 / §8.4 values', () => {
    expect(constants.OUTCOME_TAXONOMY_VERSION).toBe(1) // §4.2
    expect(constants.OUTCOME_BASELINE_MIN).toBe(8) // §6.3
    expect(constants.OUTCOME_X_BASELINE_DAYS).toBe(90) // §6.3
    expect(constants.OUTCOME_LINKEDIN_BASELINE_LAST).toBe(20) // §6.3
    expect(constants.OUTCOME_LOG_LIFT_CLIP).toBe(3) // §6.3
    expect(constants.OUTCOME_LOG_LIFT_COUNT_FLOOR).toBe(1) // §6.3
    expect(constants.OUTCOME_RETRO_MIN_N).toBe(5) // §8.2
    expect(constants.OUTCOME_HYPOTHESIS_TTL_DAYS).toBe(365) // §8.4
  })

  it('§4.4 length bands', () => {
    expect(constants.OUTCOME_LENGTH_BANDS).toEqual({
      twitter_single: { unit: 'chars', shortBelow: 100, longAbove: 220 },
      twitter_thread: { unit: 'segments', shortBelow: 4, longAbove: 6 },
      linkedin: { unit: 'chars', shortBelow: 600, longAbove: 1300 },
    })
  })

  it('§4.1: five promotable dimensions, two descriptive-only, and the two sets never overlap', () => {
    expect([...constants.OUTCOME_PROMOTABLE_DIMENSIONS]).toEqual(['role', 'format', 'length_band', 'cta_present', 'origin_mode'])
    expect([...constants.OUTCOME_DESCRIPTIVE_ONLY_DIMENSIONS]).toEqual(['hook_type', 'proof_type'])
    const overlap = constants.OUTCOME_PROMOTABLE_DIMENSIONS.filter((d) =>
      (constants.OUTCOME_DESCRIPTIVE_ONLY_DIMENSIONS as readonly string[]).includes(d),
    )
    expect(overlap).toEqual([])
  })

  // Deliberately NO Wilson arithmetic here. "9 of 10 promotes, 8 of 10 does not"
  // is a property of the SQL gate (public.wilson_bounds, ADR 0026 §5.4) and is
  // proven against the real function in J2.5/J2.6 — a TS re-implementation of
  // the formula is not accepted as proof of it (build-guide rule 2).
})
