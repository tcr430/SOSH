import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// BACKFILL-PROVIDER-NEVER-SLEEPS (ADR 0025 §12 constraint 8, I2.3). Retry
// belongs to the orchestrator's tick cadence, never to the provider — a
// hung request is bounded by AbortSignal.timeout alone. Scoped to
// fetchRecentPosts's own method body (brace-depth extraction, same shape as
// lib/backfill/__tests__/source-scans.test.ts's extractMethodBody), not the
// whole provider file, which legitimately has no sleep elsewhere either but
// whose OTHER methods are not this constraint's concern.
const ROOT = process.cwd()

function extractMethodBody(source: string, methodName: string): string | null {
  const sigMatch = source.match(new RegExp(`\\basync\\s+${methodName}\\s*\\(`))
  if (!sigMatch || sigMatch.index === undefined) return null
  const openBraceIdx = source.indexOf('{', sigMatch.index)
  if (openBraceIdx === -1) return null
  let depth = 0
  for (let i = openBraceIdx; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(openBraceIdx, i + 1)
    }
  }
  return null
}

// The whole file, not just the one method, for the private helpers
// fetchRecentPosts calls (fetchTimelinePage, verifyReadIdentity,
// fetchRecentPostsBody) — a sleep hidden in a helper is just as real a
// violation as one inline.
const FORBIDDEN_PATTERNS = [/\bsetTimeout\s*\(/, /\bsleep\s*\(/, /\bwhile\s*\(\s*true\s*\)/]

describe('BACKFILL-PROVIDER-NEVER-SLEEPS — no sleep or retry loop in the read path', () => {
  it('twitter-provider.ts has no setTimeout/sleep/while-retry anywhere in the file (fetchRecentPosts and its private helpers)', () => {
    const file = path.join(ROOT, 'lib', 'social', 'twitter-provider.ts')
    const source = fs.readFileSync(file, 'utf8')
    const method = extractMethodBody(source, 'fetchRecentPosts')
    expect(method, 'fetchRecentPosts not found in twitter-provider.ts').not.toBeNull()

    for (const pattern of FORBIDDEN_PATTERNS) {
      expect(pattern.test(source), `${pattern} matched somewhere in twitter-provider.ts`).toBe(false)
    }
  })

  it('linkedin-provider.ts has no setTimeout/sleep/while-retry anywhere in the file', () => {
    const file = path.join(ROOT, 'lib', 'social', 'linkedin-provider.ts')
    const source = fs.readFileSync(file, 'utf8')
    for (const pattern of FORBIDDEN_PATTERNS) {
      expect(pattern.test(source), `${pattern} matched somewhere in linkedin-provider.ts`).toBe(false)
    }
  })
})
