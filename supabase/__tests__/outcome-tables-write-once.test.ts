import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'

// ADR 0026 §4.2 / §6.1 / §11 — OUTCOME-DIMENSIONS-WRITE-ONCE (5). Tier 1, live Postgres.
//
// post_dimensions and post_outcomes are write-once: a BEFORE UPDATE trigger rejects
// EVERY update, service-role and the table owner included — a trigger cannot be
// bypassed by privilege, only by session_replication_role. DELETE is deliberately
// UNGUARDED and there is NO BEFORE DELETE trigger on any of the three tables: a child
// BEFORE DELETE trigger fires on FK cascades and would abort purge_business (ADR
// 0018 [db-BLOCKER-1]). campaign_retrospectives has NO write-once trigger by design —
// it transitions completed -> acknowledged through the RPC and its acknowledged_by
// FK is ON DELETE SET NULL; both are proven below.

// pg_trigger.tgtype bits
const ROW = 1
const BEFORE = 2
const DELETE_BIT = 8
const UPDATE_BIT = 16

describe('outcome tables — write-once, and never a BEFORE DELETE (ADR 0026 §4.2/§6.1)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let admin: any
  let pg: Client
  const userIds: string[] = []
  let businessId: string
  let campaignId: string
  let seq = 0

  async function createUser(label: string) {
    const email = `outcome-wo-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
    const { data, error } = await admin.auth.admin.createUser({ email, password: 'TestPass123!', email_confirm: true })
    if (error) throw error
    userIds.push(data.user.id as string)
    return data.user.id as string
  }

  // A post + its snapshot (the trigger tags it) + its frozen outcome.
  async function createPostWithOutcome() {
    seq += 1
    const { data: post, error: postErr } = await admin
      .from('posts')
      .insert({
        campaign_id: campaignId,
        business_id: businessId,
        platform: 'linkedin',
        content: `Write-once post ${seq}`,
        hashtags: [],
        scheduled_at: '2026-09-15T12:00:00Z',
        status: 'draft',
        role: 'anchor_thesis',
      })
      .select('id')
      .single()
    if (postErr) throw postErr

    const { data: origin, error: originErr } = await admin
      .from('post_ai_originals')
      .insert({
        business_id: businessId,
        post_id: post.id,
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

    const { error: outErr } = await admin.from('post_outcomes').insert({
      post_id: post.id,
      business_id: businessId,
      campaign_id: campaignId,
      platform: 'linkedin',
      published_at: '2026-09-01T12:00:00Z',
      ai_original_id: origin.id,
      metric_basis: 'count',
      value: 12,
      measured_at: '2026-09-08T12:00:00Z',
    })
    if (outErr) throw outErr
    return { postId: post.id as string, originId: origin.id as string }
  }

  beforeAll(async () => {
    const { createServiceRoleClient } = await import('@/lib/supabase/service')
    admin = createServiceRoleClient()

    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is required for raw-SQL trigger tests')
    pg = new Client({ connectionString: url })
    await pg.connect()

    const ownerId = await createUser('owner')
    const { data: biz, error: bizErr } = await admin
      .from('businesses')
      .insert({ name: 'Write Once Business', owner_id: ownerId, plan: 'plus' })
      .select('id')
      .single()
    if (bizErr) throw bizErr
    businessId = biz.id

    const { data: campaign, error: campaignErr } = await admin
      .from('campaigns')
      .insert({
        business_id: businessId,
        name: 'Write Once Campaign',
        objective: 'fixtures',
        platforms: ['linkedin'],
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
    if (pg) await pg.end()
    if (!admin) return
    if (businessId) await admin.from('businesses').delete().eq('id', businessId)
    for (const id of userIds) await admin.auth.admin.deleteUser(id)
  })

  it('post_dimensions: UPDATE is rejected for the service-role client', async () => {
    const { originId } = await createPostWithOutcome()
    const { error } = await admin.from('post_dimensions').update({ role: 'follow_up' }).eq('ai_original_id', originId)
    expect(error).not.toBeNull()
    expect(error.message).toMatch(/immutable/i)
    const { data } = await admin.from('post_dimensions').select('role').eq('ai_original_id', originId).single()
    expect(data.role).toBe('anchor_thesis')
  })

  it('post_dimensions: UPDATE is rejected for a raw superuser pg session, even a no-op SET col = col', async () => {
    const { originId } = await createPostWithOutcome()
    await expect(
      pg.query(`UPDATE public.post_dimensions SET role = 'follow_up' WHERE ai_original_id = $1`, [originId]),
    ).rejects.toThrow(/immutable/i)
    await expect(
      pg.query(`UPDATE public.post_dimensions SET platform = platform WHERE ai_original_id = $1`, [originId]),
    ).rejects.toThrow(/immutable/i)
  })

  it('post_outcomes: UPDATE is rejected for the service-role client and for raw pg', async () => {
    const { postId } = await createPostWithOutcome()
    const { error } = await admin.from('post_outcomes').update({ value: 999 }).eq('post_id', postId)
    expect(error).not.toBeNull()
    expect(error.message).toMatch(/immutable/i)
    await expect(pg.query(`UPDATE public.post_outcomes SET value = 999 WHERE post_id = $1`, [postId])).rejects.toThrow(/immutable/i)
    const { data } = await admin.from('post_outcomes').select('value').eq('post_id', postId).single()
    expect(Number(data.value)).toBe(12)
  })

  it('an UPDATE matching zero rows does not raise (the trigger is per-row, not a blanket block)', async () => {
    await expect(pg.query(`UPDATE public.post_outcomes SET value = 1 WHERE false`)).resolves.toBeDefined()
  })

  it('the triggers are exactly BEFORE UPDATE FOR EACH ROW, and there is NO BEFORE DELETE trigger on ANY of the three tables', async () => {
    const { rows } = await pg.query<{ relname: string; tgname: string; tgtype: number }>(
      `SELECT c.relname, t.tgname, t.tgtype
         FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE c.relnamespace = 'public'::regnamespace
          AND c.relname IN ('post_dimensions', 'post_outcomes', 'campaign_retrospectives')
          AND NOT t.tgisinternal
        ORDER BY c.relname, t.tgname`,
    )
    const byTable = (name: string) => rows.filter((r) => r.relname === name)

    expect(byTable('post_dimensions').map((r) => r.tgname)).toEqual(['trg_post_dimensions_write_once'])
    expect(byTable('post_outcomes').map((r) => r.tgname)).toEqual(['trg_post_outcomes_write_once'])
    expect(byTable('campaign_retrospectives')).toEqual([])

    for (const r of rows) {
      expect(r.tgtype, `${r.tgname} must be BEFORE UPDATE FOR EACH ROW`).toBe(ROW | BEFORE | UPDATE_BIT)
      expect(r.tgtype & DELETE_BIT, `${r.tgname} must NOT fire on DELETE (ADR 0018 [db-BLOCKER-1])`).toBe(0)
    }
  })

  it('DELETE is unguarded: the service role can delete a dimensions row and an outcome row', async () => {
    const { postId, originId } = await createPostWithOutcome()
    const outDel = await admin.from('post_outcomes').delete().eq('post_id', postId)
    expect(outDel.error).toBeNull()
    const dimDel = await admin.from('post_dimensions').delete().eq('ai_original_id', originId)
    expect(dimDel.error).toBeNull()
  })

  it('FK cascades do NOT trip the write-once trigger: deleting a post removes its dimensions and outcome', async () => {
    const { postId, originId } = await createPostWithOutcome()
    const del = await admin.from('posts').delete().eq('id', postId)
    expect(del.error).toBeNull()
    const { data: d } = await admin.from('post_dimensions').select('ai_original_id').eq('ai_original_id', originId)
    const { data: o } = await admin.from('post_outcomes').select('post_id').eq('post_id', postId)
    expect(d ?? []).toEqual([])
    expect(o ?? []).toEqual([])
  })

  it('deleting a post_ai_originals snapshot cascades to its dimensions row and to the outcome that references it', async () => {
    const { postId, originId } = await createPostWithOutcome()
    const del = await admin.from('post_ai_originals').delete().eq('id', originId)
    expect(del.error).toBeNull()
    const { data: d } = await admin.from('post_dimensions').select('ai_original_id').eq('ai_original_id', originId)
    const { data: o } = await admin.from('post_outcomes').select('post_id').eq('post_id', postId)
    expect(d ?? []).toEqual([])
    expect(o ?? []).toEqual([])
  })

  describe('campaign_retrospectives has NO write-once trigger, by design', () => {
    async function createRetrospective(acknowledgedBy: string | null = null) {
      seq += 1
      const { data: campaign, error: cErr } = await admin
        .from('campaigns')
        .insert({
          business_id: businessId,
          name: `Retro Campaign ${seq}`,
          objective: 'fixtures',
          platforms: ['linkedin'],
          frequency: 'weekly',
          posts_per_week: 1,
          start_date: '2026-09-01',
          origin: 'objective_generated',
        })
        .select('id')
        .single()
      if (cErr) throw cErr
      const { data, error } = await admin
        .from('campaign_retrospectives')
        .insert({
          campaign_id: campaign.id,
          business_id: businessId,
          hypothesis_snapshot: 'Posts beat the usual engagement',
          hypothesis_source: 'implicit',
          criteria_snapshot: { metric: 'win_rate', target: 0.5, evaluationWindowDays: 7 },
          verdict: 'supported',
          n: 8,
          wins: 6,
          completed_at: '2026-09-15T12:00:00Z',
          acknowledged_by: acknowledgedBy,
          acknowledged_at: acknowledgedBy ? '2026-09-16T12:00:00Z' : null,
          status: acknowledgedBy ? 'acknowledged' : 'completed',
        })
        .select('id')
        .single()
      if (error) throw error
      return data.id as string
    }

    it('completed -> acknowledged is a plain UPDATE that succeeds (the RPC does exactly this)', async () => {
      const id = await createRetrospective()
      const { error } = await admin
        .from('campaign_retrospectives')
        .update({ status: 'acknowledged', acknowledged_at: '2026-09-16T12:00:00Z', note: 'Reviewed' })
        .eq('id', id)
        .eq('status', 'completed')
      expect(error).toBeNull()
    })

    it("deleting the acknowledging user SETs acknowledged_by NULL without error (an UPDATE a write-once trigger would abort)", async () => {
      const reviewer = await createUser('reviewer')
      const id = await createRetrospective(reviewer)
      const { error: delErr } = await admin.auth.admin.deleteUser(reviewer)
      expect(delErr).toBeNull()
      userIds.splice(userIds.indexOf(reviewer), 1)
      const { data } = await admin.from('campaign_retrospectives').select('acknowledged_by, status').eq('id', id).single()
      expect(data.acknowledged_by).toBeNull()
      expect(data.status).toBe('acknowledged')
    })
  })
})
