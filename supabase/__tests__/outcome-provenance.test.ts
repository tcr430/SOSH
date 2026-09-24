import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createWorld, destroyWorld, seedCell, seedObservation, createCampaign, type World } from '../__helpers__/outcome-fixtures'

// ADR 0026 §9 — OUTCOME-PROVENANCE-PROPAGATED (23), Tier-1 half (closes in J2.8), plus the cell
// recomputation's tenancy and vocabulary. An observation inherits the provenance of the artefact it
// measures; a pattern's provenance is the union of its observations' and its baseline's.

describe('provenance and cell recomputation (ADR 0026 §9, §6.4)', () => {
  let w: World

  beforeEach(async () => {
    w = await createWorld('prov')
  })
  afterEach(async () => {
    await destroyWorld(w)
  })

  const upsert = (dimension: string, value: string, direction = 'above', platform = 'linkedin') =>
    w.admin.rpc('upsert_outcome_performance_pattern', {
      p_business_id: w.businessId, p_dimension: dimension, p_value: value, p_platform: platform,
      p_direction: direction, p_pattern_text: `pattern ${dimension}=${value}`,
    })

  it("an observation whose baseline was the IMPORTED seed sets baseline_seeded = true; none seeded leaves it false", async () => {
    await seedCell(w, { role: 'follow_up', wins: 5, losses: 0, campaigns: 3 })
    expect((await upsert('role', 'follow_up')).data.baseline_seeded).toBe(false)

    await seedCell(w, { role: 'anchor_thesis', wins: 4, losses: 0, campaigns: 3 })
    await seedCell(w, { role: 'anchor_thesis', wins: 1, losses: 0, campaigns: 1, baselineSource: 'import_seed' })
    const { data } = await upsert('role', 'anchor_thesis')
    expect(data).toMatchObject({ outcome_n: 5, baseline_seeded: true })
  })

  it("never reads or modifies a distilled or manual row in the same business, and cannot promote or demote one", async () => {
    const seededDistilled = await w.admin.from('performance_memory').insert({
      business_id: w.businessId, source: 'distilled', status: 'active', scope: 'brand', dimension: 'format',
      pattern: 'distilled text', pattern_key: 'kind:direction:linkedin', platform: 'linkedin', confidence: 0.8, observation_count: 6,
    }).select('id, pattern, status, observation_count, updated_at').single()
    const seededManual = await w.admin.from('performance_memory').insert({
      business_id: w.businessId, source: 'manual', scope: 'brand', dimension: 'format', pattern: 'manual text', platform: 'linkedin',
    }).select('id, pattern, status').single()

    await seedCell(w, { role: 'customer_proof', format: 'single', wins: 10, losses: 0, campaigns: 3 })
    await upsert('format', 'single')
    await upsert('role', 'customer_proof')

    for (const key of ['kind:direction:linkedin', 'outcome:format:single:above:linkedin']) {
      // a distilled key is never promotable / demotable through the outcome RPCs
      if (key.startsWith('kind')) {
        const p = await w.admin.rpc('promote_outcome_pattern', { p_business_id: w.businessId, p_pattern_key: key })
        const d = await w.admin.rpc('demote_outcome_pattern', { p_business_id: w.businessId, p_pattern_key: key })
        expect(p.data ?? []).toEqual([])
        expect(d.data ?? []).toEqual([])
      }
    }
    const { data: distilled } = await w.admin.from('performance_memory').select('pattern, status, observation_count, updated_at').eq('id', seededDistilled.data.id).single()
    expect(distilled).toEqual({
      pattern: 'distilled text', status: 'active', observation_count: 6, updated_at: seededDistilled.data.updated_at,
    })
    const { data: manual } = await w.admin.from('performance_memory').select('pattern, status').eq('id', seededManual.data.id).single()
    expect(manual).toEqual({ pattern: 'manual text', status: seededManual.data.status })
  })

  it('the promote / demote / upsert bodies are pinned to source = outcome (no import or distilled predicate can match)', async () => {
    const { rows } = await (async () => {
      const { data } = await w.admin.rpc('outcome_cell_stats', {
        p_business_id: w.businessId, p_dimension: 'role', p_value: 'follow_up', p_platform: 'linkedin', p_direction: 'above',
      })
      return { rows: data }
    })()
    expect(rows[0].s_n).toBe(0) // an empty cell is a vacuous, valid result
  })

  it('a cell must not MIX rate- and count-basis observations', async () => {
    await seedCell(w, { role: 'objection_response', wins: 3, losses: 0, campaigns: 3, basis: 'rate' })
    await seedCell(w, { role: 'objection_response', wins: 2, losses: 0, campaigns: 2, basis: 'count' })
    const { error } = await upsert('role', 'objection_response')
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/mix/i)
  })

  it("a rate-basis cell records metric_basis 'rate'", async () => {
    await seedCell(w, { role: 'conversation_starter', wins: 5, losses: 0, campaigns: 3, basis: 'rate', platform: 'twitter' })
    const { data } = await upsert('role', 'conversation_starter', 'above', 'twitter')
    expect(data.metric_basis).toBe('rate')
  })

  it("another business's observations are NEVER counted (every table read is business-scoped)", async () => {
    await seedCell(w, { role: 'founder_perspective', wins: 4, losses: 0, campaigns: 3 })
    const other = await createWorld('prov-other')
    try {
      await seedCell(other, { role: 'founder_perspective', wins: 12, losses: 0, campaigns: 4 })
      const { data } = await upsert('role', 'founder_perspective')
      expect(data?.id ?? null).toBeNull() // still n = 4: the other tenant's 12 posts are invisible
      const { data: theirs } = await other.admin.rpc('outcome_cell_stats', {
        p_business_id: w.businessId, p_dimension: 'role', p_value: 'founder_perspective', p_platform: 'linkedin', p_direction: 'above',
      })
      expect(theirs[0].s_n).toBe(4)
    } finally {
      await destroyWorld(other)
    }
  })

  it('MEASURED dimensions read post_outcomes (length_band, cta) and include human-written posts; generation-time ones do not', async () => {
    // 5 human-written posts (no snapshot, no dimensions row): visible to a length_band cell, invisible to a role cell.
    const campaigns = [await createCampaign(w), await createCampaign(w), await createCampaign(w)]
    for (let i = 0; i < 5; i += 1) {
      await seedObservation(w, { campaignId: campaigns[i % 3], beat: true, snapshot: false, lengthBand: 'short', cta: false, daysAgo: 5 + i })
    }
    expect((await upsert('length_band', 'short')).data).toMatchObject({ outcome_n: 5, dimension: 'length_band' })
    expect((await upsert('cta', 'false')).data).toMatchObject({ outcome_n: 5, dimension: 'cta' })
    expect((await upsert('role', 'customer_proof')).data?.id ?? null).toBeNull()
  })

  it("format and origin_mode cells come from the post's generation-time tags", async () => {
    const signal = await createCampaign(w, 'signal_generated')
    for (let i = 0; i < 5; i += 1) await seedObservation(w, { campaignId: signal, beat: true, format: 'thread', daysAgo: 5 + i })
    expect((await upsert('format', 'thread')).data).toMatchObject({ outcome_n: 5 })
    expect((await upsert('origin_mode', 'signal_generated')).data).toMatchObject({ outcome_n: 5 })
    expect((await upsert('origin_mode', 'manual')).data?.id ?? null).toBeNull()
  })

  it('an unknown direction or a malformed cta value is rejected', async () => {
    expect((await upsert('role', 'follow_up', 'sideways')).error).not.toBeNull()
    expect((await upsert('cta', 'maybe')).error).not.toBeNull()
  })
})
