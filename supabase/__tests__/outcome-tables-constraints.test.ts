import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'

// ADR 0026 §4.2 / §6.1 / §8.3 — the schema constraints the three outcome tables
// carry, each proven against real Postgres. The tagging trigger sanitises every enum
// so it can never trip these; they exist to hold the line against the OTHER writers
// (the service-role worker, the history copy, a future migration) and against
// hand-written SQL. Tier 1.

const CHECK_VIOLATION = '23514'
const UNIQUE_VIOLATION = '23505'
const FK_VIOLATION = '23503'
const NOT_NULL_VIOLATION = '23502'

async function code(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise
    return undefined
  } catch (err) {
    return (err as { code?: string }).code
  }
}

describe('outcome tables — schema constraints (ADR 0026 §4.2/§6.1/§8.3)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let pg: Client
  let ownerId: string
  let businessId: string
  let campaignId: string
  let postId: string
  let originId: string

  const dimensionsInsert = (extra: string, value: string) =>
    pg.query(
      `INSERT INTO public.post_dimensions (ai_original_id, business_id, post_id, campaign_id, platform, taxonomy_version${extra})
       VALUES ($1, $2, $3, $4, 'linkedin', 1${value})`,
      [originId, businessId, postId, campaignId],
    )

  // Deletes the trigger-made dimensions row so a hand-written insert has a free primary key.
  async function freeDimensionsKey() {
    await pg.query('DELETE FROM public.post_dimensions WHERE ai_original_id = $1', [originId])
  }

  const outcomeInsert = (extraCols: string, extraVals: string, id = postId) =>
    pg.query(
      `INSERT INTO public.post_outcomes (post_id, business_id, campaign_id, platform, published_at, metric_basis, value, measured_at${extraCols})
       VALUES ($1, $2, $3, 'linkedin', now(), 'count', 1, now()${extraVals})`,
      [id, businessId, campaignId],
    )

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is required for raw-SQL constraint tests')
    pg = new Client({ connectionString: url })
    await pg.connect()

    const email = `outcome-cons-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data: user, error: userErr } = await admin.auth.admin.createUser({ email, password: 'TestPass123!', email_confirm: true })
    if (userErr) throw userErr
    ownerId = user.user.id

    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Constraints Business', owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessId = biz.id

    const { data: campaign, error: campErr } = await admin
      .from('campaigns')
      .insert({
        business_id: businessId,
        name: 'Constraints Campaign',
        objective: 'fixtures',
        platforms: ['linkedin'],
        frequency: 'weekly',
        posts_per_week: 1,
        start_date: '2026-09-01',
        origin: 'objective_generated',
      })
      .select('id')
      .single()
    if (campErr) throw campErr
    campaignId = campaign.id

    const { data: post, error: postErr } = await admin
      .from('posts')
      .insert({
        campaign_id: campaignId,
        business_id: businessId,
        platform: 'linkedin',
        content: 'Constraints post',
        hashtags: [],
        scheduled_at: '2026-09-15T12:00:00Z',
        status: 'draft',
        role: 'anchor_thesis',
      })
      .select('id')
      .single()
    if (postErr) throw postErr
    postId = post.id

    const { data: origin, error: originErr } = await admin
      .from('post_ai_originals')
      .insert({
        business_id: businessId,
        post_id: postId,
        campaign_id: campaignId,
        revision: 1,
        generation_kind: 'initial',
        format: 'single',
        payload: { content: 'x' },
        rendered_content: 'x',
        hashtags: [],
        schema_version: 1,
      })
      .select('id')
      .single()
    if (originErr) throw originErr
    originId = origin.id
  })

  afterAll(async () => {
    if (pg) await pg.end()
    if (!admin) return
    if (businessId) await admin.from('businesses').delete().eq('id', businessId)
    if (ownerId) await admin.auth.admin.deleteUser(ownerId)
  })

  describe('post_dimensions', () => {
    it.each([
      ['role', ', role', ", 'wizard'"],
      ['format', ', format', ", 'video'"],
      ['origin_mode', ', origin_mode', ", 'imported'"],
      ['hook_type', ', hook_type', ", 'clickbait'"],
      ['proof_type', ', proof_type', ", 'anecdote'"],
    ])('rejects an out-of-vocabulary %s', async (_label, cols, val) => {
      await freeDimensionsKey()
      expect(await code(dimensionsInsert(cols, val))).toBe(CHECK_VIOLATION)
    })

    it('rejects taxonomy_version < 1', async () => {
      await freeDimensionsKey()
      const result = await code(
        pg.query(
          `INSERT INTO public.post_dimensions (ai_original_id, business_id, post_id, campaign_id, platform, taxonomy_version)
           VALUES ($1, $2, $3, $4, 'linkedin', 0)`,
          [originId, businessId, postId, campaignId],
        ),
      )
      expect(result).toBe(CHECK_VIOLATION)
    })

    it("accepts every in-vocabulary value, including format 'carousel' (forward-compatible) and all-NULL dimensions", async () => {
      await freeDimensionsKey()
      expect(
        await code(
          dimensionsInsert(
            ', role, format, origin_mode, hook_type, proof_type',
            ", 'follow_up', 'carousel', 'studio_promoted', 'how_to', 'none'",
          ),
        ),
      ).toBeUndefined()
      await freeDimensionsKey()
      expect(await code(dimensionsInsert('', ''))).toBeUndefined()
    })

    it('rejects a row whose business does not exist (FK)', async () => {
      await freeDimensionsKey()
      const result = await code(
        pg.query(
          `INSERT INTO public.post_dimensions (ai_original_id, business_id, post_id, campaign_id, platform, taxonomy_version)
           VALUES ($1, gen_random_uuid(), $2, $3, 'linkedin', 1)`,
          [originId, postId, campaignId],
        ),
      )
      expect(result).toBe(FK_VIOLATION)
    })
  })

  describe('post_outcomes', () => {
    it('rejects an out-of-vocabulary metric_basis', async () => {
      const result = await code(
        pg.query(
          `INSERT INTO public.post_outcomes (post_id, business_id, campaign_id, platform, published_at, metric_basis, value, measured_at)
           VALUES ($1, $2, $3, 'linkedin', now(), 'ratio', 1, now())`,
          [postId, businessId, campaignId],
        ),
      )
      expect(result).toBe(CHECK_VIOLATION)
    })

    it('rejects an out-of-vocabulary baseline_source and length_band', async () => {
      expect(await code(outcomeInsert(', baseline_source', ", 'guess'"))).toBe(CHECK_VIOLATION)
      expect(await code(outcomeInsert(', length_band', ", 'huge'"))).toBe(CHECK_VIOLATION)
    })

    it('a value is REQUIRED (a row exists only when something was measured)', async () => {
      const result = await code(
        pg.query(
          `INSERT INTO public.post_outcomes (post_id, business_id, campaign_id, platform, published_at, metric_basis, measured_at)
           VALUES ($1, $2, $3, 'linkedin', now(), 'rate', now())`,
          [postId, businessId, campaignId],
        ),
      )
      expect(result).toBe(NOT_NULL_VIOLATION)
    })

    it('accepts a full row with every measured dimension, and allows one row per post only', async () => {
      expect(
        await code(
          outcomeInsert(
            ', ai_original_id, baseline, baseline_n, baseline_source, log_lift, beat_baseline, length_band, cta_present, hook_survived',
            `, '${originId}', 8.5, 12, 'own', 0.35, true, 'medium', true, false`,
          ),
        ),
      ).toBeUndefined()
      expect(await code(outcomeInsert('', ''))).toBe(UNIQUE_VIOLATION)
    })
  })

  describe('campaign_retrospectives', () => {
    const retroInsert = (over: Record<string, string> = {}, id = campaignId) => {
      const v = {
        hypothesis_source: "'brief'",
        verdict: "'supported'",
        status: "'completed'",
        n: '5',
        wins: '3',
        note: 'NULL',
        ...over,
      }
      return pg.query(
        `INSERT INTO public.campaign_retrospectives
           (campaign_id, business_id, hypothesis_snapshot, hypothesis_source, criteria_snapshot, verdict, n, wins, status, completed_at, note)
         VALUES ($1, $2, 'h', ${v.hypothesis_source}, '{}'::jsonb, ${v.verdict}, ${v.n}, ${v.wins}, ${v.status}, now(), ${v.note})`,
        [id, businessId],
      )
    }

    it('rejects an out-of-vocabulary hypothesis_source, verdict and status', async () => {
      expect(await code(retroInsert({ hypothesis_source: "'guess'" }))).toBe(CHECK_VIOLATION)
      expect(await code(retroInsert({ verdict: "'proven'" }))).toBe(CHECK_VIOLATION)
      expect(await code(retroInsert({ status: "'done'" }))).toBe(CHECK_VIOLATION)
    })

    it('rejects negative n / wins and a note over 500 characters, and accepts exactly 500', async () => {
      expect(await code(retroInsert({ n: '-1' }))).toBe(CHECK_VIOLATION)
      expect(await code(retroInsert({ wins: '-1' }))).toBe(CHECK_VIOLATION)
      expect(await code(retroInsert({ note: `'${'x'.repeat(501)}'` }))).toBe(CHECK_VIOLATION)
      expect(await code(retroInsert({ note: `'${'x'.repeat(500)}'` }))).toBeUndefined()
    })

    it('is UNIQUE per campaign (evaluated once): a second row for the same campaign is rejected', async () => {
      // The 500-char-note insert above already created this campaign's row.
      expect(await code(retroInsert())).toBe(UNIQUE_VIOLATION)
    })

    it('status defaults to completed and by_role to {}', async () => {
      const { data: c2, error } = await admin
        .from('campaigns')
        .insert({
          business_id: businessId,
          name: 'Defaults Campaign',
          objective: 'fixtures',
          platforms: ['linkedin'],
          frequency: 'weekly',
          posts_per_week: 1,
          start_date: '2026-09-01',
          origin: 'objective_generated',
        })
        .select('id')
        .single()
      if (error) throw error
      await pg.query(
        `INSERT INTO public.campaign_retrospectives (campaign_id, business_id, hypothesis_snapshot, hypothesis_source, criteria_snapshot, verdict, n, wins, completed_at)
         VALUES ($1, $2, 'h', 'implicit', '{}'::jsonb, 'inconclusive', 0, 0, now())`,
        [c2.id, businessId],
      )
      const { rows } = await pg.query('SELECT status, by_role, note FROM public.campaign_retrospectives WHERE campaign_id = $1', [c2.id])
      expect(rows[0]).toEqual({ status: 'completed', by_role: {}, note: null })
    })
  })
})
