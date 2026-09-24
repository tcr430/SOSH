import { describe, it, expect } from 'vitest'
import { createSequentialMockClient, createMockClient } from './__test-utils__/mock-client'
import { setPostClaimResolution, listClaimChecksByPostIds } from './posts'
import { contentFingerprint, withContentFingerprint } from '@/lib/campaigns/claim-fingerprint'
import type { ClaimResolution, PersistedClaimCheck } from './types'

// ADR 0027 §4.8 — Session 34-D D7 (MAJOR-3). Read-side invalidation: a claim check is returned, and a resolution is
// recorded, ONLY for the text the check was computed on. The check stores SPANS into posts.content; after an edit
// (posts/actions.ts updatePostContentAction and calendar/actions.ts — both call updatePostContent) or a regenerate
// (updatePostContentAndMetadata) the old offsets would slice the NEW text, so the gate would label arbitrary
// substrings and miss the real claims. Absence reads "not checked", never "clean".
//
// SHARED-FUNCTION CALLERS (git grep at D7):
//   listClaimChecksByPostIds     -> approvals/page.tsx (ONE production caller)          this file + approvals/page.test.tsx
//   setPostClaimResolution       -> approvals/claim-actions.ts (ONE)                     this file + claim-actions.test.ts
//   updatePostContent            -> campaigns/[id]/posts/actions.ts:206, calendar/actions.ts:262 (TWO) — neither
//                                   touches ai_generation_metadata; both are covered by the READ side, proved against
//                                   live Postgres in supabase/__tests__/claim-check-fingerprint.test.ts
//   updatePostContentAndMetadata -> campaigns/[id]/posts/actions.ts:383 (regeneratePostAction, ONE) — actions.test.ts

const RESOLUTION: ClaimResolution = { kind: 'accepted', at: '2026-09-24T10:00:00Z', by: 'user-1' }
const ORIGINAL = 'We cut churn by 42% in Q3. The rest is plain.'
const EDITED = 'We cut churn by 42% in Q3. The rest is plain. (edited)'
const CHECK: PersistedClaimCheck = withContentFingerprint(
  { status: 'checked', claims: [{ outcome: 'unsupported', span: { start: 0, end: 26 } }] },
  ORIGINAL,
)
const calls = (fn: unknown): unknown[][] => (fn as { mock: { calls: unknown[][] } }).mock.calls

describe('listClaimChecksByPostIds — a check is valid only for the text it was computed on', () => {
  it('selects the content it must compare against', async () => {
    const { client, builder } = createMockClient([], null)
    await listClaimChecksByPostIds(client, ['a'])
    expect(builder.select).toHaveBeenCalledWith('id, content, ai_generation_metadata')
  })

  it('an UNEDITED post returns its check, unchanged (fingerprint present and matching)', async () => {
    const { client } = createMockClient([{ id: 'a', content: ORIGINAL, ai_generation_metadata: { claimCheck: CHECK } }], null)
    expect(await listClaimChecksByPostIds(client, ['a'])).toEqual({ a: CHECK })
  })

  it('a post EDITED after generation returns NO check — the old spans never reach the reviewer', async () => {
    const { client } = createMockClient([{ id: 'a', content: EDITED, ai_generation_metadata: { claimCheck: CHECK } }], null)
    expect(await listClaimChecksByPostIds(client, ['a'])).toEqual({})
  })

  it('a REGENERATED post (new text; the old check rode along, or was dropped) returns NO check either way', async () => {
    const { client } = createMockClient(
      [
        { id: 'rode-along', content: 'A completely different regenerated draft.', ai_generation_metadata: { claimCheck: CHECK } },
        { id: 'dropped', content: 'A completely different regenerated draft.', ai_generation_metadata: { promptId: 'p' } },
      ],
      null,
    )
    expect(await listClaimChecksByPostIds(client, ['rode-along', 'dropped'])).toEqual({})
  })

  it('a K2.9-era check with NO fingerprint reads "not checked" (pre-launch: no customer rows exist)', async () => {
    const legacy: PersistedClaimCheck = { status: 'checked', claims: [{ outcome: 'unsupported', span: { start: 0, end: 5 } }] }
    const { client } = createMockClient([{ id: 'a', content: ORIGINAL, ai_generation_metadata: { claimCheck: legacy } }], null)
    expect(await listClaimChecksByPostIds(client, ['a'])).toEqual({})
  })

  it('a stale `no_claims` / `no_corpus` verdict is invalidated too — not only `checked`', async () => {
    const noClaims = withContentFingerprint({ status: 'no_claims' }, ORIGINAL)
    const noCorpus = withContentFingerprint({ status: 'no_corpus' }, ORIGINAL)
    const { client } = createMockClient(
      [
        { id: 'a', content: EDITED, ai_generation_metadata: { claimCheck: noClaims } },
        { id: 'b', content: EDITED, ai_generation_metadata: { claimCheck: noCorpus } },
        { id: 'c', content: ORIGINAL, ai_generation_metadata: { claimCheck: noClaims } },
      ],
      null,
    )
    expect(Object.keys(await listClaimChecksByPostIds(client, ['a', 'b', 'c']))).toEqual(['c'])
  })

  it("each post is judged against ITS OWN content — one edited post does not hide a neighbour's valid check", async () => {
    const { client } = createMockClient(
      [
        { id: 'a', content: EDITED, ai_generation_metadata: { claimCheck: CHECK } },
        { id: 'b', content: ORIGINAL, ai_generation_metadata: { claimCheck: CHECK } },
      ],
      null,
    )
    expect(Object.keys(await listClaimChecksByPostIds(client, ['a', 'b']))).toEqual(['b'])
  })
})

describe('setPostClaimResolution — no resolution is ever written onto stale spans', () => {
  const readRow = (content: string, claimCheck: PersistedClaimCheck | undefined) => ({
    data: { content, ai_generation_metadata: { promptId: 'p', ...(claimCheck ? { claimCheck } : {}) }, updated_at: '2026-09-24T09:00:00Z' },
    error: null,
  })

  it('a check that matches the current text is resolved as before (positive control)', async () => {
    const { client, builders } = createSequentialMockClient([readRow(ORIGINAL, CHECK), { data: { id: 'post-1' }, error: null }])
    expect(await setPostClaimResolution(client, 'post-1', 0, RESOLUTION)).toBe('ok')
    expect(calls(builders[1].update)).toHaveLength(1)
  })

  it("a check computed on DIFFERENT text is refused 'not_checked' and NOTHING is written", async () => {
    const { client, from } = createSequentialMockClient([readRow(EDITED, CHECK)])
    expect(await setPostClaimResolution(client, 'post-1', 0, RESOLUTION)).toBe('not_checked')
    expect(from).toHaveBeenCalledTimes(1) // the read only — no write was attempted
  })

  it("a check with NO fingerprint is refused 'not_checked' and nothing is written", async () => {
    const legacy: PersistedClaimCheck = { status: 'checked', claims: [{ outcome: 'unsupported', span: { start: 0, end: 5 } }] }
    const { client, from } = createSequentialMockClient([readRow(ORIGINAL, legacy)])
    expect(await setPostClaimResolution(client, 'post-1', 0, RESOLUTION)).toBe('not_checked')
    expect(from).toHaveBeenCalledTimes(1)
  })

  it('the fingerprint is preserved through a resolution write (the check stays valid for its own text)', async () => {
    const { client, builders } = createSequentialMockClient([readRow(ORIGINAL, CHECK), { data: { id: 'post-1' }, error: null }])
    await setPostClaimResolution(client, 'post-1', 0, RESOLUTION)
    const written = calls(builders[1].update)[0][0] as { ai_generation_metadata: { claimCheck: { contentFingerprint: string } } }
    expect(written.ai_generation_metadata.claimCheck.contentFingerprint).toBe(contentFingerprint(ORIGINAL))
  })
})
