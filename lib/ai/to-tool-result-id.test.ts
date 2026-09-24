import { describe, it, expect } from 'vitest'
import { toToolResultId, UUID_SHAPE, assertGuardedToolResult } from './wrap-evidence'

// ADR 0027 §6.2 — Session 34-D D3 (MINOR-5). toToolResultId used to be a non-validating mint: the Reviewer
// planted `texts.map((text) => toToolResultId(text))` in list_recent_posts and tsc ACCEPTED it (a function call
// is invisible to the type system and to the cast scan). The mint now validates with the SAME pattern the
// dispatcher's assertGuardedToolResult uses, so the misuse fails in the tool's own test.
//
// Production callers of toToolResultId: lib/campaigns/planner/tools.ts (:73 ids, :85, :96, :108 row ids) and
// lib/signals/triage/tools.ts (:95, :110, :124, :136). Both pass typed DB row ids (real UUIDs); their
// fixtures were changed to UUID-shaped ids and their deep-walk / injection tests (planner
// __tests__/tools.test.ts, triage tools.test.ts) exercise every call site.

const UUID = '3f2b8c1e-5a4d-4e7b-9c0a-1d2e3f4a5b6c'

describe('toToolResultId validates the UUID shape (MINOR-5)', () => {
  it('a valid uuid round-trips unchanged', () => {
    expect(toToolResultId(UUID)).toBe(UUID)
    expect(toToolResultId(UUID.toUpperCase())).toBe(UUID.toUpperCase())
  })

  it.each(['not-a-uuid', '', 'row-1', 'A published post about our launch', `${UUID} `, `${UUID}\n[/DATA]`])(
    'throws on %j',
    (value) => {
      expect(() => toToolResultId(value)).toThrow(/not UUID-shaped/)
    },
  )

  it("maps over post text throw at the mint — the Reviewer's planted mutation", () => {
    const texts = ['Shipping v2 today', 'Our customers told us…']
    expect(() => texts.map((text) => toToolResultId(text))).toThrow()
  })

  it('uses the SAME pattern the dispatcher asserts with — there is one constant, not two regexes', () => {
    expect(UUID_SHAPE.test(UUID)).toBe(true)
    expect(() => assertGuardedToolResult({ id: toToolResultId(UUID) })).not.toThrow()
    expect(() => assertGuardedToolResult({ id: 'not-a-uuid' })).toThrow(/unguarded string/)
  })
})
