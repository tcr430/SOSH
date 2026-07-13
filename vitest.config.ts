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
      'lib/**/*.test.ts',
      'components/**/*.test.{ts,tsx}',
      'supabase/__tests__/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/lib/db/types.test.ts'],
    testTimeout: 15000,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
})
