// ADR 0023 §10.5 (Session 30 G1b.12) — Part B's "validation" half. This
// script never authors a signal body or a label; it only checks that the
// founder's authoring of corpus.v2.market-responsive.template.json is
// STRUCTURALLY complete before that file is merged into corpus.v2.json:
//
//   - exactly 24 `card` / 16 `no_card` examples (A-3's composition)
//   - every example carries source: 'market_responsive'
//   - no example carries a `cassette` field yet (SIGNAL-MR-CORPUS-BLIND-
//     LABELLED — the label commit must predate the cassette commit)
//   - every `no_card` example has a valid expectedDismissReason
//   - no placeholder ("TODO") text remains in any authored field
//
// Run standalone: `npx tsx scripts/eval/validate-market-responsive-template.ts
// [path]` (defaults to the template's own path). Exits 1 with every
// violation printed on any failure; prints a single green line on success.
// Also imported directly by validate-market-responsive-template.test.ts,
// which is the actual TDD coverage for validateTemplate() below.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const DISMISS_REASONS = new Set(['too_sensitive', 'already_covered', 'weak_evidence', 'wrong_timing', 'not_relevant'])

export interface TemplateExample {
  id: string
  source: string
  signal: {
    title: string
    html_url: string
    occurred_at: string
    is_prerelease: boolean
    author_is_bot: boolean
    body: string
  }
  stubMemory: unknown
  cassette?: unknown[]
  expectedVerdict: string
  expectedDismissReason?: string
}

export interface TemplateFile {
  examples: TemplateExample[]
}

function hasPlaceholder(value: unknown): boolean {
  return typeof value === 'string' && value.includes('TODO')
}

export function validateTemplate(file: TemplateFile): string[] {
  const issues: string[] = []
  const { examples } = file

  const cardExamples = examples.filter((e) => e.expectedVerdict === 'card')
  const noCardExamples = examples.filter((e) => e.expectedVerdict === 'no_card')
  const otherVerdict = examples.filter((e) => e.expectedVerdict !== 'card' && e.expectedVerdict !== 'no_card')

  if (otherVerdict.length > 0) {
    issues.push(`${otherVerdict.length} example(s) have an expectedVerdict that is neither 'card' nor 'no_card': ${otherVerdict.map((e) => e.id).join(', ')}`)
  }
  if (cardExamples.length !== 24) {
    issues.push(`expected exactly 24 'card' examples (ADR §10.5 A-3), found ${cardExamples.length}`)
  }
  if (noCardExamples.length !== 16) {
    issues.push(`expected exactly 16 'no_card' examples (ADR §10.5 A-3), found ${noCardExamples.length}`)
  }

  for (const example of examples) {
    if (example.source !== 'market_responsive') {
      issues.push(`${example.id}: source must be 'market_responsive', got ${JSON.stringify(example.source)}`)
    }
    if (example.cassette !== undefined) {
      issues.push(`${example.id}: carries a 'cassette' field — SIGNAL-MR-CORPUS-BLIND-LABELLED requires the label commit to predate any cassette`)
    }
    if (example.expectedVerdict === 'no_card' && !DISMISS_REASONS.has(example.expectedDismissReason ?? '')) {
      issues.push(`${example.id}: no_card example must have a valid expectedDismissReason (one of ${[...DISMISS_REASONS].join(' | ')}), got ${JSON.stringify(example.expectedDismissReason)}`)
    }
    if (example.expectedVerdict === 'card' && example.expectedDismissReason !== undefined) {
      issues.push(`${example.id}: card example must not carry an expectedDismissReason`)
    }

    const placeholderFields: string[] = []
    if (hasPlaceholder(example.id)) placeholderFields.push('id')
    if (hasPlaceholder(example.signal?.title)) placeholderFields.push('signal.title')
    if (hasPlaceholder(example.signal?.html_url)) placeholderFields.push('signal.html_url')
    if (hasPlaceholder(example.signal?.occurred_at)) placeholderFields.push('signal.occurred_at')
    if (hasPlaceholder(example.signal?.body)) placeholderFields.push('signal.body')
    if (hasPlaceholder(example.expectedDismissReason)) placeholderFields.push('expectedDismissReason')
    if (placeholderFields.length > 0) {
      issues.push(`${example.id}: unfilled placeholder text remains in ${placeholderFields.join(', ')}`)
    }

    const occurredAt = example.signal?.occurred_at
    if (occurredAt && !hasPlaceholder(occurredAt) && isNaN(new Date(occurredAt).getTime())) {
      issues.push(`${example.id}: signal.occurred_at is not a parseable date: ${JSON.stringify(occurredAt)}`)
    }
  }

  const ids = examples.map((e) => e.id)
  const duplicateIds = ids.filter((id, i) => ids.indexOf(id) !== i)
  if (duplicateIds.length > 0) {
    issues.push(`duplicate example id(s): ${[...new Set(duplicateIds)].join(', ')}`)
  }

  return issues
}

function main(): void {
  const templatePath = process.argv[2]
    ? resolve(process.cwd(), process.argv[2])
    : resolve(process.cwd(), 'lib/signals/__fixtures__/eval/corpus.v2.market-responsive.template.json')

  const file = JSON.parse(readFileSync(templatePath, 'utf-8')) as TemplateFile
  const issues = validateTemplate(file)

  if (issues.length > 0) {
    console.error(`validate-market-responsive-template: ${issues.length} issue(s) found in ${templatePath}:`)
    for (const issue of issues) console.error(`  - ${issue}`)
    process.exit(1)
  }

  console.log(`validate-market-responsive-template: ${file.examples.length} examples, structurally complete — ready to merge into corpus.v2.json.`)
}

if (require.main === module) {
  main()
}
