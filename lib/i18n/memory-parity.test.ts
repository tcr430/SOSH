import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import enMemory from '@/i18n/en/memory.json'
import ptMemory from '@/i18n/pt/memory.json'
import esMemory from '@/i18n/es/memory.json'
import enOpp from '@/i18n/en/opportunities.json'
import ptOpp from '@/i18n/pt/opportunities.json'
import esOpp from '@/i18n/es/opportunities.json'
import enInterview from '@/i18n/en/interview.json'
import ptInterview from '@/i18n/pt/interview.json'
import esInterview from '@/i18n/es/interview.json'

// ADR 0030 §9 (Session 36 L2.10) — SUBSTRATE-I18N-COMPLETE (constraint 27). The new `memory` namespace (six provenance labels) and the two added
// keys (opportunities.dismissReason.teachesHint, the interview Replace hint) exist in en, pt AND es SIMULTANEOUSLY, and the namespace is REGISTERED
// (an unregistered namespace renders the raw key in production while every unit test, which mocks next-intl, stays green). Lives under lib/i18n/ so
// vitest's include glob executes it (ADR 0015).

function flatten(obj: unknown, prefix = ''): Record<string, string> {
  if (typeof obj === 'string') return { [prefix]: obj }
  if (typeof obj !== 'object' || obj === null) return {}
  return Object.assign({}, ...Object.entries(obj).map(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k)))
}

const MEMORY = { en: flatten(enMemory), pt: flatten(ptMemory), es: flatten(esMemory) } as const
const OPP = { en: flatten(enOpp), pt: flatten(ptOpp), es: flatten(esOpp) } as const
const INTERVIEW = { en: flatten(enInterview), pt: flatten(ptInterview), es: flatten(esInterview) } as const
const SOURCES = ['manual', 'distilled', 'import', 'interview', 'outcome', 'dismissal'] as const
const LOCALES = ['en', 'pt', 'es'] as const

describe('memory namespace i18n (ADR 0030 §9.2)', () => {
  it('pt and es have EXACTLY the same key set as en', () => {
    expect(Object.keys(MEMORY.pt).sort()).toEqual(Object.keys(MEMORY.en).sort())
    expect(Object.keys(MEMORY.es).sort()).toEqual(Object.keys(MEMORY.en).sort())
  })

  it('the namespace holds exactly the six provenance labels and nothing else (no copy beyond §9.2)', () => {
    for (const locale of LOCALES) {
      expect(Object.keys(MEMORY[locale]).sort(), locale).toEqual(SOURCES.map((s) => `provenance.${s}`).sort())
    }
  })

  it('every label is non-empty in every locale', () => {
    for (const locale of LOCALES) for (const source of SOURCES) expect(MEMORY[locale][`provenance.${source}`]?.trim().length, `${locale}: ${source}`).toBeGreaterThan(3)
  })

  it('the EN strings are exactly the six of §9.2', () => {
    expect(MEMORY.en).toEqual({
      'provenance.manual': 'Added by you',
      'provenance.distilled': 'Learned from your edits',
      'provenance.import': 'From your posts',
      'provenance.interview': 'From your interview',
      'provenance.outcome': 'From your results',
      'provenance.dismissal': 'From dismissed ideas',
    })
  })

  it('no two labels are identical within a locale (a reader can tell the sources apart)', () => {
    for (const locale of LOCALES) expect(new Set(Object.values(MEMORY[locale])).size, locale).toBe(SOURCES.length)
  })

  it('is registered in i18n/request.ts: imported per locale AND passed into messages', () => {
    const src = readFileSync(join(process.cwd(), 'i18n', 'request.ts'), 'utf8')
    expect(src).toMatch(/import\(`\.\/\$\{locale\}\/memory\.json`\)/)
    expect(src).toMatch(/memory:\s*memory\.default/)
  })
})

describe('the two added keys (ADR 0030 §9.1, §9.3)', () => {
  it('opportunities.dismissReason.teachesHint exists in en, pt AND es, and en is the §9.1 sentence', () => {
    for (const locale of LOCALES) expect(OPP[locale]['dismissReason.teachesHint']?.trim().length, locale).toBeGreaterThan(10)
    expect(OPP.en['dismissReason.teachesHint']).toBe("If you keep marking updates from this source as not relevant, Jemip will learn your audience isn't interested in them.")
  })

  it('opportunities keeps the SAME key set in pt and es as en (the added key did not desynchronise the namespace)', () => {
    expect(Object.keys(OPP.pt).sort()).toEqual(Object.keys(OPP.en).sort())
    expect(Object.keys(OPP.es).sort()).toEqual(Object.keys(OPP.en).sort())
  })

  it('interview ui.ratify.cannotReplace exists in en, pt AND es, and en is the §9.3 sentence', () => {
    for (const locale of LOCALES) expect(INTERVIEW[locale]['ui.ratify.cannotReplace']?.trim().length, locale).toBeGreaterThan(10)
    expect(INTERVIEW.en['ui.ratify.cannotReplace']).toBe("This wasn't added by an interview or an import, so it can't be replaced here.")
  })

  it('the Replace hint names no specific source in any locale (it must stay true for any future non-replaceable writer)', () => {
    // §9.3: "The copy names no specific source". The only sources it may mention are the two that CAN be replaced.
    for (const locale of LOCALES) {
      const text = INTERVIEW[locale]['ui.ratify.cannotReplace'].toLowerCase()
      expect(text, locale).not.toMatch(/manual|dismiss|descart|distil|outcome|resultado/)
    }
  })

  it('interview keeps the SAME key set in pt and es as en', () => {
    expect(Object.keys(INTERVIEW.pt).sort()).toEqual(Object.keys(INTERVIEW.en).sort())
    expect(Object.keys(INTERVIEW.es).sort()).toEqual(Object.keys(INTERVIEW.en).sort())
  })
})
