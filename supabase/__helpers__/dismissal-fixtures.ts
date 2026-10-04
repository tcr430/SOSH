// Shared Tier-1 fixtures for the ADR 0030 dismissal writer (Session 36 L2.5). Deliberately OUTSIDE supabase/__tests__/: it is not a
// test, and ADR 0015's skip-guard flags a supabase/__tests__ file that executes zero tests as a false-green. Every function writes
// through the SERVICE-ROLE (admin) client — the identity a fixture needs — except where a test explicitly signs a member in.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { toUtcIso } from '@/lib/utils'

export const PASSWORD = 'TestPass123!'

let seq = 0
const next = () => ++seq

export interface Biz {
  id: string
  ownerId: string
  email: string
}

export type Source = { kind: 'github'; id: string } | { kind: 'rss'; id: string }

export async function createUser(admin: any, label: string): Promise<{ id: string; email: string }> {
  const email = `dismissal-${label}-${Date.now()}-${next()}-${Math.random().toString(36).slice(2)}@integration.test`
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
  if (error) throw error
  return { id: data.user.id as string, email }
}

export async function createBiz(admin: any, label: string, owner?: { id: string; email: string }): Promise<Biz> {
  const user = owner ?? (await createUser(admin, label))
  const { data, error } = await admin.from('businesses').insert({ name: `Dismissal ${label} ${next()}`, owner_id: user.id, plan: 'plus' }).select('id').single()
  if (error) throw error
  return { id: data.id as string, ownerId: user.id, email: user.email }
}

export async function seedRepo(admin: any, biz: Biz, over: { owner?: string; name?: string } = {}): Promise<Source> {
  const n = next() + Math.floor(Math.random() * 1_000_000)
  // github_connections allows ONE row per business (github_connections_business_id_key): reuse it for the second repo.
  const { data: existing } = await admin.from('github_connections').select('id').eq('business_id', biz.id).maybeSingle()
  let conn = existing as { id: string } | null
  if (!conn) {
    const { data: created, error: connErr } = await admin
      .from('github_connections')
      .insert({ business_id: biz.id, installation_id: n, account_login: `acct-${n}` })
      .select('id')
      .single()
    if (connErr) throw connErr
    conn = created as { id: string }
  }
  const { data, error } = await admin
    .from('watched_repos')
    .insert({ business_id: biz.id, connection_id: conn.id, repo_id: n, owner: over.owner ?? 'acme', name: over.name ?? `repo-${n}` })
    .select('id')
    .single()
  if (error) throw error
  return { kind: 'github', id: data.id as string }
}

export async function seedFeed(admin: any, biz: Biz, over: { url?: string; label?: string } = {}): Promise<Source> {
  const n = next() + Math.floor(Math.random() * 1_000_000)
  const url = over.url ?? `https://feed${n}.example.com/rss.xml`
  const { data, error } = await admin
    .from('watched_feeds')
    .insert({ business_id: biz.id, url, url_hash: `hash-${n}-${Math.random().toString(36).slice(2)}`, label: over.label ?? `Feed ${n}` })
    .select('id')
    .single()
  if (error) throw error
  return { kind: 'rss', id: data.id as string }
}

export interface CardSpec {
  status?: 'pending' | 'approved' | 'dismissed' | 'saved'
  reason?: 'not_relevant' | 'already_covered' | 'too_sensitive' | 'wrong_timing' | 'weak_evidence' | null
  /** Age of the card's updated_at in days. INSERT does not fire the BEFORE UPDATE touch trigger, so a card can be seeded already aged. */
  ageDays?: number
}

/**
 * The whole chain signal -> signal_candidate -> insight_card for one watched source. The card is INSERTED in its final state
 * (an INSERT fires no BEFORE UPDATE trigger, so `updated_at` can be set). To drive a real transition instead, seed `pending`
 * and call transition().
 */
export async function seedCard(admin: any, biz: Biz, source: Source, spec: CardSpec = {}): Promise<string> {
  const n = next() + Math.floor(Math.random() * 1_000_000)
  const status = spec.status ?? 'pending'
  const updatedAt = toUtcIso(new Date(Date.now() - (spec.ageDays ?? 0) * 86_400_000))
  const signalRow: Record<string, unknown> = {
    business_id: biz.id,
    source: source.kind,
    kind: source.kind === 'github' ? 'release' : 'article',
    external_id: `ext-${n}`,
    title: 'seed signal',
    body: 'seed body',
    occurred_at: '2026-07-01T00:00:00Z',
  }
  if (source.kind === 'github') signalRow.watched_repo_id = source.id
  else signalRow.watched_feed_id = source.id
  const { data: signal, error: sErr } = await admin.from('signals').insert(signalRow).select('id').single()
  if (sErr) throw sErr
  const { data: cand, error: cErr } = await admin
    .from('signal_candidates')
    .insert({ business_id: biz.id, signal_id: signal.id, score: 42, occurred_at: '2026-07-01T00:00:00Z' })
    .select('id')
    .single()
  if (cErr) throw cErr
  const { data: card, error: kErr } = await admin
    .from('insight_cards')
    .insert({
      business_id: biz.id,
      signal_candidate_id: cand.id,
      observation: 'seed observation',
      why_it_matters: 'seed why',
      audience: 'seed audience',
      angle_options: [],
      evidence: [],
      novelty: 50,
      freshness: 50,
      sensitivity: 10,
      confidence: 50,
      rubric_scores: {},
      score: 42,
      occurred_at: '2026-07-01T00:00:00Z',
      status,
      dismiss_reason: status === 'dismissed' ? (spec.reason === undefined ? null : spec.reason) : null,
      created_at: updatedAt,
      updated_at: updatedAt,
    })
    .select('id')
    .single()
  if (kErr) throw kErr
  return card.id as string
}

/** A REAL transition (fires the legality trigger and the updated_at touch), as the Server Actions do. */
export async function transition(admin: any, cardId: string, to: 'approved' | 'dismissed' | 'saved', reason: string | null = null) {
  const patch: Record<string, unknown> = { status: to }
  if (to === 'dismissed') patch.dismiss_reason = reason
  const { error } = await admin.from('insight_cards').update(patch).eq('id', cardId)
  if (error) throw error
}

export async function recompute(admin: any, cardId: string): Promise<{ data: string | null; error: { code?: string; message: string } | null }> {
  const { data, error } = await admin.rpc('recompute_dismissal_audience_signal', { p_card_id: cardId })
  return { data, error }
}

export async function dismissalRows(pg: { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> }, businessId: string): Promise<any[]> {
  const { rows } = await pg.query(
    `SELECT * FROM public.audience_memory WHERE business_id = $1 AND source = 'dismissal' AND deleted_at IS NULL ORDER BY created_at, id`,
    [businessId],
  )
  return rows
}

/**
 * Age cards (or audience rows) by rewriting updated_at. The BEFORE UPDATE touch trigger would reset it to now(), so it is disabled for
 * this one transaction on this one table. Test-only, on a local stack.
 */
export async function ageRows(pg: { query: (sql: string, params?: unknown[]) => Promise<any> }, table: 'insight_cards' | 'audience_memory', trigger: string, ids: string[], ageDays: number) {
  await pg.query('BEGIN')
  try {
    await pg.query(`ALTER TABLE public.${table} DISABLE TRIGGER ${trigger}`)
    await pg.query(`UPDATE public.${table} SET updated_at = now() - ($2 || ' days')::interval WHERE id = ANY ($1::uuid[])`, [ids, String(ageDays)])
    await pg.query(`ALTER TABLE public.${table} ENABLE TRIGGER ${trigger}`)
    await pg.query('COMMIT')
  } catch (e) {
    await pg.query('ROLLBACK')
    throw e
  }
}

export async function destroy(admin: any, pg: { query: (sql: string, params?: unknown[]) => Promise<any> }, bizIds: string[], userIds: string[]) {
  for (const id of bizIds) await pg.query('DELETE FROM public.businesses WHERE id = $1', [id])
  for (let i = 0; i < userIds.length; i += 20) await Promise.all(userIds.slice(i, i + 20).map((id) => admin.auth.admin.deleteUser(id)))
}
