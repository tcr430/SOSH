import { defineConfig } from 'vitest/config'
import path from 'path'

// Session 22-D (MAJOR-1) — the opt-in home for the real-network
// __integration__ suites (purge-business, email round-trip, marketing route
// smoke). These are ABSENT from vitest.config.ts's default
// project (never matched by a bare `vitest run` / `npm run test:app`), so
// they cannot report a silent green-skip inside the required app-tests job.
// Run explicitly, with the suite's own env flag set:
//
//   DELETION_INTEGRATION_TEST_ENABLED=true npx vitest run --config vitest.integration.config.ts lib/deletion
//   EMAIL_INTEGRATION_TEST_ENABLED=true npx vitest run --config vitest.integration.config.ts lib/email
//   ROUTE_SMOKE_TEST_ENABLED=true npx vitest run --config vitest.integration.config.ts "app/[locale]/(marketing)"
//
// Each suite's own env flag still gates whether it exercises real
// Resend/HTTP network calls — this config only controls DISCOVERY (whether
// the file is matched at all), not the flag's runtime behaviour.
export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'app/**/__integration__/**/*.test.ts',
      'lib/**/__integration__/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**'],
    testTimeout: 30000,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
})
