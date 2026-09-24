import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { addHours, formatISO } from 'date-fns'

// ADR 0026 §3.2 / ADR 0028 Amendment A (J2.1) — OUTCOME-METRICS-CADENCE-BOUNDED.
// Tier 1, live Postgres. list_posts_for_metrics_sync is a plain SQL predicate,
// so the ONLY honest proof of "due at day 1, 3 and 7 and not between" is to
// seed published_at / last_synced_at and call the real function with a
// controlled p_now. A mocked client cannot evaluate the predicate.
//
// Three reads per post: a post is due when
//   (age >= 1d AND last_synced_at < published_at + 1d)
//   OR the same at 3d OR the same at 7d, and never past METRICS_MAX_AGE_DAYS.
// last_synced_at NULL (never synced) counts as "before" every stage.

const HOURS = 1
const DAYS = 24 * HOURS
const MAX_AGE_DAYS = 9

describe('list_posts_for_metrics_sync — day-1/3/7 cadence (ADR 0026 §3.2)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let ownerId: string
  let businessId: string
  let campaignId: string
  let seq = 0
  const PUBLISHED_AT = new Date('2026-09-01T12:00:00Z')

  async function createPost(overrides: Record<string, unknown> = {}): Promise<string> {
    seq += 1
    const { data, error } = await admin
      .from('posts')
      .insert({
        campaign_id: campaignId,
        business_id: businessId,
        platform: 'twitter',
        content: `Cadence fixture ${seq}`,
        hashtags: [],
        scheduled_at: formatISO(PUBLISHED_AT),
        status: 'published',
        platform_post_id: `cadence-x-${Date.now()}-${seq}`,
        published_at: formatISO(PUBLISHED_AT),
        ...overrides,
      })
      .select('id')
      .single()
    if (error) throw error
    return data.id as string
  }

  async function setLastSynced(postId: string, hoursAfterPublish: number | null): Promise<void> {
    if (hoursAfterPublish === null) return
    const { error } = await admin.from('post_metrics').upsert(
      {
        post_id: postId,
        business_id: businessId,
        likes: 1,
        last_synced_at: formatISO(addHours(PUBLISHED_AT, hoursAfterPublish)),
      },
      { onConflict: 'post_id' },
    )
    if (error) throw error
  }

  // Calls the REAL function at p_now = published_at + ageHours and reports
  // whether THIS post is in the returned set.
  async function isDue(
    postId: string,
    ageHours: number,
    { staleBefore = formatISO(new Date('2000-01-01T00:00:00Z')) }: { staleBefore?: string } = {},
  ): Promise<boolean> {
    const { data, error } = await admin.rpc('list_posts_for_metrics_sync', {
      p_now: formatISO(addHours(PUBLISHED_AT, ageHours)),
      p_stale_before: staleBefore,
      p_max_age_days: MAX_AGE_DAYS,
      p_limit: 500,
    })
    if (error) throw error
    return (data as Array<{ id: string }>).some((row) => row.id === postId)
  }

  async function createUser(label: string) {
    const email = `metrics-cadence-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data, error } = await admin.auth.admin.createUser({ email, password: 'TestPass123!', email_confirm: true })
    if (error) throw error
    return { id: data.user.id as string }
  }

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    ownerId = (await createUser('owner')).id
    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Metrics Cadence Business', owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessId = biz.id

    const { data: campaign, error: campaignErr } = await admin
      .from('campaigns')
      .insert({
        business_id: businessId,
        name: 'Metrics Cadence Campaign',
        objective: 'Cadence fixtures',
        platforms: ['twitter'],
        frequency: 'weekly',
        posts_per_week: 1,
        start_date: '2026-09-01',
        origin: 'objective_generated',
      })
      .select('id')
      .single()
    if (campaignErr) throw campaignErr
    campaignId = campaign.id
  })

  afterAll(async () => {
    if (!admin) return
    if (businessId) {
      await admin.from('post_metrics').delete().eq('business_id', businessId)
      await admin.from('posts').delete().eq('business_id', businessId)
      await admin.from('campaigns').delete().eq('business_id', businessId)
      await admin.from('businesses').delete().eq('id', businessId)
    }
    if (ownerId) await admin.auth.admin.deleteUser(ownerId)
  })

  it('a never-synced post is NOT due before day 1 and IS due from day 1', async () => {
    const postId = await createPost()
    expect(await isDue(postId, 12 * HOURS)).toBe(false)
    expect(await isDue(postId, 1 * DAYS)).toBe(true)
  })

  it('day 1: due until its day-1 sync lands, then NOT due at day 2', async () => {
    const postId = await createPost()
    expect(await isDue(postId, 1 * DAYS + 2)).toBe(true)
    await setLastSynced(postId, 1 * DAYS + 2) // stage-1 sync landed at day 1 + 2h
    expect(await isDue(postId, 1 * DAYS + 3)).toBe(false)
    expect(await isDue(postId, 2 * DAYS)).toBe(false)
  })

  it('day 3: due at day 3 after only a day-1 sync, then NOT due once the day-3 sync lands (day 5 too)', async () => {
    const postId = await createPost()
    await setLastSynced(postId, 1 * DAYS + 2)
    expect(await isDue(postId, 3 * DAYS)).toBe(true)
    await setLastSynced(postId, 3 * DAYS + 1)
    expect(await isDue(postId, 3 * DAYS + 2)).toBe(false)
    expect(await isDue(postId, 5 * DAYS)).toBe(false)
  })

  it('day 7: due at day 7 after a day-3 sync, then NOT due after its day-7 sync (through day 8.9)', async () => {
    const postId = await createPost()
    await setLastSynced(postId, 3 * DAYS + 1)
    expect(await isDue(postId, 6 * DAYS + 23)).toBe(false)
    expect(await isDue(postId, 7 * DAYS)).toBe(true)
    await setLastSynced(postId, 7 * DAYS + 1)
    expect(await isDue(postId, 7 * DAYS + 2)).toBe(false)
    expect(await isDue(postId, 8 * DAYS + 22)).toBe(false)
  })

  it('a missed stage is caught up: at day 5, a post last synced at day 1 is still due (its day-3 read never landed)', async () => {
    const postId = await createPost()
    await setLastSynced(postId, 1 * DAYS + 2)
    expect(await isDue(postId, 5 * DAYS)).toBe(true)
  })

  it('a post first seen at day 4 is read once, then not again until day 7 (three reads is the ceiling)', async () => {
    const postId = await createPost()
    expect(await isDue(postId, 4 * DAYS)).toBe(true)
    await setLastSynced(postId, 4 * DAYS + 1)
    expect(await isDue(postId, 5 * DAYS)).toBe(false)
    expect(await isDue(postId, 6 * DAYS + 23)).toBe(false)
    expect(await isDue(postId, 7 * DAYS)).toBe(true)
  })

  it('a post older than METRICS_MAX_AGE_DAYS (9) is never due, even never-synced', async () => {
    const postId = await createPost()
    expect(await isDue(postId, 9 * DAYS + 1)).toBe(false)
    expect(await isDue(postId, 30 * DAYS)).toBe(false)
  })

  it('p_stale_before no longer drives the predicate: a far-future value does not re-select a post whose stage sync landed', async () => {
    const postId = await createPost()
    await setLastSynced(postId, 1 * DAYS + 2)
    const farFuture = formatISO(new Date('2100-01-01T00:00:00Z'))
    expect(await isDue(postId, 2 * DAYS, { staleBefore: farFuture })).toBe(false)
  })

  it('the pre-existing filters are preserved: unpublished, no platform_post_id, soft-deleted and non-metrics platforms are never due', async () => {
    const draft = await createPost({ status: 'draft', platform_post_id: null, published_at: null })
    const noPlatformId = await createPost({ platform_post_id: null })
    const deleted = await createPost({ deleted_at: formatISO(PUBLISHED_AT) })
    const instagram = await createPost({ platform: 'instagram' })

    for (const postId of [draft, noPlatformId, deleted, instagram]) {
      expect(await isDue(postId, 3 * DAYS)).toBe(false)
    }
  })

  it('keeps ORDER BY never-synced first and honours p_limit', async () => {
    const synced = await createPost()
    const never = await createPost()
    await setLastSynced(synced, 1 * DAYS + 2)

    const { data, error } = await admin.rpc('list_posts_for_metrics_sync', {
      p_now: formatISO(addHours(PUBLISHED_AT, 3 * DAYS)),
      p_stale_before: formatISO(new Date('2000-01-01T00:00:00Z')),
      p_max_age_days: MAX_AGE_DAYS,
      p_limit: 500,
    })
    expect(error).toBeNull()
    const ids = (data as Array<{ id: string }>).map((row) => row.id)
    expect(ids.indexOf(never)).toBeGreaterThanOrEqual(0)
    expect(ids.indexOf(synced)).toBeGreaterThanOrEqual(0)
    expect(ids.indexOf(never)).toBeLessThan(ids.indexOf(synced))

    const { data: limited } = await admin.rpc('list_posts_for_metrics_sync', {
      p_now: formatISO(addHours(PUBLISHED_AT, 3 * DAYS)),
      p_stale_before: formatISO(new Date('2000-01-01T00:00:00Z')),
      p_max_age_days: MAX_AGE_DAYS,
      p_limit: 1,
    })
    expect((limited as unknown[]).length).toBe(1)
  })
})
