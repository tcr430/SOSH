import { describe, it, expect } from 'vitest'
import en from '@/i18n/en/outcome.json'
import pt from '@/i18n/pt/outcome.json'
import es from '@/i18n/es/outcome.json'
import { renderOutcomePattern } from '../template'
import { renderObservedOutcomes } from '@/lib/ai/prompts/observed-outcomes'

// ADR 0026 §10.3 (Session 33 J2.12) — OUTCOME-ATTRIBUTION-CONFIDENCE-FRAMED (27), Tier 2. The prohibited framing,
// named so it is testable: multipliers, causal verbs, a percentage or rate without its n, and superlatives applied
// to a pattern. Enforced over the outcome namespace of ALL THREE locale files AND the rendered template output.
// PROVEN TO REDDEN: the detector tests plant "2x more" and "leads to" (and their pt/es forms) below, and the
// build step also plants them in each locale file and shows this suite fail.

type Locale = 'en' | 'pt' | 'es'

const NUMERIC_MULTIPLIER = /\d+(\.\d+)?\s?[x×]/i
const WRITTEN_MULTIPLIER: Record<Locale, RegExp> = {
  en: /\b(twice as|double|doubled|doubling|triple|tripled|tripling)\b/i,
  pt: /\b(duas vezes|dobro|dobrou|dobrar|triplo|triplicou|triplicar)\b/i,
  es: /\b(dos veces|doble|dobló|duplicó|duplicar|triple|triplicó|triplicar)\b/i,
}
const CAUSAL: Record<Locale, RegExp> = {
  en: /\b(causes?|caused|drives?|driven|leads? to|results? in|because of|proven|proves?|guarantees?)\b/i,
  pt: /\b(causa|causam|provoca|provocam|leva a|levam a|resulta em|resultam em|por causa de|comprovad[oa]s?|garante|garantem)\b/i,
  es: /\b(causa|causan|provoca|provocan|lleva a|llevan a|resulta en|resultan en|debido a|por culpa de|comprobad[oa]s?|garantiza|garantizan)\b/i,
}
const SUPERLATIVE: Record<Locale, RegExp> = {
  en: /\b(best|top|top-performing|winning|highest|outperform\w*)\b/i,
  pt: /\b(melhor|melhores|vencedor\w*|topo|mais alto\w*)\b/i,
  es: /\b(mejor|mejores|ganador\w*|más alto\w*)\b/i,
}
const PERCENT = /%|\b(percent|per cent|por cento|por ciento)\b/i
const DASH = /[—–]/

export function findViolations(text: string, locale: Locale): string[] {
  const hits: string[] = []
  if (NUMERIC_MULTIPLIER.test(text)) hits.push('numeric multiplier')
  if (WRITTEN_MULTIPLIER[locale].test(text)) hits.push('written multiplier')
  if (CAUSAL[locale].test(text)) hits.push('causal verb')
  if (SUPERLATIVE[locale].test(text)) hits.push('superlative')
  // a percentage or rate without its n: a rate string must carry the {n} beside it
  if (PERCENT.test(text) && !text.includes('{n}')) hits.push('percentage without n')
  if (DASH.test(text)) hits.push('dash')
  return hits
}

function leaves(obj: unknown, path = ''): Array<[string, string]> {
  if (typeof obj === 'string') return [[path, obj]]
  if (typeof obj === 'object' && obj !== null) {
    return Object.entries(obj).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k))
  }
  return []
}

const LOCALES: Array<[Locale, unknown]> = [['en', en], ['pt', pt], ['es', es]]

describe('the detector (PROVEN TO REDDEN on planted violations, in every locale)', () => {
  it.each([
    ['en', '2x more engagement', 'numeric multiplier'],
    ['en', 'Threads got 2.5× the reach', 'numeric multiplier'],
    ['en', 'twice as likely to win', 'written multiplier'],
    ['en', 'Threads drive results and leads to signups', 'causal verb'],
    ['en', 'This leads to more engagement', 'causal verb'],
    ['en', 'the best pattern', 'superlative'],
    ['en', '62% of posts beat it', 'percentage without n'],
    ['pt', '2x mais envolvimento', 'numeric multiplier'],
    ['pt', 'o dobro do envolvimento', 'written multiplier'],
    ['pt', 'Isto leva a mais inscrições', 'causal verb'],
    ['pt', 'a melhor publicação', 'superlative'],
    ['es', '2x más interacción', 'numeric multiplier'],
    ['es', 'el doble de interacción', 'written multiplier'],
    ['es', 'Esto lleva a más registros', 'causal verb'],
    ['es', 'la mejor publicación', 'superlative'],
  ] as const)('%s: "%s" is flagged as %s', (locale, text, kind) => {
    expect(findViolations(text, locale)).toContain(kind)
  })

  it('a rate WITH its n is not flagged as a bare percentage', () => {
    expect(findViolations('{n} posts, 62% beat it', 'en')).not.toContain('percentage without n')
  })
})

describe('the outcome namespace of ALL THREE locale files carries none of the prohibited framing', () => {
  it.each(LOCALES)('%s', (locale, messages) => {
    const all = leaves(messages)
    expect(all.length).toBeGreaterThan(60)
    const offenders = all.flatMap(([key, text]) => {
      const hits = findViolations(text, locale)
      return hits.length > 0 ? [`${key}: ${hits.join(', ')}`] : []
    })
    expect(offenders).toEqual([])
  })
})

describe('the rendered template output (the pattern sentence and the prompt block) carries none either', () => {
  const cells: Array<[string, string[]]> = [
    ['role', ['anchor_thesis', 'founder_perspective', 'customer_proof', 'objection_response', 'conversation_starter', 'follow_up']],
    ['format', ['single', 'thread', 'carousel']],
    ['length_band', ['short', 'medium', 'long']],
    ['cta', ['true', 'false']],
    ['origin_mode', ['manual', 'objective_generated', 'signal_generated', 'studio_promoted']],
  ]

  it('every stored sentence and every counted sentence, both directions and both platforms', () => {
    const rendered: string[] = []
    for (const platform of ['twitter', 'linkedin']) {
      for (const [dimension, values] of cells) {
        for (const value of values) {
          for (const direction of ['above', 'below'] as const) {
            const basis = platform === 'twitter' ? 'rate' : 'count'
            rendered.push(renderOutcomePattern({ platform, dimension: dimension as never, value, direction, basis }))
            rendered.push(renderOutcomePattern({ platform, dimension: dimension as never, value, direction, basis, counts: { wins: 9, n: 11, campaigns: 3 } }))
          }
        }
      }
    }
    const values = cells.reduce((sum, [, v]) => sum + v.length, 0)
    expect(rendered.length).toBe(2 /* platforms */ * values * 2 /* directions */ * 2 /* stored + counted */)
    expect(rendered.flatMap((s) => findViolations(s, 'en').map((h) => `${s} -> ${h}`))).toEqual([])
  })

  it('the block that reaches a prompt', () => {
    const block = renderObservedOutcomes(
      [{ platform: 'twitter', pattern: renderOutcomePattern({ platform: 'twitter', dimension: 'format', value: 'thread', direction: 'above', basis: 'rate' }), wins: 9, n: 11, campaigns: 3 }],
      'twitter',
    ) as string
    expect(findViolations(block, 'en')).toEqual([])
  })
})
