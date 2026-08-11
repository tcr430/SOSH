// ADR 0021 §10.4/§10.5 (Session 28 E5.8) — SIGNAL3-TRIAGE-QUALITY is
// MEASURED, never COVERED (Amendment B4). This script is a deterministic
// REPLAY against the recorded cassette embedded in each corpus example — it
// never calls a live Anthropic API. The live, periodic quality run is a
// separate, out-of-band process (not this script) — conflating the two would
// stack model sampling variance on top of corpus sampling noise (E5.8 spec).
//
// SCOPE NOTE (bootstrap run): runToolLoop (lib/ai/tool-runner.ts) itself
// requires a live service-role Supabase client for its trial-cap and
// rate-limit preflight (steps 1-2 of its pre-flight, unconditional even when
// no tool call happens) — machinery this lightweight CI job intentionally
// does not stand up (no local Postgres here, unlike db-tests.yml). This
// script therefore replays at the DECISION layer: it validates each
// cassette's recorded response against the exact schema runToolLoop parses
// a decision with (TriageDecisionSchema), then scores it against the
// corpus's human-assigned expectedVerdict/expectedDismissReason — the same
// judgment-quality question §10.4 asks, without re-deriving the loop's
// unrelated budget/DB machinery that E5.4-E5.7 already test directly. If a
// future step needs to exercise the loop's tool-dispatch path too, that is
// additive to this file, not a replacement of it.
//
// The corpus's cassettes were hand-authored alongside their expected labels
// (no live model has produced these examples yet) — so THIS FIRST RUN scores
// close to 1.0 by construction. That is expected and recorded as such in the
// artefact. The harness's ongoing job is to catch DRIFT: once cassettes are
// periodically refreshed from real, live triage runs (§10.4's separate
// process) and re-committed, a drop below the metric floors here means the
// model's real judgment has diverged from the human-labelled corpus.

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { TriageDecisionSchema } from '../../lib/ai/tool-runner'
import { classifyDismissReason, type DismissReason } from '../../lib/signals/triage/dismiss-reason'

const CORPUS_PATH = resolve(process.cwd(), 'lib/signals/__fixtures__/eval/corpus.v1.json')
const ARTEFACT_PATH = resolve(process.cwd(), 'lib/signals/__fixtures__/eval/latest-run.json')

// Kept in sync with the E5.8 spec's floors — assert-eval-executed.mjs reads
// the artefact this script writes, not these constants directly, so the
// floors are enforced here (the only place a "pass"/"fail" verdict is
// computed) and merely reported there.
const MIN_CARD_PRECISION = 0.75
const MIN_CARD_RECALL = 0.7
const MIN_DISMISS_MATCH = 0.6

type Verdict = 'card' | 'no_card'

interface CorpusExample {
  id: string
  signal: unknown
  stubMemory: unknown
  cassette: unknown[]
  expectedVerdict: Verdict
  expectedDismissReason?: DismissReason
}

interface CorpusFile {
  corpusVersion: number
  examples: CorpusExample[]
}

interface ExampleOutcome {
  id: string
  status: 'ok' | 'error'
  error?: string
  expectedVerdict: Verdict
  actualVerdict?: Verdict
  expectedDismissReason?: DismissReason
  actualDismissReason?: DismissReason
}

function runUrl(): string {
  const server = process.env.GITHUB_SERVER_URL
  const repo = process.env.GITHUB_REPOSITORY
  const runId = process.env.GITHUB_RUN_ID
  if (server && repo && runId) return `${server}/${repo}/actions/runs/${runId}`
  return 'local (no GITHUB_RUN_ID in env)'
}

function main(): void {
  const corpus = JSON.parse(readFileSync(CORPUS_PATH, 'utf-8')) as CorpusFile
  const declaredCount = corpus.examples.length

  const outcomes: ExampleOutcome[] = corpus.examples.map((example) => {
    try {
      const cassetteEntry = example.cassette[0]
      const decision = TriageDecisionSchema.parse(cassetteEntry)
      const actualDismissReason = decision.verdict === 'no_card' ? classifyDismissReason(decision.reason) : undefined
      return {
        id: example.id,
        status: 'ok',
        expectedVerdict: example.expectedVerdict,
        actualVerdict: decision.verdict,
        expectedDismissReason: example.expectedDismissReason,
        actualDismissReason,
      }
    } catch (err) {
      // A THIRD, job-failing state (E5.8 spec) — never coerced into a
      // verdict. assert-eval-executed.mjs hard-fails the job if ANY example
      // lands here.
      return {
        id: example.id,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
        expectedVerdict: example.expectedVerdict,
        expectedDismissReason: example.expectedDismissReason,
      }
    }
  })

  const executed = outcomes.filter((o) => o.status === 'ok')

  const predictedCard = executed.filter((o) => o.actualVerdict === 'card')
  const truePositives = predictedCard.filter((o) => o.expectedVerdict === 'card').length
  const precisionDenominator = predictedCard.length
  const precision = precisionDenominator > 0 ? truePositives / precisionDenominator : 0

  const expectedCard = executed.filter((o) => o.expectedVerdict === 'card')
  const recallDenominator = expectedCard.length
  const recallHits = expectedCard.filter((o) => o.actualVerdict === 'card').length
  const recall = recallDenominator > 0 ? recallHits / recallDenominator : 0

  const expectedNoCard = executed.filter((o) => o.expectedVerdict === 'no_card' && o.expectedDismissReason)
  const dismissMatchDenominator = expectedNoCard.length
  const dismissMatchHits = expectedNoCard.filter((o) => o.actualDismissReason === o.expectedDismissReason).length
  const dismissMatchRate = dismissMatchDenominator > 0 ? dismissMatchHits / dismissMatchDenominator : 0

  const metricsPass =
    precision >= MIN_CARD_PRECISION && recall >= MIN_CARD_RECALL && dismissMatchRate >= MIN_DISMISS_MATCH

  const artefact = {
    // Amendment B2.3 — every metric carries its denominator, the
    // corpusVersion, and the run URL, so a reviewer cites a number rather
    // than reconstructing the argument.
    corpusVersion: corpus.corpusVersion,
    runUrl: runUrl(),
    generatedAt: new Date().toISOString(),
    declaredCorpusCount: declaredCount,
    executedCount: executed.length,
    errorCount: outcomes.length - executed.length,
    metrics: {
      cardPrecision: { value: precision, numerator: truePositives, denominator: precisionDenominator, floor: MIN_CARD_PRECISION },
      cardRecall: { value: recall, numerator: recallHits, denominator: recallDenominator, floor: MIN_CARD_RECALL },
      dismissReasonMatch: {
        value: dismissMatchRate,
        numerator: dismissMatchHits,
        denominator: dismissMatchDenominator,
        floor: MIN_DISMISS_MATCH,
      },
    },
    metricsPass,
    outcomes,
  }

  mkdirSync(resolve(process.cwd(), 'lib/signals/__fixtures__/eval'), { recursive: true })
  writeFileSync(ARTEFACT_PATH, JSON.stringify(artefact, null, 2))

  console.log(
    `SIGNAL3-TRIAGE-QUALITY measured (never covered): corpusVersion=${corpus.corpusVersion} ` +
      `precision=${precision.toFixed(3)} (${truePositives}/${precisionDenominator}) ` +
      `recall=${recall.toFixed(3)} (${recallHits}/${recallDenominator}) ` +
      `dismissMatch=${dismissMatchRate.toFixed(3)} (${dismissMatchHits}/${dismissMatchDenominator}) ` +
      `run=${runUrl()}`,
  )

  if (outcomes.some((o) => o.status === 'error')) {
    console.error('::error::eval harness: one or more examples errored — see latest-run.json outcomes[].status')
    process.exit(1)
  }
  // Session 28-D, D4 (MAJOR-4 closed) — a `!metricsPass` exit(1) here used to
  // fail this step (npm run test:eval) before assert-eval-executed.mjs ever
  // ran, which would have re-fused the gate the CI-job split (ADR 0021 §10.4,
  // Amendment B3/B3.1) exists to separate: eval-reported (this script's exit
  // code) must stay a deterministic fact about EXECUTION, never about
  // PASSING. metricsPass is still written into the artefact below for the
  // advisory `eval-threshold` check to read.
  if (!metricsPass) {
    console.warn('::warning::eval harness: one or more metrics fell below its floor — see latest-run.json metrics (advisory, does not fail this step)')
  }
}

main()
