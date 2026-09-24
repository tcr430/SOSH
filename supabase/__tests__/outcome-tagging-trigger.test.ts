import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { Client } from 'pg'

// ADR 0026 §4.2 / §4.5 — OUTCOME-DIMENSIONS-TAGGED-AT-GENERATION (3) and
// OUTCOME-TAG-ALL-CALLERS (4). Tier 1, live Postgres.
//
// The point of tagging in a TRIGGER on the artefact (post_ai_originals) rather than
// in application code is that every present and future creator of an AI post is
// covered without being enumerated. Per-caller Tier-2 tests alone would repeat the
// Session 22 pattern (one caller verified, the other found broken three sessions
// later), so the proof is a RAW `INSERT INTO post_ai_originals` issued through a
// plain pg client — no Supabase client, no /lib/db function, no application code.

describe('outcome tagging trigger — post_dimensions (ADR 0026 §4.2)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let pg: Client
  const userIds: string[] = []
  let businessId: string
  let otherBusinessId: string
  let seq = 0

  async function createUser(label: string) {
    const email = `outcome-tag-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data, error } = await admin.auth.admin.createUser({ email, password: 'TestPass123!', email_confirm: true })
    if (error) throw error
    userIds.push(data.user.id as string)
    return data.user.id as string
  }

  async function createBusiness(name: string): Promise<string> {
    const ownerId = await createUser(name.toLowerCase().replace(/\s+/g, '-'))
    const { data, error } = await admin
      .from('businesses')
      .insert({ name, owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (error) throw error
    return data.id as string
  }

  async function createCampaign(origin = 'objective_generated', forBusiness = businessId): Promise<string> {
    seq += 1
    const { data, error } = await admin
      .from('campaigns')
      .insert({
        business_id: forBusiness,
        name: `Tagging Campaign ${seq}`,
        objective: 'Tagging fixtures',
        platforms: ['linkedin'],
        frequency: 'weekly',
        posts_per_week: 1,
        start_date: '2026-09-01',
        origin,
      })
      .select('id')
      .single()
    if (error) throw error
    return data.id as string
  }

  async function createPost(campaignId: string, role: string | null, platform = 'linkedin'): Promise<string> {
    seq += 1
    const { data, error } = await admin
      .from('posts')
      .insert({
        campaign_id: campaignId,
        business_id: businessId,
        platform,
        content: `Tagging post ${seq}`,
        hashtags: [],
        scheduled_at: '2026-09-15T12:00:00Z',
        status: 'draft',
        role,
      })
      .select('id')
      .single()
    if (error) throw error
    return data.id as string
  }

  // A RAW INSERT through pg — the caller-independence proof. Returns the new id.
  async function rawOrigin(
    postId: string,
    campaignId: string,
    opts: { revision?: number; kind?: string; format?: string; payload?: unknown } = {},
  ): Promise<string> {
    const { rows } = await pg.query<{ id: string }>(
      `INSERT INTO public.post_ai_originals
         (business_id, post_id, campaign_id, revision, generation_kind, format, payload, rendered_content, hashtags, schema_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'AI content', '{}', 1)
       RETURNING id`,
      [
        businessId,
        postId,
        campaignId,
        opts.revision ?? 1,
        opts.kind ?? 'initial',
        opts.format ?? 'single',
        JSON.stringify(opts.payload ?? { content: 'AI content' }),
      ],
    )
    return rows[0].id
  }

  async function dims(aiOriginalId: string) {
    const { data, error } = await admin.from('post_dimensions').select('*').eq('ai_original_id', aiOriginalId).maybeSingle()
    if (error) throw error
    return data
  }

  async function createEvidence(kind: string, forBusiness = businessId): Promise<string> {
    const { data, error } = await admin
      .from('evidence_memory')
      .insert({ business_id: forBusiness, source: 'manual', scope: 'brand', kind, content: `Evidence ${kind} ${++seq}` })
      .select('id')
      .single()
    if (error) throw error
    return data.id as string
  }

  async function freezeBrief(campaignId: string, pinned: unknown[] | undefined, frozen = true) {
    const content: Record<string, unknown> = { narrative: 'n', proofPlan: 'p', roleSequence: [] }
    if (pinned !== undefined) content.pinnedEvidence = pinned
    const { error } = await admin.from('campaign_briefs').insert({
      business_id: businessId,
      campaign_id: campaignId,
      content,
      status: 'approved',
      frozen_at: frozen ? new Date().toISOString() : null,
    })
    if (error) throw error
  }

  // Runs one tagging scenario end to end and returns the proof_type the trigger chose.
  async function proofTypeFor(setup: (campaignId: string) => Promise<void>): Promise<string | null> {
    const campaignId = await createCampaign()
    await setup(campaignId)
    const postId = await createPost(campaignId, 'anchor_thesis')
    const originId = await rawOrigin(postId, campaignId)
    const row = await dims(originId)
    expect(row, 'the trigger must always produce a row').not.toBeNull()
    return row.proof_type as string | null
  }

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is required for raw-SQL trigger tests')
    pg = new Client({ connectionString: url })
    await pg.connect()

    businessId = await createBusiness('Outcome Tagging Business')
    otherBusinessId = await createBusiness('Outcome Tagging Other Business')
  })

  afterAll(async () => {
    if (pg) await pg.end()
    if (!admin) return
    for (const id of [businessId, otherBusinessId]) {
      if (id) await admin.from('businesses').delete().eq('id', id)
    }
    for (const id of userIds) await admin.auth.admin.deleteUser(id)
  })

  it('a RAW INSERT INTO post_ai_originals (no application code) produces the expected post_dimensions row', async () => {
    const campaignId = await createCampaign('objective_generated')
    const postId = await createPost(campaignId, 'customer_proof', 'twitter')
    const originId = await rawOrigin(postId, campaignId, { format: 'thread' })

    const row = await dims(originId)
    expect(row).toMatchObject({
      ai_original_id: originId,
      business_id: businessId,
      post_id: postId,
      campaign_id: campaignId,
      platform: 'twitter',
      taxonomy_version: 1,
      role: 'customer_proof',
      format: 'thread',
      origin_mode: 'objective_generated',
      hook_type: null,
      proof_type: null,
    })
  })

  it("origin_mode follows the campaign's origin for every origin value", async () => {
    for (const origin of ['manual', 'signal_generated', 'studio_promoted', 'objective_generated']) {
      const campaignId = await createCampaign(origin)
      const postId = await createPost(campaignId, 'anchor_thesis')
      const originId = await rawOrigin(postId, campaignId)
      expect((await dims(originId)).origin_mode).toBe(origin)
    }
  })

  it('a post with role NULL and no brief still inserts (NULLs, no error) — the trigger is total', async () => {
    const campaignId = await createCampaign()
    const postId = await createPost(campaignId, null)
    const originId = await rawOrigin(postId, campaignId)

    const row = await dims(originId)
    expect(row).toMatchObject({ role: null, hook_type: null, proof_type: null, format: 'single' })
    const { rows } = await pg.query('SELECT 1 FROM public.post_ai_originals WHERE id = $1', [originId])
    expect(rows).toHaveLength(1)
  })

  it("hook_type: a valid hookType is recorded; 'nonsense', a non-string and an absent hookType all yield NULL — never an error", async () => {
    const campaignId = await createCampaign()
    const cases: Array<[string, unknown, string | null]> = [
      ['valid', { content: 'x', hookType: 'statistic' }, 'statistic'],
      ['nonsense', { content: 'x', hookType: 'nonsense' }, null],
      ['non-string', { content: 'x', hookType: 5 }, null],
      ['null', { content: 'x', hookType: null }, null],
      ['absent', { content: 'x' }, null],
      ['array payload', ['not', 'an', 'object'], null],
    ]
    for (const [label, payload, expected] of cases) {
      const postId = await createPost(campaignId, 'anchor_thesis')
      const originId = await rawOrigin(postId, campaignId, { payload })
      expect((await dims(originId)).hook_type, label).toBe(expected)
    }
  })

  it('all six hookType values are accepted', async () => {
    const campaignId = await createCampaign()
    for (const hook of ['question', 'statistic', 'contrarian', 'story', 'announcement', 'how_to']) {
      const postId = await createPost(campaignId, 'anchor_thesis')
      const originId = await rawOrigin(postId, campaignId, { payload: { content: 'x', hookType: hook } })
      expect((await dims(originId)).hook_type).toBe(hook)
    }
  })

  it('a second revision gets its OWN row and leaves the first untouched', async () => {
    const campaignId = await createCampaign()
    const postId = await createPost(campaignId, 'follow_up')
    const first = await rawOrigin(postId, campaignId, { revision: 1 })
    const second = await rawOrigin(postId, campaignId, {
      revision: 2,
      kind: 'regeneration',
      payload: { content: 'x', hookType: 'story' },
    })

    expect(second).not.toBe(first)
    expect((await dims(first)).hook_type).toBeNull()
    expect((await dims(second)).hook_type).toBe('story')
    const { data } = await admin.from('post_dimensions').select('ai_original_id').eq('post_id', postId)
    expect(data).toHaveLength(2)
  })

  describe('proof_type (founder ruling on ADR gap D2)', () => {
    it('no brief at all -> NULL (data absent, not "none")', async () => {
      expect(await proofTypeFor(async () => {})).toBeNull()
    })

    it('a frozen brief with an EMPTY pinned set -> none', async () => {
      expect(await proofTypeFor((c) => freezeBrief(c, []))).toBe('none')
    })

    it('one distinct kind across the pinned set -> that kind', async () => {
      const a = await createEvidence('quote')
      const b = await createEvidence('quote')
      expect(
        await proofTypeFor((c) => freezeBrief(c, [{ evidenceMemoryId: a }, { evidenceMemoryId: b, note: 'n' }])),
      ).toBe('quote')
    })

    it('MIXED kinds -> NULL (the column holds one value; picking one would invent a fact)', async () => {
      const a = await createEvidence('quote')
      const b = await createEvidence('case_study')
      expect(await proofTypeFor((c) => freezeBrief(c, [{ evidenceMemoryId: a }, { evidenceMemoryId: b }]))).toBeNull()
    })

    it('a pinned id that resolves to nothing -> NULL', async () => {
      expect(
        await proofTypeFor((c) => freezeBrief(c, [{ evidenceMemoryId: '00000000-0000-4000-8000-00000000dead' }, { evidenceMemoryId: 'not-a-uuid' }])),
      ).toBeNull()
    })

    it("evidence belonging to ANOTHER business is never read (tenant scope) -> NULL", async () => {
      const foreign = await createEvidence('usage_data', otherBusinessId)
      expect(await proofTypeFor((c) => freezeBrief(c, [{ evidenceMemoryId: foreign }]))).toBeNull()
    })

    it('an UNFROZEN brief is ignored -> NULL', async () => {
      const a = await createEvidence('quote')
      expect(await proofTypeFor((c) => freezeBrief(c, [{ evidenceMemoryId: a }], false))).toBeNull()
    })

    it('a frozen brief with no pinnedEvidence key -> NULL', async () => {
      expect(await proofTypeFor((c) => freezeBrief(c, undefined))).toBeNull()
    })
  })

  describe('the trigger as it exists in the catalogue', () => {
    it('is AFTER INSERT FOR EACH ROW on post_ai_originals, and does not collide with ADR 0018\'s trigger names', async () => {
      const { rows } = await pg.query<{ tgname: string; tgtype: number }>(
        `SELECT tgname, tgtype FROM pg_trigger
          WHERE tgrelid = 'public.post_ai_originals'::regclass AND NOT tgisinternal
          ORDER BY tgname`,
      )
      const names = rows.map((r) => r.tgname)
      expect(names).toContain('trg_post_ai_originals_tag_dimensions')
      expect(names).toContain('trg_post_ai_originals_write_once') // ADR 0018's, still present and distinct
      const tag = rows.find((r) => r.tgname === 'trg_post_ai_originals_tag_dimensions')!
      expect(tag.tgtype & 1, 'FOR EACH ROW').toBe(1)
      expect(tag.tgtype & 4, 'INSERT').toBe(4)
      expect(tag.tgtype & 2, 'AFTER (not BEFORE)').toBe(0)
    })

    it('tag_post_dimensions() is SECURITY DEFINER with a pinned search_path and has NO EXCEPTION block', async () => {
      const { rows } = await pg.query<{ prosecdef: boolean; proconfig: string[] | null; prosrc: string }>(
        `SELECT prosecdef, proconfig, prosrc FROM pg_proc WHERE proname = 'tag_post_dimensions' AND pronamespace = 'public'::regnamespace`,
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].prosecdef).toBe(true)
      expect((rows[0].proconfig ?? []).join(',')).toMatch(/search_path=public, pg_temp/)
      expect(rows[0].prosrc).not.toMatch(/\bEXCEPTION\s+WHEN\b/i)
      expect(rows[0].prosrc).toMatch(/ON CONFLICT \(ai_original_id\) DO NOTHING/)
    })
  })

  describe('the history copy (20260919120000_post_dimensions_history_copy.sql) — run as written', () => {
    const historySql = fs.readFileSync(
      path.join(process.cwd(), 'supabase', 'migrations', '20260919120000_post_dimensions_history_copy.sql'),
      'utf8',
    )

    it('re-creates role, format and origin_mode for an existing snapshot and leaves hook_type and proof_type NULL', async () => {
      const evidence = await createEvidence('quote')
      const campaignId = await createCampaign('signal_generated')
      await freezeBrief(campaignId, [{ evidenceMemoryId: evidence }])
      const postId = await createPost(campaignId, 'objection_response', 'twitter')
      const originId = await rawOrigin(postId, campaignId, { format: 'thread', payload: { content: 'x', hookType: 'story' } })

      // The trigger tagged it at generation, including hook_type and proof_type.
      const tagged = await dims(originId)
      expect(tagged).toMatchObject({ hook_type: 'story', proof_type: 'quote' })

      // Simulate a pre-existing snapshot with no dimensions row, then run the migration text.
      const { error: delErr } = await admin.from('post_dimensions').delete().eq('ai_original_id', originId)
      expect(delErr).toBeNull()
      await pg.query(historySql)

      const copied = await dims(originId)
      expect(copied).toMatchObject({
        business_id: businessId,
        post_id: postId,
        campaign_id: campaignId,
        platform: 'twitter',
        taxonomy_version: 1,
        role: 'objection_response',
        format: 'thread',
        origin_mode: 'signal_generated',
        hook_type: null, // NOT recovered: inferring it now is the retroactive classification L-4 forbids
        proof_type: null,
      })
    })

    it('is idempotent: running it again changes and duplicates nothing', async () => {
      const before = await pg.query('SELECT count(*)::int AS n FROM public.post_dimensions')
      await pg.query(historySql)
      await pg.query(historySql)
      const after = await pg.query('SELECT count(*)::int AS n FROM public.post_dimensions')
      expect(after.rows[0].n).toBe(before.rows[0].n)
    })

    it('never fabricates a row: post_dimensions holds exactly one row per post_ai_originals row for this business (imports and human posts add none)', async () => {
      const { rows: snaps } = await pg.query('SELECT count(*)::int AS n FROM public.post_ai_originals WHERE business_id = $1', [businessId])
      const { rows: dimRows } = await pg.query('SELECT count(*)::int AS n FROM public.post_dimensions WHERE business_id = $1', [businessId])
      expect(dimRows[0].n).toBe(snaps[0].n)
    })
  })
})
