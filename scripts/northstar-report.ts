// ADR 0026 §8.5 (Session 33 J2.11) — the north-star report: learning cycles per active brand. OPS ONLY — there is
// no customer surface and no /analytics route. Read-only, service-role (like scripts/learning-report.ts).
// The number is an aggregate of counts across all brands; it never prints a business id or any text.
//
// Usage: tsx --env-file=.env.local scripts/northstar-report.ts

import { fileURLToPath } from 'node:url'
import { subDays } from 'date-fns'
import { getLearningCyclesNorthstar } from '../lib/db/campaign-retrospectives'

const TRAILING_DAYS = 30

export async function main(now: Date = new Date()): Promise<string> {
  const since = subDays(now, TRAILING_DAYS)
  const r = await getLearningCyclesNorthstar(since)
  const perBrand = r.cyclesPerActiveBrand === null ? 'n/a (no active brand)' : r.cyclesPerActiveBrand.toFixed(2)
  return [
    `Learning cycles, trailing ${TRAILING_DAYS} days`,
    `  cycles:                  ${r.cycles}`,
    `  active brands:           ${r.activeBrands}`,
    `  cycles per active brand: ${perBrand}`,
  ].join('\n')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
    .then((out) => {
      process.stdout.write(`${out}\n`)
    })
    .catch((err: unknown) => {
      process.stderr.write(`northstar-report failed: ${err instanceof Error ? err.message : String(err)}\n`)
      process.exit(1)
    })
}
