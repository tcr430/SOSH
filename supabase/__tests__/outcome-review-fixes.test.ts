import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { createWorld, destroyWorld, createCampaign, type World } from '../__helpers__/outcome-fixtures'

// Session 33 J2.6 — the database-review fixes (20260919150000_outcome_review_fixes.sql), each proven.
// Tier 1, live Postgres.

describe('database-review fixes (ecc:database-reviewer, Session 33 J2.6)', () => {
  let w: World
  let pg: Client

  beforeAll(async () => {
    w = await createWorld('review-fixes')
    pg = new Client({ connectionString: process.env.DATABASE_URL })
    await pg.connect()
  })
  afterAll(async () => {
    if (pg) await pg.end()
    await destroyWorld(w)
  })

  it('reject_outcome_table_update is no longer PUBLIC-executable (revoked like every other function)', async () => {
    const { rows } = await pg.query<{ public_exec: boolean; auth: boolean }>(
      `SELECT coalesce((SELECT bool_or(a.grantee = 0) FROM aclexplode(p.proacl) a WHERE a.privilege_type = 'EXECUTE'), true) AS public_exec,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth
         FROM pg_proc p WHERE p.proname = 'reject_outcome_table_update' AND p.pronamespace = 'public'::regnamespace`,
    )
    expect(rows[0]).toEqual({ public_exec: false, auth: false })
  })

  it('the tagging trigger can NEVER abort an ADR 0018 insert over proof_type: an evidence kind outside the vocabulary yields NULL, not a CHECK violation', async () => {
    const campaignId = await createCampaign(w)
    const { data: post, error } = await w.admin
      .from('posts')
      .insert({
        campaign_id: campaignId, business_id: w.businessId, platform: 'linkedin', content: 'review fix post',
        hashtags: [], scheduled_at: '2026-09-15T12:00:00Z', status: 'draft', role: 'anchor_thesis',
      })
      .select('id')
      .single()
    if (error) throw error

    // Simulate the FUTURE: a new evidence kind. The evidence_memory kind CHECK is dropped INSIDE a transaction
    // that is ROLLED BACK, so nothing leaks. (Today the CHECK is what makes this path unreachable.)
    await pg.query('BEGIN')
    try {
      await pg.query('ALTER TABLE public.evidence_memory DROP CONSTRAINT evidence_memory_kind_check')
      const ev = await pg.query<{ id: string }>(
        `INSERT INTO public.evidence_memory (business_id, source, scope, kind, content)
         VALUES ($1, 'manual', 'brand', 'podcast', 'a future evidence kind') RETURNING id`,
        [w.businessId],
      )
      await pg.query(
        `INSERT INTO public.campaign_briefs (business_id, campaign_id, content, status, frozen_at)
         VALUES ($1, $2, $3::jsonb, 'approved', now())`,
        [w.businessId, campaignId, JSON.stringify({ narrative: 'n', proofPlan: 'p', roleSequence: [], pinnedEvidence: [{ evidenceMemoryId: ev.rows[0].id }] })],
      )
      const origin = await pg.query<{ id: string }>(
        `INSERT INTO public.post_ai_originals (business_id, post_id, campaign_id, revision, generation_kind, format, payload, rendered_content, hashtags, schema_version)
         VALUES ($1, $2, $3, 1, 'initial', 'single', '{"content":"x"}'::jsonb, 'x', '{}', 2) RETURNING id`,
        [w.businessId, post!.id, campaignId],
      )
      const dims = await pg.query('SELECT proof_type, role FROM public.post_dimensions WHERE ai_original_id = $1', [origin.rows[0].id])
      expect(dims.rows).toEqual([{ proof_type: null, role: 'anchor_thesis' }]) // the insert SUCCEEDED and tagged what it could
    } finally {
      await pg.query('ROLLBACK')
    }
  })
})
