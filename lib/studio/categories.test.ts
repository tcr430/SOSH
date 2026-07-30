import { describe, it, expect } from 'vitest'
import { RubricOutputSchema } from '@/lib/ai/prompts/rubric'
import { StudioSpanCategorySchema } from './categories'

// ADR 0019 §7.1/§7.2 — the category enum equals RubricOutputSchema's ten
// dimension keys minus EXACTLY two (redundancy, platformNativeness), and is
// DERIVED (RubricOutputSchema.shape.dimensions.keyof().exclude([...])), not
// duplicated as a hand-maintained literal list. A compile-only guarantee
// only catches subtractive drift (a renamed/removed excluded key fails to
// compile) — it does NOT catch a NEW dimension silently becoming a valid
// span category with zero signal, since .keyof() auto-includes every
// present key. This test closes that gap by asserting the exact expected
// set, not just "it compiles."

describe('StudioSpanCategorySchema — derived from RubricOutputSchema, not duplicated', () => {
  it('equals the rubric\'s ten dimension keys minus exactly two', () => {
    const allTenKeys = Object.keys(RubricOutputSchema.shape.dimensions.shape)
    expect(allTenKeys).toHaveLength(10)

    const spanCategories: string[] = [...StudioSpanCategorySchema.options]
    expect(spanCategories).toHaveLength(8)

    const excluded = allTenKeys.filter((k) => !spanCategories.includes(k))
    expect(excluded.sort()).toEqual(['platformNativeness', 'redundancy'])
  })

  it('matches the exact expected 8-key set (catches additive drift a compile-only check would miss)', () => {
    expect([...StudioSpanCategorySchema.options].sort()).toEqual(
      [
        'specificity',
        'originality',
        'evidenceSufficiency',
        'audienceRelevance',
        'brandVoiceAlignment',
        'openingStrength',
        'ctaFit',
        'unsupportedClaimsRisk',
      ].sort(),
    )
  })

  it('excludes redundancy and platformNativeness specifically — properties of a whole draft, not a span (§7.2)', () => {
    expect(StudioSpanCategorySchema.options).not.toContain('redundancy')
    expect(StudioSpanCategorySchema.options).not.toContain('platformNativeness')
  })
})
