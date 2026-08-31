#!/usr/bin/env node
// ADR 0021 §10.5 (Session 28 E5.8) — assert-no-empty-suite.mjs's model,
// applied to the eval harness. SIGNAL3-TRIAGE-QUALITY is MEASURED, never
// COVERED (Amendment B4) — this script is the hard-fail guard that makes
// "measured" mean something rather than a number nobody checked. HARD-FAILS,
// never defaults, on:
//   (i)   corpus file count below the declared minimum, checked BEFORE the
//         run starts (so a shrunk corpus can never silently pass) — separate
//         invocation, `--check-corpus-only`.
//   (ii)  executed-example count < declared corpus count (some examples were
//         silently dropped from the run).
//   (iii) ANY example whose status is 'error' — a THIRD, job-failing state,
//         never coerced into a verdict (an all-erroring run must not report
//         plausible-looking numbers while measuring nothing).
//   (iv)  D1 (Session 30-D, BLOCKER-1) — ANY example whose status is
//         'pending' (no cassette yet, ADR 0023 §2.4.1). executedCount no
//         longer counts 'pending' as executed (run-triage-eval.ts), so (ii)
//         already catches this on its own; this check exists to name the
//         shortfall explicitly, exactly as (iii) names 'error' explicitly,
//         rather than relying solely on the generic count-mismatch message.
//         The interim label-before-cassette state must never be expressed
//         by inflating the number this false-green guard reads.
// No `|| true` anywhere in this script or its caller.
//
// Session 28-D, D4 (MAJOR-4 closed, ADR 0021 §10.4 / Amendment B3, B3.1) —
// the split is the point: this script now has THREE modes, one per CI check:
//   --check-corpus-only  pre-run corpus-size guard (unchanged behaviour)
//   (default)             the `eval-reported` check — (i)/(ii)/(iii) above,
//                          JOB-FAILING. Deliberately does NOT read
//                          metricsPass: a purely statistical threshold dip
//                          must never fail the promotable check.
//   --check-threshold      the `eval-threshold` check — reports metricsPass,
//                          ADVISORY FOREVER, never exits non-zero.
// (i)/(ii)/(iii) are B2.4's false-green guard and are unchanged by this
// split — moving them to advisory alongside metricsPass would hand the
// harness the exact failure ADR 0015 exists to prevent.

import { readFileSync, existsSync } from 'node:fs'

const MIN_CORPUS_EXAMPLES = 40
const ARTEFACT_PATH = 'lib/signals/__fixtures__/eval/latest-run.json'

// NIT-4 (D4) — previously hardcoded to 'corpus.v1.json' at this line, which
// would leave the pre-run minimum reading a stale file once a v2 corpus
// shipped. Resolved instead from the corpusVersion recorded in the LAST
// artefact (checked into the repo from the prior run) — falling back to v1
// only when no prior artefact exists (the first-ever run).
function resolveCorpusPath() {
  let version = 1
  if (existsSync(ARTEFACT_PATH)) {
    try {
      const prior = JSON.parse(readFileSync(ARTEFACT_PATH, 'utf8'))
      if (typeof prior.corpusVersion === 'number') version = prior.corpusVersion
    } catch {
      // Unreadable/malformed prior artefact — fall back to v1 rather than
      // hard-failing a pre-run check on a file this script does not own.
    }
  }
  return `lib/signals/__fixtures__/eval/corpus.v${version}.json`
}

function checkCorpusOnly() {
  const corpusPath = resolveCorpusPath()
  let corpus
  try {
    corpus = JSON.parse(readFileSync(corpusPath, 'utf8'))
  } catch (err) {
    console.error(`::error::assert-eval-executed: could not read/parse corpus at ${corpusPath}: ${err.message}`)
    process.exit(1)
  }
  const count = Array.isArray(corpus.examples) ? corpus.examples.length : 0
  if (count < MIN_CORPUS_EXAMPLES) {
    console.error(
      `::error::assert-eval-executed: corpus has ${count} example(s), below the minimum of ${MIN_CORPUS_EXAMPLES} — run aborted before it started`,
    )
    process.exit(1)
  }
  console.log(`assert-eval-executed: corpus has ${count} example(s) (>= ${MIN_CORPUS_EXAMPLES}) — pre-run check green.`)
}

// The `eval-reported` check (default mode) — a deterministic, binary fact
// about EXECUTION, never about passing (Amendment B3.1). metricsPass is
// deliberately absent from this function.
function checkArtefactHard() {
  const corpusPath = resolveCorpusPath()
  let corpus
  let artefact
  try {
    corpus = JSON.parse(readFileSync(corpusPath, 'utf8'))
  } catch (err) {
    console.error(`::error::assert-eval-executed: could not read/parse corpus at ${corpusPath}: ${err.message}`)
    process.exit(1)
  }
  try {
    artefact = JSON.parse(readFileSync(ARTEFACT_PATH, 'utf8'))
  } catch (err) {
    console.error(`::error::assert-eval-executed: could not read/parse run artefact at ${ARTEFACT_PATH}: ${err.message}`)
    process.exit(1)
  }

  if (artefact.applicable === false) {
    console.log(`assert-eval-executed: not applicable — ${artefact.reason ?? '(no reason recorded)'}`)
    return
  }

  const declaredCount = Array.isArray(corpus.examples) ? corpus.examples.length : 0
  let failed = false

  if (declaredCount < MIN_CORPUS_EXAMPLES) {
    console.error(
      `::error::assert-eval-executed: corpus has ${declaredCount} example(s), below the minimum of ${MIN_CORPUS_EXAMPLES}`,
    )
    failed = true
  }

  const executedCount = typeof artefact.executedCount === 'number' ? artefact.executedCount : -1
  if (executedCount < declaredCount) {
    console.error(
      `::error::assert-eval-executed: executed ${executedCount} example(s) but the corpus declares ${declaredCount} — some examples were silently dropped from the run`,
    )
    failed = true
  }

  const outcomes = Array.isArray(artefact.outcomes) ? artefact.outcomes : []

  // D1 (Session 30-D, BLOCKER-1) — a non-zero pending count is a SHORTFALL
  // against declaredCorpusCount, hard-failed exactly like 'error'. Read from
  // outcomes[] directly (not the artefact's top-level pendingCount field)
  // so this check keeps working even against an older artefact shape that
  // never wrote that field.
  const pending = outcomes.filter((o) => o.status === 'pending')
  if (pending.length > 0) {
    console.error(
      `::error::assert-eval-executed: ${pending.length} example(s) are 'pending' (no cassette yet, ADR 0023 §2.4.1) — a shortfall against the declared corpus count, exactly like an error; the interim label-before-cassette state must never be expressed by inflating executedCount`,
    )
    for (const o of pending) {
      console.error(`::error::  PENDING: ${o.id}`)
    }
    failed = true
  }

  const errored = outcomes.filter((o) => o.status === 'error')
  if (errored.length > 0) {
    console.error(
      `::error::assert-eval-executed: ${errored.length} example(s) errored (never coerced into a verdict) — an all-erroring run must not report plausible numbers while measuring nothing`,
    )
    for (const o of errored) {
      console.error(`::error::  ERRORED: ${o.id} — ${o.error ?? '(no error message)'}`)
    }
    failed = true
  }

  if (!artefact.runUrl) {
    console.error('::error::assert-eval-executed: artefact carries no runUrl — eval-reported requires the metrics + run URL to have been produced')
    failed = true
  }

  if (failed) {
    process.exit(1)
  }

  console.log(
    `assert-eval-executed: eval-reported green — corpusVersion=${artefact.corpusVersion} ` +
      `executed=${executedCount}/${declaredCount} run=${artefact.runUrl}`,
  )
}

// The `eval-threshold` check — ADVISORY FOREVER (Amendment B3). Reports
// metricsPass and the metric numbers but NEVER exits non-zero: "the metrics
// themselves never block a merge."
function checkThreshold() {
  let artefact
  try {
    artefact = JSON.parse(readFileSync(ARTEFACT_PATH, 'utf8'))
  } catch (err) {
    console.error(`::warning::assert-eval-executed (threshold): could not read/parse run artefact at ${ARTEFACT_PATH}: ${err.message}`)
    return
  }

  if (artefact.applicable === false) {
    console.log(`assert-eval-executed (threshold): not applicable — ${artefact.reason ?? '(no reason recorded)'}`)
    return
  }

  // ADR 0023 §2.8/§10.5 (Session 30 G1b.12) — the blended `metrics` object
  // is REMOVED, not merely supplemented, replaced by `metricsBySource`
  // (one entry per source, each carrying its own numerator/denominator/
  // floor/sigma). This function stays advisory-only either way.
  const bySource = artefact.metricsBySource ?? {}
  const sourceSummary = (name, m) =>
    `${name}[precision=${m?.cardPrecision?.value?.toFixed?.(3)} (${m?.cardPrecision?.numerator}/${m?.cardPrecision?.denominator}) ` +
    `recall=${m?.cardRecall?.value?.toFixed?.(3)} (${m?.cardRecall?.numerator}/${m?.cardRecall?.denominator}) ` +
    `dismissMatch=${m?.dismissReasonMatch?.value?.toFixed?.(3)} (${m?.dismissReasonMatch?.numerator}/${m?.dismissReasonMatch?.denominator})]`
  const summary =
    `corpusVersion=${artefact.corpusVersion} ` +
    `${sourceSummary('github', bySource.github)} ${sourceSummary('market_responsive', bySource.market_responsive)} ` +
    `run=${artefact.runUrl}`

  if (artefact.metricsPass !== true) {
    console.warn(`::warning::assert-eval-executed (threshold): one or more metrics fell below its floor — ${summary}`)
  } else {
    console.log(`assert-eval-executed (threshold): green — ${summary}`)
  }
  // No process.exit(1) anywhere in this function — advisory, permanently.
}

const mode = process.argv[2]
if (mode === '--check-corpus-only') {
  checkCorpusOnly()
} else if (mode === '--check-threshold') {
  checkThreshold()
} else {
  checkArtefactHard()
}
