import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

function collectSourceFiles(dir: string): string[] {
  const results: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      results.push(...collectSourceFiles(full))
      continue
    }
    if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      results.push(full)
    }
  }
  return results
}

// RES-CALLER-MIGRATION (ADR 0014 §2.4): every production dashboard/API call
// site must resolve the active business via getBusinessForUser, not
// getBusinessByOwner — the latter returns null for non-owner members and
// 404s them. getBusinessByOwner stays exported for owner-only service paths
// (Stripe reconciliation, etc.), but none of those currently live under
// app/ — this guard fails loudly the day a new app/ call site regresses to it.
describe('getBusinessByOwner caller migration (RES-CALLER-MIGRATION)', () => {
  it('no production file under app/ calls getBusinessByOwner', () => {
    const root = join(__dirname, '..', '..')
    const appDir = join(root, 'app')
    const files = collectSourceFiles(appDir)

    const offenders = files
      .filter((full) => /\bgetBusinessByOwner\b/.test(readFileSync(full, 'utf8')))
      .map((full) => relative(root, full))

    expect(offenders).toEqual([])
  })
})
