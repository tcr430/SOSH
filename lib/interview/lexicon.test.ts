import { describe, it, expect } from 'vitest'
import { containsHedge, foldForLexicon, isMoreCertainThanAnswer, mentionsPerformanceClaim } from './lexicon'

// ADR 0029 §4.4 (INTERVIEW-HEDGE-FLAGGED) and §4.7 (INTERVIEW-PERFORMANCE-CLAIM-DROPPED), the lexicon halves, Tier 2.
// Each behaviour is proved in EACH of en, pt AND es, with a NEGATIVE per locale (a sentence that must NOT match), because a
// lexicon that matches everything, or one locale's list deleted, must redden here.

describe('the hedge flag (§4.4) — "more certain than your answer"', () => {
  const CASES: Array<{ locale: string; span: string; hedged: string; certain: string; negative: string }> = [
    {
      locale: 'en',
      span: 'We think we are faster than most alternatives.',
      hedged: 'The company thinks it is faster than most alternatives.',
      certain: 'The company is faster than most alternatives.',
      negative: 'We are faster than most alternatives.',
    },
    {
      locale: 'pt',
      span: 'Acho que somos mais rápidos do que a maioria das alternativas.',
      hedged: 'A empresa acha que é mais rápida do que a maioria das alternativas, talvez.',
      certain: 'A empresa é mais rápida do que a maioria das alternativas.',
      negative: 'Somos mais rápidos do que a maioria das alternativas.',
    },
    {
      locale: 'es',
      span: 'Creo que somos más rápidos que la mayoría de las alternativas.',
      hedged: 'La empresa cree que es más rápida, tal vez.',
      certain: 'La empresa es más rápida que la mayoría de las alternativas.',
      negative: 'Somos más rápidos que la mayoría de las alternativas.',
    },
  ]

  for (const c of CASES) {
    it(`${c.locale}: flags a record that dropped the hedge the span carried`, () => {
      expect(containsHedge(c.span)).toBe(true)
      expect(isMoreCertainThanAnswer(c.span, c.certain)).toBe(true)
    })

    it(`${c.locale}: does NOT flag a record that kept its hedge`, () => {
      expect(isMoreCertainThanAnswer(c.span, c.hedged)).toBe(false)
    })

    it(`${c.locale}: does NOT flag a span that never hedged (negative)`, () => {
      expect(containsHedge(c.negative)).toBe(false)
      expect(isMoreCertainThanAnswer(c.negative, c.certain)).toBe(false)
    })
  }

  it('matches the ADR terms: think, believe, probably, maybe, hope, aim, try to, plan to, want to', () => {
    for (const sentence of [
      'we think so', 'we believe so', 'probably true', 'maybe next year', 'we hope it works', 'we aim for that',
      'we try to ship weekly', 'we plan to expand', 'we want to grow',
    ]) {
      expect(containsHedge(sentence), sentence).toBe(true)
    }
  })

  it('matches the THIRD-PERSON forms a restated record uses ("acha que", "cree que"), not only the first-person span', () => {
    for (const sentence of ['A empresa acha que somos rapidos', 'A equipa espera crescer', 'La empresa cree que es rapida', 'La empresa quiere crecer']) {
      expect(containsHedge(sentence), sentence).toBe(true)
    }
  })

  it('matches whole words only: "hopeful" and "thinkers" are not hedges', () => {
    expect(containsHedge('a hopeful team of thinkers')).toBe(false)
  })

  it('folds accents and case: "TALVEZ", "quizá" and "quizas" behave as their unaccented forms', () => {
    expect(containsHedge('TALVEZ no próximo ano')).toBe(true)
    expect(containsHedge('quizá mañana')).toBe(true)
    expect(containsHedge('quizas mañana')).toBe(true)
  })

  it('cannot be hidden by an invisible character inside the word', () => {
    expect(containsHedge('we thi​nk so')).toBe(true) // zero-width space (a format character) is folded away
  })
})

describe('the performance-claim lexicon (§4.7, D-4)', () => {
  const CASES: Array<{ locale: string; claim: string[]; negative: string }> = [
    {
      locale: 'en',
      claim: [
        'Our posts get great engagement', 'we get lots of impressions', 'it gets many likes', 'our organic reach is high',
        'a strong CTR', 'good click-through', 'that post performed well', 'long posts do best', 'it went viral',
      ],
      negative: 'We sell accounting software to small agencies in Portugal',
    },
    {
      locale: 'pt',
      claim: [
        'temos muito engajamento', 'muitas impressões', 'recebemos muitas curtidas', 'o nosso alcance é grande', 'uma boa taxa de cliques',
        'isto funciona melhor à terça', 'ficou viral',
      ],
      negative: 'Vendemos software de contabilidade a pequenas agências em Portugal',
    },
    {
      locale: 'es',
      claim: [
        'tenemos mucho engagement', 'muchas impresiones', 'recibimos muchos me gusta', 'nuestro alcance es grande', 'una buena tasa de clics',
        'esto rinde mejor los martes', 'se hizo viral',
      ],
      negative: 'Vendemos software de contabilidad a pequeñas agencias en Portugal',
    },
  ]

  for (const c of CASES) {
    it(`${c.locale}: every performance phrasing matches`, () => {
      for (const sentence of c.claim) expect(mentionsPerformanceClaim(sentence), sentence).toBe(true)
    })

    it(`${c.locale}: a sentence about the business does NOT match (negative)`, () => {
      expect(mentionsPerformanceClaim(c.negative)).toBe(false)
    })
  }

  it('covers views, followers, shares, clicks and conversion rate in each locale (M2.8 security review)', () => {
    for (const sentence of ['posts with images get 3x more shares', 'we gained followers', 'more views', 'higher conversion rate', 'more clicks', 'mais seguidores', 'mais partilhas', 'mais visualizacoes', 'mais cliques', 'mas seguidores', 'mas visualizaciones', 'mas compartidos']) {
      expect(mentionsPerformanceClaim(sentence), sentence).toBe(true)
    }
  })

  it('matches whole words only: "breach" and "outreach" are not "reach"', () => {
    expect(mentionsPerformanceClaim('a security breach and our outreach team')).toBe(false)
  })

  it('checks ALL three locales for any text (the answer language is unknown)', () => {
    // a Portuguese phrase in an otherwise English sentence, and vice versa
    expect(mentionsPerformanceClaim('our team says: muitas curtidas')).toBe(true)
    expect(mentionsPerformanceClaim('nuestro equipo: high engagement')).toBe(true)
  })
})

describe('foldForLexicon', () => {
  it('lower-cases, strips accents and removes format characters', () => {
    expect(foldForLexicon('Não​ Sei')).toBe('nao sei')
  })
})
