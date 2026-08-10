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
// No `|| true` anywhere in this script or its caller.

import { readFileSync } from 'node:fs'

const MIN_CORPUS_EXAMPLES = 40
const CORPUS_PATH = 'lib/signals/__fixtures__/eval/corpus.v1.json'
const ARTEFACT_PATH = 'lib/signals/__fixtures__/eval/latest-run.json'

function checkCorpusOnly() {
  let corpus
  try {
    corpus = JSON.parse(readFileSync(CORPUS_PATH, 'utf8'))
  } catch (err) {
    console.error(`::error::assert-eval-executed: could not read/parse corpus at ${CORPUS_PATH}: ${err.message}`)
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

function checkArtefact() {
  let corpus
  let artefact
  try {
    corpus = JSON.parse(readFileSync(CORPUS_PATH, 'utf8'))
  } catch (err) {
    console.error(`::error::assert-eval-executed: could not read/parse corpus at ${CORPUS_PATH}: ${err.message}`)
    process.exit(1)
  }
  try {
    artefact = JSON.parse(readFileSync(ARTEFACT_PATH, 'utf8'))
  } catch (err) {
    console.error(`::error::assert-eval-executed: could not read/parse run artefact at ${ARTEFACT_PATH}: ${err.message}`)
    process.exit(1)
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

  if (artefact.metricsPass !== true) {
    console.error('::error::assert-eval-executed: one or more metrics fell below its floor — see latest-run.json metrics')
    failed = true
  }

  if (failed) {
    process.exit(1)
  }

  const m = artefact.metrics ?? {}
  console.log(
    `assert-eval-executed: green — corpusVersion=${artefact.corpusVersion} ` +
      `executed=${executedCount}/${declaredCount} ` +
      `precision=${m.cardPrecision?.value?.toFixed?.(3)} (${m.cardPrecision?.numerator}/${m.cardPrecision?.denominator}) ` +
      `recall=${m.cardRecall?.value?.toFixed?.(3)} (${m.cardRecall?.numerator}/${m.cardRecall?.denominator}) ` +
      `dismissMatch=${m.dismissReasonMatch?.value?.toFixed?.(3)} (${m.dismissReasonMatch?.numerator}/${m.dismissReasonMatch?.denominator}) ` +
      `run=${artefact.runUrl}`,
  )
}

const mode = process.argv[2]
if (mode === '--check-corpus-only') {
  checkCorpusOnly()
} else {
  checkArtefact()
}
