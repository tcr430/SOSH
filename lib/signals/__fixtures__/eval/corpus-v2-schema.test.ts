import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// ADR 0023 §10.5 (Session 30 G1b.12) — Part A's own schema bump, verified.
// "No example carries a source/origin discriminator today" was the ADR's
// blocking finding for v1; this file proves the bump actually closed it for
// v2, and that it did so WITHOUT disturbing the 40 GitHub examples' own
// cassettes (which the founder's blind-labelling ordering constraint does
// not touch — those cassettes predate SIGNAL-MR-CORPUS-BLIND-LABELLED
// entirely).

const CORPUS_V2_PATH = path.join(process.cwd(), 'lib', 'signals', '__fixtures__', 'eval', 'corpus.v2.json')

interface CorpusV2Example {
  id: string
  source: string
  expectedVerdict: 'card' | 'no_card'
  cassette?: unknown[]
}

interface CorpusV2File {
  corpusVersion: number
  labelCommitSha: string | null
  cassetteCommitSha: string | null
  examples: CorpusV2Example[]
}

function loadCorpusV2(): CorpusV2File {
  return JSON.parse(readFileSync(CORPUS_V2_PATH, 'utf-8')) as CorpusV2File
}

describe('corpus.v2.json — SIGNAL-MR-CORPUS-EXTENDED schema bump (ADR 0023 §10.5)', () => {
  it('corpusVersion is 2', () => {
    expect(loadCorpusV2().corpusVersion).toBe(2)
  })

  it('every example carries a valid source discriminator', () => {
    const corpus = loadCorpusV2()
    for (const example of corpus.examples) {
      expect(['github', 'market_responsive'], `${example.id} has an invalid source: ${JSON.stringify(example.source)}`).toContain(example.source)
    }
  })

  it('the 40 GitHub examples are unchanged in count and every one still carries its cassette', () => {
    const corpus = loadCorpusV2()
    const github = corpus.examples.filter((e) => e.source === 'github')
    expect(github.length).toBe(40)
    expect(github.filter((e) => e.expectedVerdict === 'card').length).toBe(24)
    expect(github.filter((e) => e.expectedVerdict === 'no_card').length).toBe(16)
    for (const example of github) {
      expect(Array.isArray(example.cassette) && example.cassette.length > 0, `${example.id} is missing its cassette`).toBe(true)
    }
  })

  it('carries labelCommitSha and cassetteCommitSha fields — cassetteCommitSha null until G1b.13 lands (ADR §2.4.1 ordering)', () => {
    const corpus = loadCorpusV2()
    expect(corpus).toHaveProperty('labelCommitSha')
    expect(corpus).toHaveProperty('cassetteCommitSha')
    expect(corpus.cassetteCommitSha).toBeNull()
  })

  it('the 40 market_responsive examples are merged, founder-labelled, and carry no cassette field yet (SIGNAL-MR-CORPUS-BLIND-LABELLED, ADR §18)', () => {
    const corpus = loadCorpusV2()
    const marketResponsive = corpus.examples.filter((e) => e.source === 'market_responsive')
    expect(marketResponsive.length).toBe(40)
    expect(marketResponsive.filter((e) => e.expectedVerdict === 'card').length).toBe(24)
    expect(marketResponsive.filter((e) => e.expectedVerdict === 'no_card').length).toBe(16)
    for (const example of marketResponsive) {
      expect(example.cassette, `${example.id} must not carry a cassette field yet — label commit must predate the cassette commit`).toBeUndefined()
    }
  })
})
