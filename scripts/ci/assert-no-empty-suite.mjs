#!/usr/bin/env node
// ADR 0015 §4 (CI-NO-SKIPPED-SUITE + CI-NO-SWALLOWED-FAILURE) — the skip-guard meta-test.
//
// Asserts BOTH invariants against a vitest --reporter=json --outputFile result, scoped to one or
// more target directories:
//   (i)  INVISIBILITY — every test file under a target directory must have run at least one
//        non-skipped assertion. A file with zero assertionResults, or whose assertionResults are
//        all 'skipped'/'pending', is invisible — the exact false-green shape the INV-REISSUE-SAME-ROW
//        bug (21B) came from (a flag left off). Also fails if a target directory matched zero test
//        files at all (nothing matched the glob for that directory — the whole-suite-disappeared
//        shape session-22 B2 found in supabase/__tests__, now guarded generically).
//   (ii) FAILURE — if the JSON reports any failed test, the job fails too. A suite may be RED,
//        but red must never be swallowed into green.
//
// Exits non-zero if EITHER invariant is violated. Green requires: every file visible AND zero
// failures. No `|| true` anywhere in this script or its caller (CI-NO-SWALLOWED-FAILURE) — a
// gate step that cannot fail the job is not a gate.
//
// Usage: assert-no-empty-suite.mjs <path-to-vitest-json-output> [targetDir...]
// With no targetDir args, defaults to ['supabase/__tests__'] (db-tests.yml's original call shape).
// app-tests.yml passes its own target dirs (app, lib, components) — session 22-D (MAJOR-1) extends
// the guard from db-tests-only to app-tests, now that the four real-network __integration__ suites
// are absent from app-tests' glob rather than present-but-skipped: with no allowlist needed, nothing
// inside a target dir may be empty.

import { readFileSync } from 'node:fs'

const resultsPath = process.argv[2]
if (!resultsPath) {
  console.error('::error::usage: assert-no-empty-suite.mjs <path-to-vitest-json-output> [targetDir...]')
  process.exit(1)
}

const targetDirArgs = process.argv.slice(3)
const SUITE_DIRS = targetDirArgs.length > 0 ? targetDirArgs : ['supabase/__tests__']

let report
try {
  report = JSON.parse(readFileSync(resultsPath, 'utf8'))
} catch (err) {
  console.error(`::error::could not read/parse vitest JSON output at ${resultsPath}: ${err.message}`)
  process.exit(1)
}

const testResults = Array.isArray(report.testResults) ? report.testResults : []
function normalizedPath(r) {
  return (r.name ?? r.testFilePath ?? '').split(/[\\/]/).join('/')
}
const suiteFiles = testResults.filter((r) => {
  const p = normalizedPath(r)
  return SUITE_DIRS.some((dir) => p.includes(`${dir}/`) || p.includes(`/${dir}/`))
})

let failed = false

// --- Invariant (i): INVISIBILITY ---
if (suiteFiles.length === 0) {
  console.error(`::error::skip-guard: zero test files matched under [${SUITE_DIRS.join(', ')}] — nothing ran (invisible suite, the false-green shape)`)
  failed = true
}

for (const dir of SUITE_DIRS) {
  const matchedDir = suiteFiles.some((r) => {
    const p = normalizedPath(r)
    return p.includes(`${dir}/`) || p.includes(`/${dir}/`)
  })
  if (!matchedDir) {
    console.error(`::error::skip-guard: zero test files matched under ${dir} — the whole directory disappeared from the run (invisible, the session-22 B2 shape)`)
    failed = true
  }
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

// H3 (Session 26-D correction) — the skip-guard's file count alone forced
// every reviewer to independently read this script plus cross-check
// `git ls-tree` to establish an executed-assertion count (the D2.11 report
// did exactly this, then still wrote "N=23 executed" — a FILE count, not a
// test count — in its own commit subject, see the D5 appendix). Echoing the
// JSON reporter's own numTotalTests/numPassedTests alongside the existing
// file count lets a reviewer cite a number directly instead of
// reconstructing the argument. This does NOT change what the guard
// ENFORCES: the invariants above (invisibility, failure) are computed
// exactly as before; this line only adds visibility into what already
// passed.
const numTotalTests = typeof report.numTotalTests === 'number' ? report.numTotalTests : suiteFiles.reduce((n, f) => n + (Array.isArray(f.assertionResults) ? f.assertionResults.length : 0), 0)
const numPassedTests = typeof report.numPassedTests === 'number' ? report.numPassedTests : suiteFiles.reduce((n, f) => n + (Array.isArray(f.assertionResults) ? f.assertionResults.filter((a) => a.status === 'passed').length : 0), 0)

console.log(`skip-guard: ${suiteFiles.length} file(s) under [${SUITE_DIRS.join(', ')}] all visible, zero failures — green. (${numPassedTests}/${numTotalTests} tests passed)`)
