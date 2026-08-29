import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'

// ADR 0023 §2.4.2 (Session 30 G1b.11) — SIGNAL-MR-CORPUS-DISCRIMINATIVE.
//
// WHY THIS FILE EXISTS: `git grep -l "run-triage-eval\|assert-eval-executed"
// -- "*.test.ts"` returned NOTHING before this file — run-triage-eval.ts's
// main() (precision/recall/dismissMatch computation, :111-129) had ZERO
// test coverage. This closes that gap the only honest way available: by
// actually spawning the real script (never re-implementing its arithmetic
// here) against the real corpus with three known mutations applied, and
// asserting the metrics land on the exact numbers hand-computed below.
//
// SCOPE, STATED HONESTLY AND BINDINGLY (ADR §2.4.2's own words): this proves
// the SCRIPT'S ARITHMETIC. It is NOT a corpus-discrimination proof — a
// corpus perfectly separable by a single keyword would pass this test
// identically, because mutation testing operates entirely downstream of
// whatever the corpus already contains; it never touches whether the
// corpus's inputs are hard, realistic, or discriminating. ADR §2.4.2
// "explicitly rejects describing Tier A as a corpus-discrimination proof,
// and the Reviewer should treat any such description as a finding" — so do
// not upgrade this file's claim in any future edit or doc reference.
//
// MECHANISM: each mutation writes a deliberately corrupted copy of the REAL
// corpus.v1.json to its real (hardcoded) path, spawns
// `npx tsx scripts/eval/run-triage-eval.ts` as a genuinely separate child
// process — never an in-process import, since main() calls process.exit(1)
// on an errored example and that must never be able to kill this test
// runner — reads the real latest-run.json artefact the script writes, and
// asserts on it. The corpus file is restored after EVERY test (afterEach);
// the latest-run.json artefact (also git-tracked) is restored once at the
// very end (afterAll) to its pre-suite content, so a local run leaves the
// tree exactly as clean as `npm run test:eval` running once would.
//
// TWO MECHANICAL FACTS, both true of run-triage-eval.ts today and neither
// rediscovered here without comment:
// - There is no dismissReason FIELD to flip. actualDismissReason is DERIVED
//   — classifyDismissReason(decision.reason) runs a keyword scan over the
//   cassette's `reason` PROSE (run-triage-eval.ts:88; rules in
//   lib/signals/triage/dismiss-reason.ts:10-46). "Corrupting" a dismiss
//   reason means rewriting the reason TEXT until the classifier lands on a
//   DIFFERENT enum than expectedDismissReason — and because the classifier
//   DEFAULTS to not_relevant on no match (:46), every corruption below is
//   verified (in a dedicated test) to have actually MOVED the
//   classification, not silently fallen through to that default.
// - Mutation 2 reddens TWO metrics. Flipping 9 no_card cassettes to card
//   leaves the dismiss-match denominator at 16 (it keys off
//   expectedVerdict==='no_card' && expectedDismissReason, both of which are
//   corpus-declared and untouched by this mutation) while
//   actualDismissReason becomes undefined for those 9 rows (their
//   actualVerdict is now 'card', so run-triage-eval.ts:88's
//   `decision.verdict === 'no_card' ? classifyDismissReason(...) :
//   undefined` never calls the classifier for them) — so dismissMatch falls
//   to 7/16 = 0.4375 alongside precision's 24/33 = 0.727. This test asserts
//   both numbers on that one mutation; it does not claim one metric each.

const ROOT = process.cwd()
// ADR 0023 §10.5 (Session 30 G1b.12) — CORPUS_PATH repointed to v2. The 40
// GitHub examples this file mutates are UNCHANGED aside from the added
// `source` field; every assertion below now reads metricsBySource.github
// rather than the removed blended `metrics` object (§2.8).
const CORPUS_PATH = path.join(ROOT, 'lib', 'signals', '__fixtures__', 'eval', 'corpus.v2.json')
const ARTEFACT_PATH = path.join(ROOT, 'lib', 'signals', '__fixtures__', 'eval', 'latest-run.json')

interface EvalMetric {
  value: number
  numerator: number
  denominator: number
  floor: number
  sigma: number | null
}

interface SourceMetrics {
  declaredCount: number
  executedCount: number
  pendingCount: number
  errorCount: number
  cardPrecision: EvalMetric
  cardRecall: EvalMetric
  dismissReasonMatch: EvalMetric
  pass: boolean
}

interface EvalArtefact {
  corpusVersion: number
  declaredCorpusCount: number
  executedCount: number
  errorCount: number
  metricsBySource: {
    github: SourceMetrics
    market_responsive: SourceMetrics
  }
  metricsPass: boolean
}

let originalCorpusText: string
let originalArtefactText: string

beforeAll(() => {
  originalCorpusText = readFileSync(CORPUS_PATH, 'utf-8')
  originalArtefactText = readFileSync(ARTEFACT_PATH, 'utf-8')
})

afterEach(() => {
  writeFileSync(CORPUS_PATH, originalCorpusText)
})

afterAll(() => {
  writeFileSync(ARTEFACT_PATH, originalArtefactText)
})

function runEval(): EvalArtefact {
  execSync('npx tsx scripts/eval/run-triage-eval.ts', { cwd: ROOT, stdio: 'pipe' })
  return JSON.parse(readFileSync(ARTEFACT_PATH, 'utf-8')) as EvalArtefact
}

function loadCorpus(): { corpusVersion: number; examples: Array<Record<string, unknown>> } {
  return JSON.parse(originalCorpusText)
}

describe('scripts/eval/run-triage-eval.ts — Tier A mutation test (SIGNAL-MR-CORPUS-DISCRIMINATIVE, ADR §2.4.2)', () => {
  // Baseline, re-asserted here as the "GREEN before RED" half of every
  // redden demonstration: the unmutated corpus scores a perfect 1.0 on all
  // three metrics — expected and recorded (run-triage-eval.ts:22-28) since
  // the cassettes were hand-authored alongside their own labels.
  it('unmutated corpus: precision 24/24, recall 24/24, dismissMatch 16/16 (all 1.0, the bootstrap ceiling)', () => {
    const artefact = runEval()
    // 80 total (ADR §18): 40 github (cassette-bearing, unchanged) + 40
    // market_responsive (founder-labelled, PENDING — no cassette yet).
    expect(artefact.declaredCorpusCount).toBe(80)
    expect(artefact.errorCount).toBe(0)
    const github = artefact.metricsBySource.github
    expect(github.cardPrecision).toMatchObject({ value: 1, numerator: 24, denominator: 24, floor: 0.75 })
    expect(github.cardRecall).toMatchObject({ value: 1, numerator: 24, denominator: 24, floor: 0.7 })
    expect(github.dismissReasonMatch).toMatchObject({ value: 1, numerator: 16, denominator: 16, floor: 0.6 })
    // ADR §10.5 — sigma is the binomial standard error AT THE FLOOR, a
    // property of the denominator alone, not of this run's observed value.
    expect(github.cardPrecision.sigma).toBeCloseTo(Math.sqrt((0.75 * 0.25) / 24), 10)
    expect(github.cardRecall.sigma).toBeCloseTo(Math.sqrt((0.7 * 0.3) / 24), 10)
    expect(github.dismissReasonMatch.sigma).toBeCloseTo(Math.sqrt((0.6 * 0.4) / 16), 10)
    // market_responsive (ADR §18, Session 30 G1b.13's live run) is now
    // FULLY cassette-bearing — the honest, MEASURED result (Tier E, ADR
    // 0015 Amendment B4): under the live run's fully-empty stub tool
    // condition (no audience/brand/campaign memory for any example,
    // matching every corpus example's stubMemory: {}), the model scored
    // ZERO of the 24 founder-labelled 'card' examples as 'card' — 0/24
    // recall. This number is reported, not smoothed over: it is exactly
    // what Tier E measurement exists to surface, flattering or not.
    const marketResponsive = artefact.metricsBySource.market_responsive
    expect(marketResponsive.declaredCount).toBe(40)
    expect(marketResponsive.pendingCount).toBe(0)
    expect(marketResponsive.cardPrecision).toMatchObject({ numerator: 0, denominator: 0 })
    expect(marketResponsive.cardRecall).toMatchObject({ numerator: 0, denominator: 24 })
    expect(marketResponsive.dismissReasonMatch).toMatchObject({ numerator: 9, denominator: 16 })
    // Both github's floors (unaffected) and market_responsive's (now real,
    // below floor on recall/dismissMatch) feed metricsPass — advisory only
    // (eval-threshold never blocks a merge), so a real regression is still
    // truthfully reported as false rather than papered over.
    expect(artefact.metricsPass).toBe(false)
  })

  it('MUTATION 1 — 8 card→no_card cassette flips reddens recall: 16/24 = 0.667 < 0.70 floor', () => {
    const corpus = loadCorpus()
    // Scoped to source: 'github' — corpus.v2.json also carries 40
    // market_responsive examples (ADR §18), none of which have a cassette
    // to mutate; this Tier A test is specifically about the cassette-
    // bearing github slice's arithmetic.
    const cardExamples = corpus.examples.filter((e) => e.expectedVerdict === 'card' && e.source === 'github')
    expect(cardExamples.length).toBe(24)

    for (const example of cardExamples.slice(0, 8)) {
      const cassette = (example.cassette as Array<Record<string, unknown>>)[0]
      cassette.verdict = 'no_card'
      // A schema-valid, plausible reason — this mutation targets RECALL
      // only; the flipped examples' expectedVerdict stays 'card', so they
      // never enter the dismiss-match denominator (which keys off
      // expectedVerdict === 'no_card') regardless of what this text says.
      cassette.reason = 'Reclassified for this mutation test — not a genuine no_card judgment.'
    }
    writeFileSync(CORPUS_PATH, JSON.stringify(corpus, null, 2))

    const artefact = runEval()
    const github = artefact.metricsBySource.github
    expect(github.cardRecall.numerator).toBe(16)
    expect(github.cardRecall.denominator).toBe(24)
    expect(github.cardRecall.value).toBeCloseTo(16 / 24, 10)
    expect(github.cardRecall.value).toBeLessThan(0.7)
    expect(artefact.metricsPass).toBe(false)
    // Precision and dismiss-match are UNTOUCHED by this mutation — isolating
    // the intended metric, per the build guide's own instruction that the
    // table isolates the intended metric per row (mutation 2 is the
    // deliberate exception, asserted separately below).
    expect(github.cardPrecision.value).toBe(1)
    expect(github.dismissReasonMatch.value).toBe(1)
  })

  it('MUTATION 2 — 9 no_card→card cassette flips reddens BOTH precision (24/33 = 0.727 < 0.75) AND dismissMatch (7/16 = 0.4375 < 0.60)', () => {
    const corpus = loadCorpus()
    const noCardExamples = corpus.examples.filter((e) => e.expectedVerdict === 'no_card' && e.source === 'github')
    expect(noCardExamples.length).toBe(16)

    for (const example of noCardExamples.slice(0, 9)) {
      const cassette = (example.cassette as Array<Record<string, unknown>>)[0]
      cassette.verdict = 'card'
      // Reason text is irrelevant here: run-triage-eval.ts:88 only calls
      // classifyDismissReason when decision.verdict === 'no_card' — these 9
      // rows now report 'card', so the classifier is never invoked for
      // them, and actualDismissReason is undefined by construction.
    }
    writeFileSync(CORPUS_PATH, JSON.stringify(corpus, null, 2))

    const artefact = runEval()
    const github = artefact.metricsBySource.github
    // precision: predictedCard = 24 originally-card (untouched) + 9 flipped
    // = 33; truePositives = the 24 whose expectedVerdict is genuinely 'card'.
    expect(github.cardPrecision.numerator).toBe(24)
    expect(github.cardPrecision.denominator).toBe(33)
    expect(github.cardPrecision.value).toBeCloseTo(24 / 33, 10)
    expect(github.cardPrecision.value).toBeLessThan(0.75)
    // dismissMatch: denominator STAYS 16 (keys off expectedVerdict +
    // expectedDismissReason, both corpus-declared and untouched); the 9
    // flipped rows' actualDismissReason is undefined, so they can never
    // match their expectedDismissReason — only the 7 untouched no_card rows
    // still hit.
    expect(github.dismissReasonMatch.numerator).toBe(7)
    expect(github.dismissReasonMatch.denominator).toBe(16)
    expect(github.dismissReasonMatch.value).toBeCloseTo(7 / 16, 10)
    expect(github.dismissReasonMatch.value).toBeLessThan(0.6)
    expect(artefact.metricsPass).toBe(false)
    // Recall is untouched — every genuinely-card example is still called card.
    expect(github.cardRecall.value).toBe(1)
  })

  it('MUTATION 3 — 7 dismiss-reason corruptions reddens dismissMatch: 9/16 = 0.5625 < 0.60 floor', () => {
    const corpus = loadCorpus()
    const noCardExamples = corpus.examples.filter((e) => e.expectedVerdict === 'no_card' && e.source === 'github') as Array<{
      id: string
      expectedDismissReason: string
      cassette: Array<Record<string, unknown>>
    }>
    expect(noCardExamples.length).toBe(16)

    // Each replacement text below was verified (see the dedicated test
    // below) to classify to a DIFFERENT bucket than the example's own
    // expectedDismissReason — a corruption that silently fell through to
    // classifyDismissReason's not_relevant default without actually moving
    // away from a genuinely-different original bucket would understate
    // what "corrupted" means.
    const corruptions: Record<string, string> = {
      'n01-cve-patch': 'This changelog entry is vague and unclear, with no concrete specifics worth surfacing.', // too_sensitive -> weak_evidence
      'n05-sso-bugfix': 'This touches a security vulnerability (CVE) and should not be surfaced publicly.', // already_covered -> too_sensitive
      'n08-vague-changelog': 'This is an early alpha preview, too premature for a broad audience right now.', // weak_evidence -> wrong_timing
      'n09-internal-refactor': 'This is internal contributor tooling with no external customer audience.', // weak_evidence -> not_relevant
      'n12-beta-opt-in': 'This duplicate of an already announced and already covered feature has nothing new to say.', // wrong_timing -> already_covered
      'n14-ci-tooling': 'This is a security exposure incident that should never be surfaced publicly.', // not_relevant -> too_sensitive
      'n16-community-housekeeping': 'This is vague and lacks concrete detail worth a card.', // not_relevant -> weak_evidence
    }
    expect(Object.keys(corruptions).length).toBe(7)

    let corrupted = 0
    for (const example of noCardExamples) {
      const replacement = corruptions[example.id]
      if (!replacement) continue
      example.cassette[0].reason = replacement
      corrupted++
    }
    expect(corrupted).toBe(7)
    writeFileSync(CORPUS_PATH, JSON.stringify(corpus, null, 2))

    const artefact = runEval()
    const github = artefact.metricsBySource.github
    expect(github.dismissReasonMatch.numerator).toBe(9)
    expect(github.dismissReasonMatch.denominator).toBe(16)
    expect(github.dismissReasonMatch.value).toBeCloseTo(9 / 16, 10)
    expect(github.dismissReasonMatch.value).toBeLessThan(0.6)
    expect(artefact.metricsPass).toBe(false)
    // Verdict is untouched by this mutation — only the reason PROSE changed.
    expect(github.cardPrecision.value).toBe(1)
    expect(github.cardRecall.value).toBe(1)
  })

  it('every mutation-3 corruption actually MOVES the classification, never silently falling through to the not_relevant default', async () => {
    const { classifyDismissReason } = await import('../../lib/signals/triage/dismiss-reason')
    const corpus = loadCorpus()
    const byId = new Map(corpus.examples.map((e) => [e.id as string, e]))

    const corruptions: Record<string, string> = {
      'n01-cve-patch': 'This changelog entry is vague and unclear, with no concrete specifics worth surfacing.',
      'n05-sso-bugfix': 'This touches a security vulnerability (CVE) and should not be surfaced publicly.',
      'n08-vague-changelog': 'This is an early alpha preview, too premature for a broad audience right now.',
      'n09-internal-refactor': 'This is internal contributor tooling with no external customer audience.',
      'n12-beta-opt-in': 'This duplicate of an already announced and already covered feature has nothing new to say.',
      'n14-ci-tooling': 'This is a security exposure incident that should never be surfaced publicly.',
      'n16-community-housekeeping': 'This is vague and lacks concrete detail worth a card.',
    }

    for (const [id, replacementText] of Object.entries(corruptions)) {
      const example = byId.get(id) as { expectedDismissReason: string } | undefined
      expect(example, `${id} not found in corpus.v1.json — update this test's id list`).toBeDefined()
      const moved = classifyDismissReason(replacementText)
      expect(moved, `${id}'s corruption classified to the SAME bucket (${example!.expectedDismissReason}) — pick different replacement text`).not.toBe(
        example!.expectedDismissReason,
      )
    }
  })
})
