// Shared Tier-1 fixtures for the ADR 0026 outcome RPC tests (Session 33 J2.6).
//
// Deliberately OUTSIDE supabase/__tests__/: it is not a test, and ADR 0015's skip-guard flags
// a supabase/__tests__ file that executes zero tests as a false-green. Every function writes through
// the SERVICE-ROLE client — the same identity the outcome worker and RPCs run as.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { toUtcIso } from '@/lib/utils'

export interface World {
  admin: any
  userId: string
  email: string
  businessId: string
  extraUserIds: string[]
}

let seq = 0
const next = () => ++seq

export async function createWorld(label: string): Promise<World> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const admin: any = createServiceRoleClient()
  const email = `outcome-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
  const { data: user, error: userErr } = await admin.auth.admin.createUser({
    email,
    password: 'TestPass123!',
    email_confirm: true,
  })
  if (userErr) throw userErr
  const { data: biz, error: bizErr } = await admin
    .from('businesses')
    .insert({ name: `Outcome ${label}`, owner_id: user.user.id, plan: 'plus' })
    .select('id')
    .single()
  if (bizErr) throw bizErr
  return { admin, userId: user.user.id, email, businessId: biz.id, extraUserIds: [] }
}

export async function destroyWorld(w: World | undefined): Promise<void> {
  if (!w) return
  await w.admin.from('businesses').delete().eq('id', w.businessId)
  for (const id of [w.userId, ...w.extraUserIds]) await w.admin.auth.admin.deleteUser(id)
}

export async function createCampaign(w: World, origin = 'objective_generated'): Promise<string> {
  const { data, error } = await w.admin
    .from('campaigns')
    .insert({
      business_id: w.businessId,
      name: `Outcome Campaign ${next()}`,
      objective: 'fixtures',
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

export interface ObsSpec {
  campaignId: string
  beat: boolean
  daysAgo?: number
  platform?: string
  role?: string | null
  format?: 'single' | 'thread'
  lengthBand?: string | null
  cta?: boolean | null
  baselineSource?: 'own' | 'import_seed'
  basis?: 'rate' | 'count'
  // Human-written posts have no snapshot (and so no generation-time dimensions).
  snapshot?: boolean
}

// One published post, its snapshot (the AFTER INSERT trigger tags it), and its frozen outcome.
export async function seedObservation(w: World, spec: ObsSpec): Promise<{ postId: string; originId: string | null }> {
  const daysAgo = spec.daysAgo ?? 10
  const publishedAt = toUtcIso(new Date(Date.now() - daysAgo * 86_400_000))
  const platform = spec.platform ?? 'linkedin'

  const { data: post, error: postErr } = await w.admin
    .from('posts')
    .insert({
      campaign_id: spec.campaignId,
      business_id: w.businessId,
      platform,
      content: `Outcome fixture post ${next()}`,
      hashtags: [],
      scheduled_at: publishedAt,
      status: 'published',
      platform_post_id: `outcome-fixture-${Date.now()}-${next()}`,
      published_at: publishedAt,
      role: spec.role === undefined ? 'customer_proof' : spec.role,
    })
    .select('id')
    .single()
  if (postErr) throw postErr

  let originId: string | null = null
  if (spec.snapshot !== false) {
    const { data: origin, error: originErr } = await w.admin
      .from('post_ai_originals')
      .insert({
        business_id: w.businessId,
        post_id: post.id,
        campaign_id: spec.campaignId,
        revision: 1,
        generation_kind: 'initial',
        format: spec.format ?? 'single',
        payload: { content: 'x' },
        rendered_content: 'x',
        hashtags: [],
        schema_version: 2,
      })
      .select('id')
      .single()
    if (originErr) throw originErr
    originId = origin.id
  }

  const { error: outErr } = await w.admin.from('post_outcomes').insert({
    post_id: post.id,
    business_id: w.businessId,
    campaign_id: spec.campaignId,
    platform,
    published_at: publishedAt,
    ai_original_id: originId,
    metric_basis: spec.basis ?? 'count',
    value: 10,
    baseline: 8,
    baseline_n: 12,
    baseline_source: spec.baselineSource ?? 'own',
    log_lift: spec.beat ? 0.2 : -0.2,
    beat_baseline: spec.beat,
    length_band: spec.lengthBand ?? null,
    cta_present: spec.cta ?? null,
    hook_survived: null,
    measured_at: toUtcIso(new Date()),
  })
  if (outErr) throw outErr
  return { postId: post.id, originId }
}

export interface CellSpec extends Omit<ObsSpec, 'campaignId' | 'beat' | 'daysAgo'> {
  wins: number
  losses: number
  campaigns: number
  // Age of the i-th observation (0 = the first seeded). Default: 5 + i, so index 0 is the NEWEST.
  daysAgo?: (i: number) => number
  // Which observations beat their baseline. Default: the first `wins`.
  beatAt?: (i: number) => boolean
}

// Seeds `wins` observations that beat their baseline and `losses` that did not, spread round-robin
// across `campaigns` campaigns. Returns the campaign ids.
export async function seedCell(w: World, spec: CellSpec): Promise<string[]> {
  const campaignIds: string[] = []
  for (let c = 0; c < spec.campaigns; c += 1) campaignIds.push(await createCampaign(w))
  const total = spec.wins + spec.losses
  const { wins: _w, losses: _l, campaigns: _c, daysAgo, beatAt, ...rest } = spec
  for (let i = 0; i < total; i += 1) {
    await seedObservation(w, {
      ...rest,
      campaignId: campaignIds[i % campaignIds.length],
      beat: beatAt ? beatAt(i) : i < spec.wins,
      daysAgo: daysAgo ? daysAgo(i) : 5 + i,
    })
  }
  return campaignIds
}

export async function createRetrospective(
  w: World,
  campaignId: string,
  over: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await w.admin.from('campaign_retrospectives').insert({
    campaign_id: campaignId,
    business_id: w.businessId,
    hypothesis_snapshot: 'Posts beat the usual engagement',
    hypothesis_source: 'brief',
    criteria_snapshot: { metric: 'win_rate', target: 0.5, evaluationWindowDays: 7 },
    verdict: 'supported',
    n: 10,
    wins: 8,
    interval_low: 0.49,
    interval_high: 0.94,
    completed_at: toUtcIso(new Date(Date.now() - 3 * 86_400_000)),
    ...over,
  })
  if (error) throw error
}

export async function addMember(w: World, role: 'approver' | 'editor' | 'viewer', status = 'active'): Promise<string> {
  const email = `outcome-member-${Date.now()}-${Math.random().toString(36).slice(2)}@integration.test`
  const { data, error } = await w.admin.auth.admin.createUser({ email, password: 'TestPass123!', email_confirm: true })
  if (error) throw error
  w.extraUserIds.push(data.user.id)
  const { error: memErr } = await w.admin.from('business_members').insert({
    business_id: w.businessId,
    user_id: data.user.id,
    email,
    role,
    status,
    accepted_at: toUtcIso(new Date()),
  })
  if (memErr) throw memErr
  return data.user.id as string
}

export const outcomeKey = (dimension: string, value: string, direction: string, platform: string): string =>
  `outcome:${dimension}:${value}:${direction}:${platform}`
