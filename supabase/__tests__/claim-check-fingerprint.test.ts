import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createWorld, createCampaign, destroyWorld, type World } from '../__helpers__/outcome-fixtures'
import { withContentFingerprint } from '@/lib/campaigns/claim-fingerprint'
import { updatePostContent, updatePostContentAndMetadata, listClaimChecksByPostIds, setPostClaimResolution } from '@/lib/db/posts'
import type { AiGenerationMetadata, PersistedClaimCheck } from '@/lib/db/types'

// ADR 0027 §4.8 — Session 34-D D7 (MAJOR-3), against LIVE Postgres. A claim check stores spans into posts.content, so
// it is valid only for the text it was computed on. The two production content writers are exercised through the
// REAL lib/db functions they call:
//   updatePostContent            <- campaigns/[id]/posts/actions.ts:206 (updatePostContentAction)
//                                <- calendar/actions.ts:262             (the calendar edit)
//   updatePostContentAndMetadata <- campaigns/[id]/posts/actions.ts:383 (regeneratePostAction)
// Neither touches the check; the READ side must therefore invalidate it. An unedited post keeps its check; a
// hashtag-only edit (spans still right) keeps it too; absence reads "not checked", never "clean".

const ORIGINAL = 'We cut churn by 42% in Q3. The rest is plain.'
const CHECK: PersistedClaimCheck = withContentFingerprint(
  { status: 'checked', claims: [{ outcome: 'unsupported', span: { start: 0, end: 26 } }] },
  ORIGINAL,
)
const RESOLUTION = { kind: 'accepted' as const, at: '2026-09-24T10:00:00Z', by: 'user-1' }

describe('claim-check fingerprint against live Postgres (ADR 0027 §4.8, MAJOR-3)', () => {
  let w: World
  let campaignId: string

  beforeAll(async () => {
    w = await createWorld('claim-fingerprint')
    campaignId = await createCampaign(w)
  })

  afterAll(async () => {
    await destroyWorld(w)
  })

  async function seedPost(claimCheck: PersistedClaimCheck | undefined = CHECK, content = ORIGINAL) {
    const metadata: Record<string, unknown> = { promptId: 'p', rationale: 'r', regenerationCount: 0, previousVersions: [] }
    if (claimCheck) metadata.claimCheck = claimCheck
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
        ai_generation_metadata: metadata,
      })
      .select('id')
      .single()
    if (error) throw error
    return data.id as string
  }

  it('an UNEDITED post keeps its check, unchanged', async () => {
    const id = await seedPost()
    expect(await listClaimChecksByPostIds(w.admin, [id])).toEqual({ [id]: CHECK })
  })

  it('a post edited through updatePostContent (the function BOTH edit actions call) returns NO check', async () => {
    const id = await seedPost()
    await updatePostContent(w.admin, id, { content: `${ORIGINAL} (edited by a human)`, hashtags: ['#saas'] })
    expect(await listClaimChecksByPostIds(w.admin, [id])).toEqual({})
  })

  it('a HASHTAG-only edit keeps the check — the spans index into content alone (the fingerprint is not content + hashtags)', async () => {
    const id = await seedPost()
    await updatePostContent(w.admin, id, { content: ORIGINAL, hashtags: ['#saas', '#growth', '#new'] })
    expect(await listClaimChecksByPostIds(w.admin, [id])).toEqual({ [id]: CHECK })
  })

  it('a REGENERATED post (updatePostContentAndMetadata, check dropped as regeneratePostAction now does) returns NO check', async () => {
    const id = await seedPost()
    await updatePostContentAndMetadata(w.admin, id, {
      content: 'A completely different regenerated draft.',
      hashtags: ['#saas'],
      metadata: { promptId: 'p', regenerationCount: 1 } as unknown as AiGenerationMetadata,
    })
    expect(await listClaimChecksByPostIds(w.admin, [id])).toEqual({})
  })

  it('a regenerated post whose OLD check rode along (the pre-fix shape) STILL returns no check — the reader alone is sufficient', async () => {
    const id = await seedPost()
    await updatePostContentAndMetadata(w.admin, id, {
      content: 'A completely different regenerated draft.',
      hashtags: ['#saas'],
      metadata: { promptId: 'p', claimCheck: CHECK, regenerationCount: 1 } as unknown as AiGenerationMetadata,
    })
    expect(await listClaimChecksByPostIds(w.admin, [id])).toEqual({})
  })

  it('a K2.9-era check with NO fingerprint reads "not checked"', async () => {
    const legacy: PersistedClaimCheck = { status: 'checked', claims: [{ outcome: 'unsupported', span: { start: 0, end: 26 } }] }
    const id = await seedPost(legacy)
    expect(await listClaimChecksByPostIds(w.admin, [id])).toEqual({})
  })

  it("resolving a claim on a post whose text was EDITED is refused 'not_checked' and the row is unchanged", async () => {
    const id = await seedPost()
    await updatePostContent(w.admin, id, { content: `${ORIGINAL} (edited)`, hashtags: ['#saas'] })
    const { data: before } = await w.admin.from('posts').select('ai_generation_metadata, updated_at').eq('id', id).single()

    expect(await setPostClaimResolution(w.admin, id, 0, RESOLUTION)).toBe('not_checked')

    const { data: after } = await w.admin.from('posts').select('ai_generation_metadata, updated_at').eq('id', id).single()
    expect(after).toEqual(before)
    expect(JSON.stringify(after.ai_generation_metadata)).not.toContain('resolution')
  })

  it('resolving a claim on an UNEDITED post still records it, keeps the fingerprint, and the check then stays valid', async () => {
    const id = await seedPost()
    expect(await setPostClaimResolution(w.admin, id, 0, RESOLUTION)).toBe('ok')
    const listed = await listClaimChecksByPostIds(w.admin, [id])
    const check = listed[id] as Extract<PersistedClaimCheck, { status: 'checked' }>
    expect(check.contentFingerprint).toBe(CHECK.contentFingerprint)
    expect(check.claims[0].resolution).toEqual(RESOLUTION)
  })

  it('the system never edits the text: resolving and reading leave posts.content byte-identical (AGENCY-CLAIMS-FLAGGED-NEVER-EDITED)', async () => {
    const id = await seedPost()
    await setPostClaimResolution(w.admin, id, 0, RESOLUTION)
    await listClaimChecksByPostIds(w.admin, [id])
    const { data } = await w.admin.from('posts').select('content').eq('id', id).single()
    expect(data.content).toBe(ORIGINAL)
  })
})
