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

// ADR 0023 §10.5 (Session 30 G1b.12) — schema bump 1 -> 2. v2 adds a
// `source` discriminator to every example (github | market_responsive) so
// per-source metrics are possible at all; inferring source from
// signal.html_url shape would be fragile and undeclared (§10.5).
const CORPUS_PATH = resolve(process.cwd(), 'lib/signals/__fixtures__/eval/corpus.v2.json')
const ARTEFACT_PATH = resolve(process.cwd(), 'lib/signals/__fixtures__/eval/latest-run.json')

// Kept in sync with the E5.8 spec's floors — assert-eval-executed.mjs reads
// the artefact this script writes, not these constants directly, so the
// floors are enforced here (the only place a "pass"/"fail" verdict is
// computed) and merely reported there.
//
// ADR §10.5 — GitHub's floors are unchanged. Market-responsive reuses the
// same numeric floors for REPORTING (no other number has been ruled), but
// they are advisory until graduation (ADR §2.6) — a status already true of
// every floor here, since eval-threshold never blocks a merge
// (.github/workflows/eval-triage.yml, checkThreshold() below).
const MIN_CARD_PRECISION = 0.75
const MIN_CARD_RECALL = 0.7
const MIN_DISMISS_MATCH = 0.6

type Verdict = 'card' | 'no_card'
type CorpusSource = 'github' | 'market_responsive'

interface CorpusExample {
  id: string
  source: CorpusSource
  signal: unknown
  stubMemory: unknown
  // Optional — ADR §10.5/§2.4.1: a market-responsive example's label is
  // committed BEFORE its cassette exists (SIGNAL-MR-CORPUS-BLIND-LABELLED).
  // An example with no cassette yet is 'pending', not an error.
  cassette?: unknown[]
  expectedVerdict: Verdict
  expectedDismissReason?: DismissReason
}

interface CorpusFile {
  corpusVersion: number
  // ADR §2.4.1 — recorded in that order: the label commit must predate the
  // cassette commit. null until each commit exists.
  labelCommitSha?: string | null
  cassetteCommitSha?: string | null
  examples: CorpusExample[]
}

interface ExampleOutcome {
  id: string
  source: CorpusSource
  status: 'ok' | 'error' | 'pending'
  error?: string
  expectedVerdict: Verdict
  actualVerdict?: Verdict
  expectedDismissReason?: DismissReason
  actualDismissReason?: DismissReason
}

interface SourceMetric {
  value: number
  numerator: number
  denominator: number
  floor: number
  // ADR §10.5 — "sigma AS A FIELD, so a reviewer cites a number rather than
  // recomputing it by hand." Binomial standard error sqrt(p*(1-p)/n) at the
  // FLOOR proportion (not the observed value) — the same convention ADR
  // 0021 §10.4's ~9.35pp figure uses, since sigma is meant to describe the
  // gate's own noise floor, not vary with whatever the current run scored.
  // null when the denominator is 0 (nothing to compute a spread over yet).
  sigma: number | null
}

function sigmaAtFloor(floor: number, denominator: number): number | null {
  if (denominator <= 0) return null
  return Math.sqrt((floor * (1 - floor)) / denominator)
}

function runUrl(): string {
  const server = process.env.GITHUB_SERVER_URL
  const repo = process.env.GITHUB_REPOSITORY
  const runId = process.env.GITHUB_RUN_ID
  if (server && repo && runId) return `${server}/${repo}/actions/runs/${runId}`
  return 'local (no GITHUB_RUN_ID in env)'
}

// One source's slice of outcomes -> its three metrics + counts. Pending
// examples (no cassette yet, ADR §2.4.1) are excluded from every metric
// denominator — they have produced no actual/decision to score — but are
// NOT errors: assert-eval-executed.mjs's "silently dropped" check reads
// executedCount, which counts 'ok' + 'pending' (both are accounted-for
// outcomes; only 'error' is unaccounted).
function scoreSource(source: CorpusSource, outcomes: ExampleOutcome[]) {
  const sourceOutcomes = outcomes.filter((o) => o.source === source)
  const ok = sourceOutcomes.filter((o) => o.status === 'ok')
  const pending = sourceOutcomes.filter((o) => o.status === 'pending')
  const errored = sourceOutcomes.filter((o) => o.status === 'error')

  const predictedCard = ok.filter((o) => o.actualVerdict === 'card')
  const truePositives = predictedCard.filter((o) => o.expectedVerdict === 'card').length
  const precisionDenominator = predictedCard.length
  const precision = precisionDenominator > 0 ? truePositives / precisionDenominator : 0

  const expectedCard = ok.filter((o) => o.expectedVerdict === 'card')
  const recallDenominator = expectedCard.length
  const recallHits = expectedCard.filter((o) => o.actualVerdict === 'card').length
  const recall = recallDenominator > 0 ? recallHits / recallDenominator : 0

  const expectedNoCard = ok.filter((o) => o.expectedVerdict === 'no_card' && o.expectedDismissReason)
  const dismissMatchDenominator = expectedNoCard.length
  const dismissMatchHits = expectedNoCard.filter((o) => o.actualDismissReason === o.expectedDismissReason).length
  const dismissMatchRate = dismissMatchDenominator > 0 ? dismissMatchHits / dismissMatchDenominator : 0

  const cardPrecision: SourceMetric = {
    value: precision,
    numerator: truePositives,
    denominator: precisionDenominator,
    floor: MIN_CARD_PRECISION,
    sigma: sigmaAtFloor(MIN_CARD_PRECISION, precisionDenominator),
  }
  const cardRecall: SourceMetric = {
    value: recall,
    numerator: recallHits,
    denominator: recallDenominator,
    floor: MIN_CARD_RECALL,
    sigma: sigmaAtFloor(MIN_CARD_RECALL, recallDenominator),
  }
  const dismissReasonMatch: SourceMetric = {
    value: dismissMatchRate,
    numerator: dismissMatchHits,
    denominator: dismissMatchDenominator,
    floor: MIN_DISMISS_MATCH,
    sigma: sigmaAtFloor(MIN_DISMISS_MATCH, dismissMatchDenominator),
  }

  const pass = cardPrecision.value >= cardPrecision.floor && cardRecall.value >= cardRecall.floor && dismissReasonMatch.value >= dismissReasonMatch.floor

  return {
    declaredCount: sourceOutcomes.length,
    executedCount: ok.length + pending.length,
    pendingCount: pending.length,
    errorCount: errored.length,
    cardPrecision,
    cardRecall,
    dismissReasonMatch,
    // Reported for every source; ADR §10.5 — market-responsive's pass state
    // is advisory-only until graduation, same as GitHub's already is
    // (eval-threshold never blocks a merge, checkThreshold() in
    // assert-eval-executed.mjs).
    pass,
  }
}

function main(): void {
  const corpus = JSON.parse(readFileSync(CORPUS_PATH, 'utf-8')) as CorpusFile
  const declaredCount = corpus.examples.length

  const outcomes: ExampleOutcome[] = corpus.examples.map((example) => {
    const cassetteEntry = example.cassette?.[0]
    if (cassetteEntry === undefined) {
      // ADR §2.4.1 — a market-responsive example whose label is committed
      // but whose cassette does not exist yet. Not an error: this is the
      // expected interim state between the label commit and the cassette
      // commit (SIGNAL-MR-CORPUS-BLIND-LABELLED's binding ordering).
      return {
        id: example.id,
        source: example.source,
        status: 'pending',
        expectedVerdict: example.expectedVerdict,
        expectedDismissReason: example.expectedDismissReason,
      }
    }
    try {
      const decision = TriageDecisionSchema.parse(cassetteEntry)
      const actualDismissReason = decision.verdict === 'no_card' ? classifyDismissReason(decision.reason) : undefined
      return {
        id: example.id,
        source: example.source,
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
        source: example.source,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
        expectedVerdict: example.expectedVerdict,
        expectedDismissReason: example.expectedDismissReason,
      }
    }
  })

  const executedCount = outcomes.filter((o) => o.status === 'ok' || o.status === 'pending').length
  const errorCount = outcomes.filter((o) => o.status === 'error').length

  const metricsBySource = {
    github: scoreSource('github', outcomes),
    market_responsive: scoreSource('market_responsive', outcomes),
  }

  // ADR §2.8 — the blended figure is REMOVED, not merely supplemented.
  // metricsPass is the AND of every source that has at least one declared
  // example (a source with zero examples has nothing to pass or fail, and
  // must not drag the flag to false by default-zero denominators).
  const activeSources = (Object.keys(metricsBySource) as Array<keyof typeof metricsBySource>).filter(
    (source) => metricsBySource[source].declaredCount > 0,
  )
  const metricsPass = activeSources.length > 0 && activeSources.every((source) => metricsBySource[source].pass)

  const artefact = {
    // Amendment B2.3 — every metric carries its denominator, the
    // corpusVersion, and the run URL, so a reviewer cites a number rather
    // than reconstructing the argument.
    corpusVersion: corpus.corpusVersion,
    // ADR §2.4.1 — recorded in that order: label commit, then cassette
    // commit. Both null until the respective commit exists.
    labelCommitSha: corpus.labelCommitSha ?? null,
    cassetteCommitSha: corpus.cassetteCommitSha ?? null,
    runUrl: runUrl(),
    generatedAt: new Date().toISOString(),
    declaredCorpusCount: declaredCount,
    executedCount,
    errorCount,
    metricsBySource,
    metricsPass,
    outcomes,
  }

  mkdirSync(resolve(process.cwd(), 'lib/signals/__fixtures__/eval'), { recursive: true })
  writeFileSync(ARTEFACT_PATH, JSON.stringify(artefact, null, 2))

  const summarize = (label: string, m: ReturnType<typeof scoreSource>) =>
    `${label}: precision=${m.cardPrecision.value.toFixed(3)} (${m.cardPrecision.numerator}/${m.cardPrecision.denominator}) ` +
    `recall=${m.cardRecall.value.toFixed(3)} (${m.cardRecall.numerator}/${m.cardRecall.denominator}) ` +
    `dismissMatch=${m.dismissReasonMatch.value.toFixed(3)} (${m.dismissReasonMatch.numerator}/${m.dismissReasonMatch.denominator}) ` +
    `pending=${m.pendingCount}`

  console.log(
    `SIGNAL3-TRIAGE-QUALITY measured (never covered): corpusVersion=${corpus.corpusVersion} ` +
      `${summarize('github', metricsBySource.github)} | ${summarize('market_responsive', metricsBySource.market_responsive)} ` +
      `run=${runUrl()}`,
  )

  if (errorCount > 0) {
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
    console.warn('::warning::eval harness: one or more sources fell below a floor — see latest-run.json metricsBySource (advisory, does not fail this step)')
  }
}

main()
