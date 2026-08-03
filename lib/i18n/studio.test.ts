import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import en from '../../i18n/en/studio.json'
import pt from '../../i18n/pt/studio.json'
import es from '../../i18n/es/studio.json'

// ADR 0019 §3.4 — the studio namespace, added simultaneously in en/pt/es
// plus registered in i18n/request.ts. A namespace that exists as JSON but
// is never registered silently resolves to nothing, so this test checks
// BOTH: every locale resolves every required key (no missing-key
// fallthrough), AND request.ts actually imports+registers the namespace.
//
// Lives under lib/ rather than i18n/ deliberately: vitest.config.ts's
// `include` covers app/**, lib/**, components/**, supabase/__tests__/** —
// NOT i18n/**, so a test placed there would never execute at all (a
// silent no-op, exactly the FALSE-GREEN shape ADR 0015 §2 exists to catch).

const REQUIRED_KEYS = [
  'picker.heading',
  'picker.subheading',
  'picker.mode1.title',
  'picker.mode1.description',
  'picker.mode2.title',
  'picker.mode2.description',
  'picker.mode3.title',
  'picker.mode3.description',
  'picker.mode3.unavailableLabel',
  'picker.mode3.badge',
  'editor.heading',
  'editor.platformLabel',
  'editor.platformPlaceholder',
  'editor.contentLabel',
  'editor.contentPlaceholder',
  'editor.suggestButton',
  'editor.regenerateButton',
  'editor.saveButton',
  'editor.saved',
  'editor.generating',
  'editor.zeroSuggestions',
  'editor.staleBanner',
  'editor.acceptedBanner',
  'editor.staleAcceptError',
  'editor.suggestDisabled.emptyDraft',
  'editor.suggestDisabled.noPlatform',
  'editor.error.generic',
  'editor.error.invalid_response',
  'editor.error.response_truncated',
  'editor.error.fabricated_citation',
  'editor.error.draft_too_long',
  'editor.error.missing_platform',
  'editor.error.not_eligible',
  'editor.error.invalid_input',
  'editor.error.quota_exceeded',
  'editor.error.rate_limited',
  'editor.error.provider_error',
  'editor.error.rate_limit',
  'editor.error.timeout',
  'editor.error.policy_violation',
  'editor.diff.originalLabel',
  'editor.diff.revisedLabel',
  'editor.suggestion.accept',
  'editor.suggestion.attributionMemory',
  'editor.suggestion.attributionModelJudgment',
  'editor.suggestion.modelJudgmentBadge',
  'editor.observations.heading',
  'editor.observations.redundancy',
  'editor.observations.platformNativeness',
  'editor.category.specificity',
  'editor.category.originality',
  'editor.category.evidenceSufficiency',
  'editor.category.audienceRelevance',
  'editor.category.brandVoiceAlignment',
  'editor.category.openingStrength',
  'editor.category.ctaFit',
  'editor.category.unsupportedClaimsRisk',
  'editor.citation.avoidWord',
  'editor.citation.performancePattern',
  'editor.citation.evidence',
]

function get(obj: unknown, keyPath: string): unknown {
  return keyPath.split('.').reduce<unknown>((acc, part) => {
    if (acc === undefined || acc === null || typeof acc !== 'object') return undefined
    return (acc as Record<string, unknown>)[part]
  }, obj)
}

const LOCALES: Record<string, unknown> = { en, pt, es }

describe('i18n studio namespace — en/pt/es resolve every key (ADR 0019 §3.4)', () => {
  it.each(Object.keys(LOCALES))('%s resolves every required key to a non-empty string', (locale) => {
    const messages = LOCALES[locale]
    for (const key of REQUIRED_KEYS) {
      const value = get(messages, key)
      expect(value, `${locale}: missing key "${key}"`).toBeTypeOf('string')
      expect((value as string).length, `${locale}: empty value for "${key}"`).toBeGreaterThan(0)
    }
  })

  it("mode3.unavailableLabel states a reason, not merely 'disabled', in every locale", () => {
    for (const locale of Object.keys(LOCALES)) {
      const label = get(LOCALES[locale], 'picker.mode3.unavailableLabel') as string
      expect(label.toLowerCase()).not.toBe('disabled')
      expect(label.length).toBeGreaterThan(10)
    }
  })
})

describe('i18n/request.ts registers the studio namespace (a JSON-only namespace silently resolves to nothing)', () => {
  it('imports studio.json inside the Promise.all AND assigns it to messages.studio', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'i18n', 'request.ts'), 'utf8')
    expect(source).toMatch(/import\(`\.\/\$\{locale\}\/studio\.json`\)/)
    expect(source).toMatch(/studio:\s*studio\.default/)
  })
})
