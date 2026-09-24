import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createWorld, createCampaign, destroyWorld, type World } from '../__helpers__/outcome-fixtures'
import { contentFingerprint } from '@/lib/campaigns/claim-fingerprint'
import { updatePostContent, updatePostContentAndMetadata, listRedundancyByPostIds } from '@/lib/db/posts'
import type { AiGenerationMetadata } from '@/lib/db/types'

// ADR 0027 §5.8(b) — Session 34-D D9 (MAJOR-5), against LIVE Postgres. generate.ts persists the redundancy flag on BOTH
// posts of a flagged pair, in ai_generation_metadata.redundancy, with the fingerprint of THAT post's content. The
// reader shows a flag only while the post still holds the text it was computed on: an edit (updatePostContent, the
// function BOTH edit actions call) or a regenerate (updatePostContentAndMetadata) makes it disappear — the same rule
// as a claim check (D7) — while the untouched counterpart keeps its flag.

const TEXT_A = 'Customers keep telling us onboarding takes minutes instead of days.'
const TEXT_B = 'Customers keep telling us onboarding takes minutes instead of days, honestly.'

describe('redundancy flag fingerprint against live Postgres (ADR 0027 §5.8(b), MAJOR-5)', () => {
  let w: World
  let campaignId: string

  beforeAll(async () => {
    w = await createWorld('redundancy-fingerprint')
    campaignId = await createCampaign(w)
  })

  afterAll(async () => {
    await destroyWorld(w)
  })

  async function seedPost(content: string, redundancy?: Record<string, unknown>) {
    const { data, error } = await w.admin
      .from('posts')
      .insert({
        campaign_id: campaignId,
        business_id: w.businessId,
        platform: 'linkedin',
        content,
        hashtags: ['#saas'],
        status: 'draft',
        scheduled_at: '2026-10-01T10:00:00Z',
        ai_generation_metadata: { promptId: 'p', rationale: 'r', regenerationCount: 0, previousVersions: [], ...(redundancy ? { redundancy } : {}) },
      })
      .select('id')
      .single()
    if (error) throw error
    return data.id as string
  }

  // A flagged PAIR, each flag naming the other post and carrying the fingerprint of its OWN content.
  async function seedPair() {
    const a = await seedPost(TEXT_A)
    const b = await seedPost(TEXT_B)
    const flagA = { contentFingerprint: contentFingerprint(TEXT_A), overlaps: [{ order: 3, postId: b, overlap: 0.9 }] }
    const flagB = { contentFingerprint: contentFingerprint(TEXT_B), overlaps: [{ order: 1, postId: a, overlap: 0.9 }] }
    await w.admin.from('posts').update({ ai_generation_metadata: { promptId: 'p', redundancy: flagA } }).eq('id', a)
    await w.admin.from('posts').update({ ai_generation_metadata: { promptId: 'p', redundancy: flagB } }).eq('id', b)
    return { a, b, flagA, flagB }
  }

  it('an unedited flagged pair shows BOTH flags, each naming the other post', async () => {
    const { a, b, flagA, flagB } = await seedPair()
    expect(await listRedundancyByPostIds(w.admin, [a, b])).toEqual({ [a]: flagA, [b]: flagB })
  })

  it('editing one post through updatePostContent (the function BOTH edit actions call) drops ITS flag; the counterpart keeps its own', async () => {
    const { a, b, flagB } = await seedPair()
    await updatePostContent(w.admin, a, { content: `${TEXT_A} (rewritten by a human)`, hashtags: ['#saas'] })
    expect(await listRedundancyByPostIds(w.admin, [a, b])).toEqual({ [b]: flagB })
  })

  it('a HASHTAG-only edit keeps the flag — the flag indexes the content alone', async () => {
    const { a, flagA } = await seedPair()
    await updatePostContent(w.admin, a, { content: TEXT_A, hashtags: ['#saas', '#new'] })
    expect(await listRedundancyByPostIds(w.admin, [a])).toEqual({ [a]: flagA })
  })

  it('a REGENERATED post (whether or not the old flag rode along) shows no flag', async () => {
    const { a, b, flagA } = await seedPair()
    await updatePostContentAndMetadata(w.admin, a, {
      content: 'A completely different regenerated draft.',
      hashtags: ['#saas'],
      metadata: { promptId: 'p', redundancy: flagA, regenerationCount: 1 } as unknown as AiGenerationMetadata,
    })
    await updatePostContentAndMetadata(w.admin, b, {
      content: 'Another regenerated draft.',
      hashtags: ['#saas'],
      metadata: { promptId: 'p', regenerationCount: 1 } as unknown as AiGenerationMetadata,
    })
    expect(await listRedundancyByPostIds(w.admin, [a, b])).toEqual({})
  })

  it('a post with no flag is absent, and reading never changes posts.content (FLAGGED, NEVER EDITED)', async () => {
    const id = await seedPost(TEXT_A)
    expect(await listRedundancyByPostIds(w.admin, [id])).toEqual({})
    const { data } = await w.admin.from('posts').select('content').eq('id', id).single()
    expect(data.content).toBe(TEXT_A)
  })
})
