import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { neutralize } from '@/lib/ai/wrap-evidence'
import {
  guardStudioField,
  StudioGuardError,
  STUDIO_FIELD_MAX_CHARS,
  STUDIO_SUGGEST_MAX_TOKENS,
  STUDIO_RATIONALE_BUDGET_TOKENS,
} from './guard'

// ADR 0019 §5.5 [sec-HIGH-1] — the draft guard's exact order of operations,
// the NFKC-expansion raw pre-check, the variation-selector gap today's
// neutralize() misses, the re-strip pass, and the final assert-and-throw.
// Existing lib/ai/wrap-evidence.test.ts is NOT touched by this file or by
// D2.4's implementation — neutralize() itself is unchanged. A-6 (Session
// 26-D) deleted step 6's truncateToCap — an over-cap field is now REFUSED
// (StudioGuardError), never silently sliced.

const SENTINEL_OPEN = '\u{F0000}'
const SENTINEL_CLOSE = '\u{F0001}'
const SENTINEL_PATTERN = /[\u{F0000}\u{F0001}]/gu

describe('guard.ts — the derived cap (§5.4)', () => {
  it('is derived from the formula, not a picked number', () => {
    expect(STUDIO_FIELD_MAX_CHARS).toBe(
      Math.floor((STUDIO_SUGGEST_MAX_TOKENS - STUDIO_RATIONALE_BUDGET_TOKENS) / 3),
    )
  })
})

describe('guardStudioField — order of operations (ADR §5.5)', () => {
  it('step 1 (raw pre-check) rejects input over the raw ceiling regardless of what it would normalize to', () => {
    // A raw string that vastly exceeds the raw ceiling even though every
    // character is a plain ASCII letter that would normalize to itself
    // (i.e. would NOT be caught by any later step) — proves the raw check
    // is a real gate on raw length, not a proxy for something else.
    const huge = 'a'.repeat(STUDIO_FIELD_MAX_CHARS * 25 + 1)
    expect(() => guardStudioField(huge)).toThrow(StudioGuardError)
  })

  it('step 1 does not reject a raw string within the ceiling, even if NFKC would expand it past the FINAL cap (expansion is handled later, not by rejecting)', () => {
    // U+FDFA is 1 raw character but normalizes to 18 (ADR §5.5 step 1's own
    // cited example) — well under the raw ceiling, so it must be accepted
    // at step 1 and handled by truncation later, not rejected outright.
    const smallRaw = '\u{FDFA}'.repeat(100) // 100 raw chars, well under ceiling
    expect(() => guardStudioField(smallRaw)).not.toThrow()
  })

  it('step 2 (NFKC normalize) runs before step 6 (cap check): the cap applies to the EXPANDED length, so a raw string within the raw ceiling that normalizes past the cap is REFUSED (A-6 — never silently truncated)', () => {
    const smallRaw = '\u{FDFA}'.repeat(STUDIO_FIELD_MAX_CHARS) // raw length == cap, but normalizes far larger
    expect(() => guardStudioField(smallRaw)).toThrow(StudioGuardError)
  })

  it('over-cap input throws; at-cap (post-normalization) input is accepted unmodified', () => {
    const atCap = 'x'.repeat(STUDIO_FIELD_MAX_CHARS)
    expect(guardStudioField(atCap)).toBe(atCap)

    const overCap = 'x'.repeat(STUDIO_FIELD_MAX_CHARS + 1)
    expect(() => guardStudioField(overCap)).toThrow(StudioGuardError)
  })

  it('steps 3-5 (strip) run before step 6 (cap check): invisible/private-use characters do not consume the visible-content budget', () => {
    // A draft padded with thousands of zero-width format characters (\p{Cf})
    // ahead of a short, entirely visible sentence. If strip ran AFTER
    // truncate, the invisible padding would eat the whole cap and the
    // visible sentence would be cut off or lost entirely.
    const zwsp = '​' // ZERO WIDTH SPACE, category Cf
    const padding = zwsp.repeat(STUDIO_FIELD_MAX_CHARS * 2)
    const visibleSentence = 'This is the only visible content in the draft.'
    const result = guardStudioField(padding + visibleSentence)
    expect(result).toBe(visibleSentence)
  })
})

describe('guardStudioField — the variation-selector class today\'s neutralize() misses ([sec-HIGH-1])', () => {
  it('neutralize() (existing, unchanged) does NOT strip a variation selector', () => {
    const withVariationSelector = 'plain text' + '\u{FE0F}' + 'more text'
    expect(neutralize(withVariationSelector)).toContain('\u{FE0F}')
  })

  it('guardStudioField DOES strip a variation selector in the U+FE00-FE0F block', () => {
    const withVariationSelector = 'plain text' + '\u{FE0F}' + 'more text'
    const result = guardStudioField(withVariationSelector)
    expect(result).not.toContain('\u{FE0F}')
    expect(result).toBe('plain textmore text')
  })

  it('guardStudioField strips a variation selector from the supplement plane (U+E0100-E01EF) inside a marker-shaped token', () => {
    // The exact failure mode named: an invisible variation selector inside
    // a marker token defeats an exact-match regex, because the token no
    // longer byte-matches the strict marker pattern D2.5's parser expects.
    const markerLike = SENTINEL_OPEN + 'abcd1234:s1' + '\u{E0100}' + SENTINEL_CLOSE
    const result = guardStudioField(markerLike)
    expect(result).not.toMatch(/[\u{E0100}-\u{E01EF}]/u)
  })

  it('guardStudioField strips \\p{Co}, \\p{Cs}, and \\p{Cf} together with the variation-selector class in one pass', () => {
    const mixed = 'a' + SENTINEL_OPEN + 'b' + '​' + 'c' + '\u{FE0F}' + 'd'
    const result = guardStudioField(mixed)
    expect(result).toBe('abcd')
  })
})

describe('guardStudioField — the single re-strip pass (ADR §5.5 step 7)', () => {
  // A-6 (Session 26-D) deleted truncateToCap — step 6 now throws on an
  // over-cap field instead of slicing it, so the astral-surrogate-cut-by-
  // truncation shape this describe block used to guard against can no
  // longer occur (there is no truncation boundary left to cut a surrogate
  // pair in half). Step 7's re-run is kept regardless — see guard.ts's step
  // 7 comment — and its idempotency is still a real property worth pinning.
  it('re-running the strip+remaining-passes step is idempotent (running it twice equals running it once)', () => {
    const once = guardStudioField('a' + SENTINEL_OPEN + 'b')
    const runAgainOnOutput = guardStudioField(once)
    expect(runAgainOnOutput).toBe(once)
  })
})

describe('guardStudioField — assert zero sentinels, never loop-strip ([sec-HIGH-4])', () => {
  it('the invariant the assertion protects: no adversarial combination of sentinels, nonces, and truncation-boundary placement leaves a live sentinel in the output', () => {
    const fixtures = [
      SENTINEL_OPEN + 'ab12cd34:s1' + SENTINEL_CLOSE,
      SENTINEL_OPEN + SENTINEL_OPEN + '/ab12cd34:s1' + SENTINEL_CLOSE,
      'text before ' + SENTINEL_CLOSE + 'ab12cd34:s1' + SENTINEL_OPEN + ' text after',
      SENTINEL_OPEN.repeat(50) + 'padding' + SENTINEL_CLOSE.repeat(50),
      // Stripped length (sentinels vanish, only the x/y padding remains)
      // must stay within the cap — A-6 refuses over-cap input outright
      // rather than truncating, so this fixture stays comfortably under it.
      'x'.repeat(STUDIO_FIELD_MAX_CHARS - 202) + SENTINEL_OPEN + SENTINEL_CLOSE + 'y'.repeat(200),
    ]
    for (const fixture of fixtures) {
      const result = guardStudioField(fixture)
      SENTINEL_PATTERN.lastIndex = 0
      expect(SENTINEL_PATTERN.test(result)).toBe(false)
    }
  })

  it('StudioGuardError carries no sentinel/marker detail in its message (nothing sensitive to leak)', () => {
    const huge = 'a'.repeat(STUDIO_FIELD_MAX_CHARS * 25 + 1)
    try {
      guardStudioField(huge)
      expect.unreachable('expected guardStudioField to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(StudioGuardError)
      const message = (err as StudioGuardError).message
      expect(message).not.toContain(SENTINEL_OPEN)
      expect(message).not.toContain(SENTINEL_CLOSE)
    }
  })
})

describe('lib/studio/** uses the shared implementation — no sixth local sanitizeDataField', () => {
  it('no file under lib/studio/** defines its own sanitizeDataField', () => {
    const root = path.join(__dirname)
    const entries = fs.readdirSync(root, { withFileTypes: true })
    const files = entries
      .filter((e) => e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.test.ts'))
      .map((e) => path.join(root, e.name))
    // Guards the scan itself against a false-green (ADR 0015's FALSE-GREEN
    // shape) — matches the vacuity-guard pattern of
    // lib/learning/memory-table-boundary.test.ts:45.
    expect(files.length).toBeGreaterThan(0)

    const offenders: string[] = []
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8')
      if (/function\s+sanitizeDataField/.test(source)) {
        offenders.push(path.relative(process.cwd(), file))
      }
    }
    expect(offenders).toEqual([])
  })

  it('guard.ts imports neutralizeWithSentinels from the shared wrap-evidence module', () => {
    const source = fs.readFileSync(path.join(__dirname, 'guard.ts'), 'utf8')
    expect(source).toMatch(/import\s*\{\s*neutralizeWithSentinels\s*\}\s*from\s*['"]@\/lib\/ai\/wrap-evidence['"]/)
  })
})
