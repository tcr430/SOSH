import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// K2.12 — the strings behind the brief -> generate flow exist, non-empty, in en, pt AND es at once (CLAUDE.md: "add keys to
// all three locale files simultaneously"). Covers what PrepareBriefButton, CampaignDetailActions, GeneratePostsButton and
// BriefReviewForm request by key, including every error key those components can select.

const LOCALES = ['en', 'pt', 'es'] as const

function load(locale: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'i18n', locale, 'common.json'), 'utf8')) as Record<string, unknown>
}

function get(obj: Record<string, unknown>, dotted: string): unknown {
  return dotted.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj)
}

const DETAIL = 'campaigns.detail'
const REQUIRED_KEYS = [
  `${DETAIL}.prepare_brief.title`,
  `${DETAIL}.prepare_brief.body`,
  `${DETAIL}.prepare_brief.cta`,
  `${DETAIL}.prepare_brief.starting`,
  `${DETAIL}.prepare_brief.try_again`,
  // PrepareBriefButton selects error.<forbidden|failed> and falls back to error.generic.
  `${DETAIL}.prepare_brief.error.forbidden`,
  `${DETAIL}.prepare_brief.error.failed`,
  `${DETAIL}.prepare_brief.error.generic`,
  `${DETAIL}.review_brief.title`,
  `${DETAIL}.review_brief.body`,
  `${DETAIL}.review_brief.cta`,
  // GeneratePostsButton maps startGenerationAction's error codes to error.<code>.
  `${DETAIL}.generate.error.brief_not_approved`,
  `${DETAIL}.generate.error.invalid_campaign_state`,
  'campaigns.brief.continue_to_generate',
]

describe('brief -> generate flow strings (K2.12)', () => {
  it.each(LOCALES)('%s carries every key, as a non-empty string', (locale) => {
    const json = load(locale)
    for (const key of REQUIRED_KEYS) {
      const value = get(json, key)
      expect(typeof value, `${locale}: ${key}`).toBe('string')
      expect((value as string).trim().length, `${locale}: ${key} is empty`).toBeGreaterThan(0)
    }
  })

  it('the new strings are translated, not copied: pt and es differ from en for every new key', () => {
    const en = load('en')
    for (const locale of ['pt', 'es'] as const) {
      const json = load(locale)
      for (const key of REQUIRED_KEYS) {
        expect(get(json, key), `${locale}: ${key} still equals the English string`).not.toBe(get(en, key))
      }
    }
  })

  it("no locale still tells the customer generation needs a 'draft' campaign (that state can no longer generate)", () => {
    const stale = { en: /draft status/i, pt: /estado de rascunho/i, es: /estado de borrador/i } as const
    for (const locale of LOCALES) {
      expect(get(load(locale), `${DETAIL}.generate.error.invalid_campaign_state`) as string).not.toMatch(stale[locale])
    }
  })
})
