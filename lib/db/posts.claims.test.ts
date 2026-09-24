import { describe, it, expect } from 'vitest'
import { createSequentialMockClient, createMockClient } from './__test-utils__/mock-client'
import { setPostClaimResolution, listClaimChecksByPostIds } from './posts'
import type { ClaimResolution, PersistedClaimCheck } from './types'
import { contentFingerprint } from '@/lib/campaigns/claim-fingerprint'

// ADR 0027 §4.8 (Session 34 K2.10). What a HUMAN does about a flagged claim is recorded beside the claim in
// posts.ai_generation_metadata.claimCheck — NEVER in posts.content (AGENCY-CLAIMS-FLAGGED-NEVER-EDITED).
//
// SHARED-FUNCTION CALLERS: setPostClaimResolution has ONE production caller, approvals/claim-actions.ts
// (claim-actions.test.ts). listClaimChecksByPostIds has ONE, approvals/page.tsx (page.test.tsx). posts.ts's other
// functions and callers are unchanged.

const RESOLUTION: ClaimResolution = { kind: 'accepted', at: '2026-09-24T10:00:00Z', by: 'user-1' }
// Session 34-D D7 (MAJOR-3): a check is valid only for the text it was computed on, so a valid fixture carries the
// post's content AND the fingerprint of it.
const CONTENT = 'Cut churn 42% fastest ever'
const CHECK: PersistedClaimCheck = {
  contentFingerprint: contentFingerprint(CONTENT),
  status: 'checked',
  claims: [
    { outcome: 'unsupported', span: { start: 0, end: 5 } },
    { outcome: 'fabricated', span: { start: 6, end: 9 } },
  ],
}
const readRow = (over: Record<string, unknown> = {}) => ({
  data: { content: CONTENT, ai_generation_metadata: { promptId: 'p', rationale: 'r', claimCheck: CHECK }, updated_at: '2026-09-24T09:00:00Z', ...over },
  error: null,
})
// The shared mock builder exposes its chain methods as `unknown`.
const calls = (fn: unknown): unknown[][] => (fn as { mock: { calls: unknown[][] } }).mock.calls

describe('setPostClaimResolution', () => {
  it('merges the resolution into ONE claim, keeps every other metadata key and claim, and NEVER writes content', async () => {
    const { client, builders } = createSequentialMockClient([readRow(), { data: { id: 'post-1' }, error: null }])
    const outcome = await setPostClaimResolution(client, 'post-1', 1, RESOLUTION)
    expect(outcome).toBe('ok')

    const updateArg = calls(builders[1].update)[0][0] as { ai_generation_metadata: { promptId: string; rationale: string; claimCheck: { claims: unknown[] } } }
    expect(Object.keys(updateArg)).toEqual(['ai_generation_metadata'])
    expect(updateArg).not.toHaveProperty('content')
    expect(updateArg.ai_generation_metadata.promptId).toBe('p')
    expect(updateArg.ai_generation_metadata.rationale).toBe('r')
    expect(updateArg.ai_generation_metadata.claimCheck.claims).toEqual([
      { outcome: 'unsupported', span: { start: 0, end: 5 } },
      { outcome: 'fabricated', span: { start: 6, end: 9 }, resolution: RESOLUTION },
    ])
  })

  it('the write is GUARDED on updated_at (two reviewers must not silently discard each other)', async () => {
    const { client, builders } = createSequentialMockClient([readRow(), { data: { id: 'post-1' }, error: null }])
    await setPostClaimResolution(client, 'post-1', 0, RESOLUTION)
    expect(builders[1].eq).toHaveBeenCalledWith('id', 'post-1')
    expect(builders[1].eq).toHaveBeenCalledWith('updated_at', '2026-09-24T09:00:00Z')
  })

  it("a lost race (the guarded UPDATE matched zero rows) is 'conflict', not a silent overwrite", async () => {
    const { client } = createSequentialMockClient([readRow(), { data: null, error: null }])
    expect(await setPostClaimResolution(client, 'post-1', 0, RESOLUTION)).toBe('conflict')
  })

  it("'not_found' when the post does not exist (or is soft-deleted), and no write is attempted", async () => {
    const { client, from } = createSequentialMockClient([{ data: null, error: null }])
    expect(await setPostClaimResolution(client, 'post-x', 0, RESOLUTION)).toBe('not_found')
    expect(from).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['no claimCheck at all', { ai_generation_metadata: { promptId: 'p' } }],
    ['a null metadata column', { ai_generation_metadata: null }],
    ['a no_corpus verdict', { ai_generation_metadata: { claimCheck: { status: 'no_corpus' } } }],
    ['a no_claims verdict', { ai_generation_metadata: { claimCheck: { status: 'no_claims' } } }],
  ])("'not_checked' for %s (nothing to resolve), and no write is attempted", async (_label, over) => {
    const { client, from } = createSequentialMockClient([readRow(over)])
    expect(await setPostClaimResolution(client, 'post-1', 0, RESOLUTION)).toBe('not_checked')
    expect(from).toHaveBeenCalledTimes(1)
  })

  it.each([[-1], [2], [99], [1.5], [Number.NaN]])("'no_such_claim' for index %s, with no write", async (index) => {
    const { client, from } = createSequentialMockClient([readRow()])
    expect(await setPostClaimResolution(client, 'post-1', index, RESOLUTION)).toBe('no_such_claim')
    expect(from).toHaveBeenCalledTimes(1)
  })

  it('a read error is thrown, and a write error is thrown', async () => {
    await expect(setPostClaimResolution(createSequentialMockClient([{ data: null, error: { message: 'read boom' } }]).client, 'p', 0, RESOLUTION)).rejects.toThrow('read boom')
    await expect(setPostClaimResolution(createSequentialMockClient([readRow(), { data: null, error: { message: 'write boom' } }]).client, 'p', 0, RESOLUTION)).rejects.toThrow('write boom')
  })

  it('records a cited resolution with its evidence id', async () => {
    const cited: ClaimResolution = { kind: 'cited', evidenceMemoryId: 'ev-1', at: 'x', by: 'u' }
    const { client, builders } = createSequentialMockClient([readRow(), { data: { id: 'post-1' }, error: null }])
    await setPostClaimResolution(client, 'post-1', 0, cited)
    const written = calls(builders[1].update)[0][0] as { ai_generation_metadata: { claimCheck: { claims: Array<{ resolution?: ClaimResolution }> } } }
    expect(written.ai_generation_metadata.claimCheck.claims[0].resolution).toEqual(cited)
  })
})

describe('listClaimChecksByPostIds — one bounded read for a page of posts', () => {
  it('with no ids it does not query at all', async () => {
    const { client, from } = createMockClient([], null)
    expect(await listClaimChecksByPostIds(client, [])).toEqual({})
    expect(from).not.toHaveBeenCalled()
  })

  it('is bounded by the id list ITSELF (never a fixed cap that could truncate a page), ordered by id, soft-deleted excluded', async () => {
    const ids = Array.from({ length: 37 }, (_, i) => `post-${i}`)
    const { client, builder } = createMockClient([], null)
    await listClaimChecksByPostIds(client, ids)
    expect(builder.in).toHaveBeenCalledWith('id', ids)
    expect(builder.limit).toHaveBeenCalledWith(37)
    expect(builder.is).toHaveBeenCalledWith('deleted_at', null)
    expect(calls(builder.order)).toEqual([['id', { ascending: true }]])
  })

  it('returns ONLY posts that carry a verdict — a post with none is absent ("not checked"), never an empty/clean entry', async () => {
    const { client } = createMockClient(
      [
        { id: 'a', content: CONTENT, ai_generation_metadata: { claimCheck: CHECK } },
        { id: 'b', content: CONTENT, ai_generation_metadata: { promptId: 'p' } },
        { id: 'c', content: CONTENT, ai_generation_metadata: null },
        { id: 'd', content: CONTENT, ai_generation_metadata: { claimCheck: { status: 'no_corpus', contentFingerprint: contentFingerprint(CONTENT) } } },
      ],
      null,
    )
    const out = await listClaimChecksByPostIds(client, ['a', 'b', 'c', 'd'])
    expect(Object.keys(out).sort()).toEqual(['a', 'd'])
    expect(out.d).toEqual({ status: 'no_corpus', contentFingerprint: contentFingerprint(CONTENT) })
  })

  it('throws on a DB error', async () => {
    await expect(listClaimChecksByPostIds(createMockClient(null, { message: 'boom' }).client, ['a'])).rejects.toThrow('boom')
  })
})
