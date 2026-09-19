import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// SOCIAL-WORKER-UNCHANGED (ADR 0028 build-guide N2.13, L-1). L-1 requires
// lib/publishing/orchestrator.ts's status machine, retry policy and
// idempotency handling to be inherited unchanged from ADR 0002/0005.
// ACCOUNT RESOLUTION IS THE ONE PERMITTED CHANGE (ADR 0028 §5.3, N2.5): the
// publish path now resolves posts.social_account_id (or the platform's
// single active account) via resolvePublishAccount before publishing,
// rather than assuming one hardcoded account. This scan asserts every other
// literal invariant is still present, so an edit that touches the retry
// policy — not just account resolution — reddens it.
//
// Demonstrated to redden: temporarily changed the NETWORK backoff formula
// from `BACKOFF * 2 ** post.publish_attempts` to a linear `BACKOFF *
// post.publish_attempts`, confirmed this suite's second test failed naming
// the exact assertion, then reverted (see this step's commit message).

const FILE = path.join(process.cwd(), 'lib', 'publishing', 'orchestrator.ts')

function source(): string {
  const content = fs.readFileSync(FILE, 'utf8')
  expect(content.length, 'orchestrator.ts is empty — the scan target moved or was deleted').toBeGreaterThan(0)
  return content
}

describe('SOCIAL-WORKER-UNCHANGED', () => {
  it('the exact eight-case error switch in handleError is unchanged', () => {
    const src = source()
    const cases = [...src.matchAll(/case '([A-Z_]+)':/g)].map((m) => m[1])
    expect(cases).toEqual([
      'TOKEN_EXPIRED',
      'RATE_LIMITED',
      'NETWORK',
      'TOKEN_REVOKED',
      'PLATFORM_REJECTED',
      'NOT_IMPLEMENTED',
      'PROVIDER_NOT_CONFIGURED',
      'UNKNOWN',
    ])
  })

  it('the exponential backoff formula for NETWORK retries is unchanged', () => {
    const src = source()
    expect(src).toContain('BACKOFF * 2 ** post.publish_attempts')
  })

  it('the four state-transition primitives (claim/complete/fail/requeue) are still referenced', () => {
    const src = source()
    for (const fn of ['claimPostsForPublishing', 'publishPostComplete', 'markPostFailed', 'requeueScheduledPost']) {
      expect(src, `${fn} no longer referenced — a state-transition primitive changed`).toContain(fn)
    }
  })

  it('the guard-rejected self-healing log line (atomic UPDATE guard, not read-then-update) is unchanged', () => {
    const src = source()
    expect(src).toContain('publish.complete.guard_rejected')
  })

  it('resolvePublishAccount is present — the one permitted change (N2.5 account resolution)', () => {
    const src = source()
    expect(src).toContain('resolvePublishAccount')
  })
})
