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
//
// D1 (Session 30-D, MINOR-2) — the paragraph above is bootstrap-only and is
// no longer true of the whole corpus: ADR 0023's market_responsive slice
// (Session 30 G1b.13) is now a MODEL-AUTHORED live triage run scored against
// founder-authored labels, not a hand-authored cassette scored against its
// own author's labels. It does NOT score close to 1.0 by construction — the
// live run measured 0/24 recall on that slice. Only the github slice above
// still carries the bootstrap ceiling described above; market_responsive is
// the harness's first real, non-tautological measurement (Tier E, ADR 0015
// Amendment B4), and its numbers are reported exactly as measured.

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
  // D1 (BLOCKER-1, MINOR-5) — null, never 0, when the denominator is 0: an
  // unscored metric is UNKNOWN, not a measured zero, and must not print or
  // serialise as if "the model scored 0%" were an observed fact.
  value: number | null
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
// denominator — they have produced no actual/decision to score.
//
// D1 (Session 30-D, BLOCKER-1) — 'pending' is NOT folded into executedCount
// here. It used to be (executedCount: ok.length + pending.length), which let
// assert-eval-executed.mjs's "silently dropped" check pass even when every
// example in a source was pending: stripping every cassette from the corpus
// left executedCount === declaredCorpusCount (all 'pending'), a textbook
// ADR 0015 §1(b) FALSE-GREEN on the exact check meant to catch it. pending is
// now its own reported count (pendingCount) and assert-eval-executed.mjs
// treats a non-zero pendingCount as a hard-fail shortfall, exactly like
// 'error' — never expressed by inflating executedCount.
function scoreSource(source: CorpusSource, outcomes: ExampleOutcome[]) {
  const sourceOutcomes = outcomes.filter((o) => o.source === source)
  const ok = sourceOutcomes.filter((o) => o.status === 'ok')
  const pending = sourceOutcomes.filter((o) => o.status === 'pending')
  const errored = sourceOutcomes.filter((o) => o.status === 'error')

  const predictedCard = ok.filter((o) => o.actualVerdict === 'card')
  const truePositives = predictedCard.filter((o) => o.expectedVerdict === 'card').length
  const precisionDenominator = predictedCard.length
  // D1 (MINOR-5) — null, not 0, when nothing was scored: a source that
  // predicted zero cards has an UNDEFINED precision, not a measured 0%.
  const precision = precisionDenominator > 0 ? truePositives / precisionDenominator : null

  const expectedCard = ok.filter((o) => o.expectedVerdict === 'card')
  const recallDenominator = expectedCard.length
  const recallHits = expectedCard.filter((o) => o.actualVerdict === 'card').length
  const recall = recallDenominator > 0 ? recallHits / recallDenominator : null

  const expectedNoCard = ok.filter((o) => o.expectedVerdict === 'no_card' && o.expectedDismissReason)
  const dismissMatchDenominator = expectedNoCard.length
  const dismissMatchHits = expectedNoCard.filter((o) => o.actualDismissReason === o.expectedDismissReason).length
  const dismissMatchRate = dismissMatchDenominator > 0 ? dismissMatchHits / dismissMatchDenominator : null

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

  // D1 (Session 30-D, BLOCKER-1) — a metric with a zero denominator has
  // scored NOTHING and is UNKNOWN, never a pass. The previous
  // `m.denominator === 0 || ...` early-return-true let a source that
  // predicted/expected nothing report as passing — concretely,
  // market_responsive's cardPrecision denominator is 0 right now (the model
  // carded nothing), and that used to be recorded as a precision PASS. An
  // unknown metric fails this check; it is reported (not silently green)
  // via metricsPass/pass, both of which stay advisory-only (checkThreshold
  // never exits non-zero) — this only changes what "green" means, never
  // whether the check can block a merge.
  const metricPasses = (m: SourceMetric) => m.value !== null && m.value >= m.floor
  const pass = metricPasses(cardPrecision) && metricPasses(cardRecall) && metricPasses(dismissReasonMatch)

  return {
    declaredCount: sourceOutcomes.length,
    // D1 (BLOCKER-1) — 'ok' only; pending is reported separately below and
    // is no longer folded into this count (see the comment above this
    // function for why that used to be a false-green).
    executedCount: ok.length,
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

  // D1 (BLOCKER-1) — executedCount counts 'ok' ONLY; pendingCount is its own
  // reported field. See the comment above scoreSource for why folding
  // pending into executedCount was a false-green.
  const executedCount = outcomes.filter((o) => o.status === 'ok').length
  const pendingCount = outcomes.filter((o) => o.status === 'pending').length
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
    pendingCount,
    errorCount,
    metricsBySource,
    metricsPass,
    outcomes,
  }

  mkdirSync(resolve(process.cwd(), 'lib/signals/__fixtures__/eval'), { recursive: true })
  writeFileSync(ARTEFACT_PATH, JSON.stringify(artefact, null, 2))

  // D1 (MINOR-5) — value is null on a zero denominator; format as the
  // literal string 'null' rather than crashing .toFixed on null.
  const fmt = (v: number | null) => (v === null ? 'null' : v.toFixed(3))
  const summarize = (label: string, m: ReturnType<typeof scoreSource>) =>
    `${label}: precision=${fmt(m.cardPrecision.value)} (${m.cardPrecision.numerator}/${m.cardPrecision.denominator}) ` +
    `recall=${fmt(m.cardRecall.value)} (${m.cardRecall.numerator}/${m.cardRecall.denominator}) ` +
    `dismissMatch=${fmt(m.dismissReasonMatch.value)} (${m.dismissReasonMatch.numerator}/${m.dismissReasonMatch.denominator}) ` +
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
