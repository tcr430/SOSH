import { describe, it, expect } from 'vitest'
import { createMockClient } from './__test-utils__/mock-client'
import { listRedundancyByPostIds } from './posts'
import { contentFingerprint } from '@/lib/campaigns/claim-fingerprint'
import type { PersistedRedundancy } from './types'

// ADR 0027 §5.8(b) — Session 34-D D9 (MAJOR-5). The redundancy flag is computed FROM a post's text (a word-overlap
// against a sibling), so it must not outlive that text: the reader returns a flag only if its fingerprint matches the
// content the post holds NOW — the same rule as a claim check (D7). An unflagged post is simply absent.
//
// SHARED-FUNCTION CALLERS (git grep at D9): listRedundancyByPostIds has ONE production caller, approvals/page.tsx
// (mocked in approvals/page.test.tsx; the live behaviour is in supabase/__tests__/redundancy-flag-fingerprint.test.ts).

const TEXT = 'Customers keep telling us onboarding takes minutes instead of days.'
const flagFor = (content: string): PersistedRedundancy => ({
  contentFingerprint: contentFingerprint(content),
  overlaps: [{ order: 3, postId: 'other-post', overlap: 0.8 }],
})
const row = (id: string, content: string, redundancy?: unknown) => ({
  id,
  content,
  ai_generation_metadata: redundancy === undefined ? { promptId: 'p' } : { promptId: 'p', redundancy },
})
const calls = (fn: unknown): unknown[][] => (fn as { mock: { calls: unknown[][] } }).mock.calls

describe('listRedundancyByPostIds', () => {
  it('with no ids it does not query at all', async () => {
    const { client, from } = createMockClient([], null)
    expect(await listRedundancyByPostIds(client, [])).toEqual({})
    expect(from).not.toHaveBeenCalled()
  })

  it('is bounded by the id list ITSELF, ordered by id, soft-deleted excluded, and selects the content it compares against', async () => {
    const ids = Array.from({ length: 41 }, (_, i) => `post-${i}`)
    const { client, builder } = createMockClient([], null)
    await listRedundancyByPostIds(client, ids)
    expect(builder.select).toHaveBeenCalledWith('id, content, ai_generation_metadata')
    expect(builder.in).toHaveBeenCalledWith('id', ids)
    expect(builder.limit).toHaveBeenCalledWith(41)
    expect(builder.is).toHaveBeenCalledWith('deleted_at', null)
    expect(calls(builder.order)).toEqual([['id', { ascending: true }]])
  })

  it('an UNEDITED flagged post returns its flag, unchanged (fingerprint present and matching)', async () => {
    const flag = flagFor(TEXT)
    const { client } = createMockClient([row('a', TEXT, flag)], null)
    expect(await listRedundancyByPostIds(client, ['a'])).toEqual({ a: flag })
  })

  it('a flagged post EDITED after generation returns NO flag — the flag described text that no longer exists', async () => {
    const { client } = createMockClient([row('a', `${TEXT} (edited by a human)`, flagFor(TEXT))], null)
    expect(await listRedundancyByPostIds(client, ['a'])).toEqual({})
  })

  it('a REGENERATED post (new text; the old flag rode along or was dropped) returns NO flag either way', async () => {
    const { client } = createMockClient(
      [row('rode-along', 'A completely different regenerated draft.', flagFor(TEXT)), row('dropped', 'A completely different regenerated draft.')],
      null,
    )
    expect(await listRedundancyByPostIds(client, ['rode-along', 'dropped'])).toEqual({})
  })

  it('a flag with NO fingerprint is not shown (it cannot be tied to the text)', async () => {
    const { client } = createMockClient([row('a', TEXT, { overlaps: [{ order: 3, postId: 'o', overlap: 0.8 }] })], null)
    expect(await listRedundancyByPostIds(client, ['a'])).toEqual({})
  })

  it('an EMPTY overlaps list, a malformed value and an unflagged post are absent — never an empty entry', async () => {
    const { client } = createMockClient(
      [
        row('empty', TEXT, { contentFingerprint: contentFingerprint(TEXT), overlaps: [] }),
        row('malformed', TEXT, { contentFingerprint: contentFingerprint(TEXT) }),
        row('none', TEXT),
        { id: 'null-meta', content: TEXT, ai_generation_metadata: null },
      ],
      null,
    )
    expect(await listRedundancyByPostIds(client, ['empty', 'malformed', 'none', 'null-meta'])).toEqual({})
  })

  it("each post is judged against ITS OWN content — one edited post does not hide its counterpart's valid flag", async () => {
    const other = 'Second post: a different body entirely.'
    const { client } = createMockClient([row('a', `${TEXT} (edited)`, flagFor(TEXT)), row('b', other, flagFor(other))], null)
    expect(Object.keys(await listRedundancyByPostIds(client, ['a', 'b']))).toEqual(['b'])
  })

  it('throws on a DB error', async () => {
    await expect(listRedundancyByPostIds(createMockClient(null, { message: 'boom' }).client, ['a'])).rejects.toThrow('boom')
  })
})
