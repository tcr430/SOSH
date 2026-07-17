import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { bulkApproveDraftPosts, BULK_APPROVE_ID_CAP } from './posts'

// Session 22-G NEW-13: the sibling BULK_APPROVE_ID_CAP guard in
// app/[locale]/(dashboard)/campaigns/[id]/posts/actions.test.ts mocks
// @/lib/db/posts wholesale, including BULK_APPROVE_ID_CAP itself — so its
// URL-budget assertion reads the mock's hardcoded 200, never the shipped
// constant, and stays green even after the shipped cap is bumped to a value
// that guarantees a 414 (verified: bumping lib/db/posts.ts's shipped
// BULK_APPROVE_ID_CAP to 400 left that suite green). This file does not mock
// @/lib/db/posts or @supabase/supabase-js: it imports the real
// BULK_APPROVE_ID_CAP and drives the real bulkApproveDraftPosts against a
// real PostgrestFilterBuilder (only the network `fetch` is swapped out), so
// the request line asserted on here is the one supabase-js actually
// generates — including its real query-string encoding — rather than a
// hand-transcribed string literal that a future predicate change to
// bulkApproveDraftPosts could silently drift away from.
const CAMPAIGN_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const BUSINESS_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

describe('bulkApproveDraftPosts URL budget (Session 22-G NEW-13)', () => {
  it(`the real PostgREST request line at BULK_APPROVE_ID_CAP (${BULK_APPROVE_ID_CAP}) stays under the ~8 KB request-line budget (ADR 0014 §A1.1/§A1.2)`, async () => {
    let capturedUrl: string | undefined
    const client = createClient('https://example.supabase.co', 'anon-key', {
      global: {
        fetch: async (input: RequestInfo | URL) => {
          capturedUrl = typeof input === 'string' ? input : input.toString()
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        },
      },
    })

    const atCap = Array.from(
      { length: BULK_APPROVE_ID_CAP },
      (_, i) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`,
    )

    await bulkApproveDraftPosts(client, CAMPAIGN_ID, atCap, BUSINESS_ID)

    expect(capturedUrl).toBeDefined()
    const requestLine = new URL(capturedUrl!).pathname + new URL(capturedUrl!).search
    expect(requestLine.length).toBeLessThan(8000)
  })

  // Floor guard (per Session 22-G NEW-13): even if the derivation above ever
  // becomes impractical to keep, the shipped constant itself must stay under
  // the measured ~206-217 id cliff (session-22f-reviewer.md) — this assertion
  // reads the real export, not a test-local mock.
  it('BULK_APPROVE_ID_CAP stays at or below the measured 8 KB-budget cliff (~206 ids)', () => {
    expect(BULK_APPROVE_ID_CAP).toBeLessThanOrEqual(205)
  })
})
