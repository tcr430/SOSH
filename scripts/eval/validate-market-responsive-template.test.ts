import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { validateTemplate, type TemplateExample, type TemplateFile } from './validate-market-responsive-template'

// ADR 0023 §10.5 (Session 30 G1b.12) — SIGNAL-MR-CORPUS-BLIND-LABELLED's
// tooling half. This is a test OF the validator, not of any corpus content
// — G1b.12 explicitly forbids the Builder from authoring a single signal
// body or label (ADR §10.5 Part B), so no completed 40-example fixture
// exists here to assert against. Coverage instead: (1) the checked-in,
// still-unfilled template correctly reports every issue it should, and
// (2) a synthetic, fully-filled 40-example fixture (built in this file,
// never the real corpus) passes clean.

const TEMPLATE_PATH = path.join(process.cwd(), 'lib', 'signals', '__fixtures__', 'eval', 'corpus.v2.market-responsive.template.json')

function loadTemplate(): TemplateFile {
  return JSON.parse(readFileSync(TEMPLATE_PATH, 'utf-8')) as TemplateFile
}

function makeExample(overrides: Partial<TemplateExample> & { id: string; expectedVerdict: 'card' | 'no_card' }): TemplateExample {
  return {
    source: 'market_responsive',
    signal: {
      title: `Headline for ${overrides.id}`,
      html_url: `https://example-fictional-publisher.test/${overrides.id}`,
      occurred_at: '2026-03-04T10:00:00Z',
      is_prerelease: false,
      author_is_bot: false,
      body: `Body text for ${overrides.id}, fictional publisher.`,
    },
    stubMemory: {},
    ...overrides,
  }
}

function makeFullyAuthoredFixture(): TemplateFile {
  const examples: TemplateExample[] = []
  for (let i = 1; i <= 24; i++) {
    examples.push(makeExample({ id: `mr-c${String(i).padStart(2, '0')}`, expectedVerdict: 'card' }))
  }
  const reasons = ['too_sensitive', 'already_covered', 'weak_evidence', 'wrong_timing', 'not_relevant']
  for (let i = 1; i <= 16; i++) {
    examples.push(
      makeExample({
        id: `mr-n${String(i).padStart(2, '0')}`,
        expectedVerdict: 'no_card',
        expectedDismissReason: reasons[i % reasons.length],
      }),
    )
  }
  return { examples }
}

describe('validate-market-responsive-template.ts — SIGNAL-MR-CORPUS-BLIND-LABELLED tooling (ADR 0023 §10.5)', () => {
  it('the checked-in template (founder-authored, ADR §18) validates clean: right composition, no placeholders, no cassette', () => {
    const file = loadTemplate()
    const issues = validateTemplate(file)

    expect(file.examples.length).toBe(40)
    expect(file.examples.filter((e) => e.expectedVerdict === 'card').length).toBe(24)
    expect(file.examples.filter((e) => e.expectedVerdict === 'no_card').length).toBe(16)
    expect(issues).toEqual([])
  })

  it('no example in the checked-in template carries a cassette field', () => {
    const file = loadTemplate()
    for (const example of file.examples) {
      expect(example.cassette, `${example.id} must not have a cassette field yet`).toBeUndefined()
    }
  })

  it('every example in the checked-in template carries source: market_responsive', () => {
    const file = loadTemplate()
    for (const example of file.examples) {
      expect(example.source).toBe('market_responsive')
    }
  })

  it('a synthetic, fully-authored 40-example fixture (24 card / 16 no_card) validates clean', () => {
    const issues = validateTemplate(makeFullyAuthoredFixture())
    expect(issues).toEqual([])
  })

  it('flags a composition that is not 24 card / 16 no_card', () => {
    const fixture = makeFullyAuthoredFixture()
    fixture.examples.pop() // drops one no_card example -> 24 card / 15 no_card
    const issues = validateTemplate(fixture)
    expect(issues.some((i) => i.includes('expected exactly 16'))).toBe(true)
  })

  it('flags a no_card example with an invalid expectedDismissReason', () => {
    const fixture = makeFullyAuthoredFixture()
    fixture.examples[24].expectedDismissReason = 'not_a_real_reason'
    const issues = validateTemplate(fixture)
    expect(issues.some((i) => i.includes(fixture.examples[24].id) && i.includes('expectedDismissReason'))).toBe(true)
  })

  it('flags a card example that carries an expectedDismissReason', () => {
    const fixture = makeFullyAuthoredFixture()
    fixture.examples[0].expectedDismissReason = 'not_relevant'
    const issues = validateTemplate(fixture)
    expect(issues.some((i) => i.includes(fixture.examples[0].id) && i.includes('must not carry an expectedDismissReason'))).toBe(true)
  })

  it('flags an example carrying a cassette field (blind-labelling ordering violation)', () => {
    const fixture = makeFullyAuthoredFixture()
    fixture.examples[0].cassette = [{ verdict: 'card', reason: 'premature cassette' }]
    const issues = validateTemplate(fixture)
    expect(issues.some((i) => i.includes(fixture.examples[0].id) && i.includes('SIGNAL-MR-CORPUS-BLIND-LABELLED'))).toBe(true)
  })

  it('flags a duplicate example id', () => {
    const fixture = makeFullyAuthoredFixture()
    fixture.examples[1].id = fixture.examples[0].id
    const issues = validateTemplate(fixture)
    expect(issues.some((i) => i.includes('duplicate example id'))).toBe(true)
  })

  it('flags an unparseable occurred_at date', () => {
    const fixture = makeFullyAuthoredFixture()
    fixture.examples[0].signal.occurred_at = 'not-a-date'
    const issues = validateTemplate(fixture)
    expect(issues.some((i) => i.includes(fixture.examples[0].id) && i.includes('not a parseable date'))).toBe(true)
  })

  it('flags a source other than market_responsive', () => {
    const fixture = makeFullyAuthoredFixture()
    fixture.examples[0].source = 'github'
    const issues = validateTemplate(fixture)
    expect(issues.some((i) => i.includes(fixture.examples[0].id) && i.includes("source must be 'market_responsive'"))).toBe(true)
  })
})
