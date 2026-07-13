#!/usr/bin/env node
// ADR 0015 §4 (CI-NO-SKIPPED-SUITE + CI-NO-SWALLOWED-FAILURE) — the skip-guard meta-test.
//
// Asserts BOTH invariants against a vitest --reporter=json --outputFile result:
//   (i)  INVISIBILITY — every test file under supabase/__tests__ must have run at least one
//        non-skipped assertion. A file with zero assertionResults, or whose assertionResults are
//        all 'skipped', is invisible — the exact false-green shape the INV-REISSUE-SAME-ROW bug
//        (21B) came from (a flag left off). Also fails if the JSON lists zero test files at all
//        under supabase/__tests__ (nothing matched the glob).
//   (ii) FAILURE — if the JSON reports any failed test, the job fails too. A suite may be RED,
//        but red must never be swallowed into green.
//
// Exits non-zero if EITHER invariant is violated. Green requires: every file visible AND zero
// failures. No `|| true` anywhere in this script or its caller (CI-NO-SWALLOWED-FAILURE) — a
// gate step that cannot fail the job is not a gate.

import { readFileSync } from 'node:fs'

const SUITE_DIR = 'supabase/__tests__'

const resultsPath = process.argv[2]
if (!resultsPath) {
  console.error('::error::usage: assert-no-empty-suite.mjs <path-to-vitest-json-output>')
  process.exit(1)
}

let report
try {
  report = JSON.parse(readFileSync(resultsPath, 'utf8'))
} catch (err) {
  console.error(`::error::could not read/parse vitest JSON output at ${resultsPath}: ${err.message}`)
  process.exit(1)
}

const testResults = Array.isArray(report.testResults) ? report.testResults : []
const suiteFiles = testResults.filter((r) => (r.name ?? r.testFilePath ?? '').split(/[\\/]/).join('/').includes(`${SUITE_DIR}/`))

let failed = false

// --- Invariant (i): INVISIBILITY ---
if (suiteFiles.length === 0) {
  console.error(`::error::skip-guard: zero test files matched under ${SUITE_DIR} — nothing ran (invisible suite, the false-green shape)`)
  failed = true
}

for (const file of suiteFiles) {
  const filePath = file.name ?? file.testFilePath
  const assertions = Array.isArray(file.assertionResults) ? file.assertionResults : []
  if (assertions.length === 0) {
    console.error(`::error::skip-guard: ${filePath} ran zero tests (invisible — not covered)`)
    failed = true
    continue
  }
  if (assertions.every((a) => a.status === 'skipped' || a.status === 'pending')) {
    console.error(`::error::skip-guard: ${filePath} — every test is skipped (invisible — not covered)`)
    failed = true
  }
}

// --- Invariant (ii): FAILURE ---
const numFailedTests = typeof report.numFailedTests === 'number' ? report.numFailedTests : 0
const failedAssertions = []
for (const file of testResults) {
  const filePath = file.name ?? file.testFilePath
  const assertions = Array.isArray(file.assertionResults) ? file.assertionResults : []
  for (const a of assertions) {
    if (a.status === 'failed') {
      failedAssertions.push(`${filePath} :: ${a.fullName ?? a.title ?? '(unnamed test)'}`)
    }
  }
}

if (numFailedTests > 0 || failedAssertions.length > 0) {
  console.error(`::error::skip-guard: ${numFailedTests || failedAssertions.length} failing test(s) — a RED suite must fail the job, never be swallowed`)
  for (const name of failedAssertions) {
    console.error(`::error::  FAILED: ${name}`)
  }
  failed = true
}

if (failed) {
  process.exit(1)
}

console.log(`skip-guard: ${suiteFiles.length} file(s) under ${SUITE_DIR} all visible, zero failures — green.`)
