import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    // Scope `vitest run` to SOSH tests only, so CI runs the FULL suite (app + lib +
    // components + the DB suite) WITHOUT picking up ECC/plugin test files that call
    // process.exit() (CLAUDE.md /ecc:verification-loop note). This is the single
    // source of truth for "the SOSH suite". supabase/__tests__ is included here so
    // db-tests.yml's `vitest run supabase/__tests__` filter has files to match — a
    // positional filter only narrows an already-included set, it doesn't add paths
    // outside `include` (session-22 B2 finding: before this line existed, db-tests.yml
    // matched ZERO files post-B1, silently, until B2's skip-guard caught it). app-tests.yml
    // stays isolated from the DB suite via package.json's `test:app` script passing
    // explicit `app lib components` filters (never a bare `vitest run`), so it never
    // picks up supabase/__tests__ even though this include now covers it.
    include: [
      'app/**/*.test.{ts,tsx}',
      'lib/**/*.test.{ts,tsx}',
      'components/**/*.test.{ts,tsx}',
      'supabase/__tests__/**/*.test.ts',
      // ADR 0023 §2.4.2 (Session 30 G1b.11) — SIGNAL-MR-CORPUS-DISCRIMINATIVE
      // is Tier 2 (a test OF scripts/eval/, never a corpus-discrimination
      // proof). Without this line, run-triage-eval.test.ts would be
      // AUTHORED-NOT-EXECUTED — package.json's test:app script also needs
      // 'scripts/eval' added to its positional filter for the same reason.
      'scripts/eval/**/*.test.ts',
    ],
    // Session 22-D (MAJOR-1) — the four real-network __integration__ suites
    // (postiz-provider, purge-business, email round-trip, marketing route
    // smoke) are opt-in only (vitest.integration.config.ts), never part of
    // the required app-tests glob. Absent, not present-but-skipped: a green
    // skip inside a required job is the exact false-green shape this ADR
    // exists to eliminate (docs/decisions/0015-test-execution-and-ci-gates.md §4).
    exclude: [
      '**/node_modules/**',
      '**/lib/db/types.test.ts',
      '**/lib/learning/classify.types.test.ts',
      '**/__integration__/**',
    ],
    testTimeout: 15000,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
})
