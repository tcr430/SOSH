import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    // Scope a bare `vitest run` to SOSH tests only, so CI runs the FULL app suite
    // (app + lib + components) WITHOUT picking up ECC/plugin test files that call
    // process.exit() (CLAUDE.md /ecc:verification-loop note). This is the single
    // source of truth for "the app suite" — app-tests.yml runs `vitest run` bare.
    include: [
      'app/**/*.test.{ts,tsx}',
      'lib/**/*.test.ts',
      'components/**/*.test.{ts,tsx}',
    ],
    exclude: ['**/node_modules/**', '**/lib/db/types.test.ts'],
    testTimeout: 15000,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
})
