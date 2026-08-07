import type { SupabaseClient } from '@supabase/supabase-js'
import type { SignalRow, SignalInsert, UntrustedText } from './types'
import { getErrorMessage } from './utils'

// ADR 0020 §10.1 — the ONLY module that touches signals. Every caller (the
// poller, a future signals list surface) goes through here, never through a
// direct `.from('signals')` elsewhere.
//
// §7.4 — every function below returns SignalRow AS DECLARED (title/body
// typed UntrustedText in lib/db/types.ts), so the brand originates at this
// data-access boundary. Supabase returns plain JSON with no runtime brand —
// the cast below is the ONE place a raw DB string becomes UntrustedText on
// the read path, mirroring how the ingestion parser is the ONE place a raw
// GitHub string becomes UntrustedText on the write path (§7.3).

const SIGNALS_LIST_LIMIT = 50

function asSignalRow(row: unknown): SignalRow {
  return row as SignalRow
}

// A future signals list surface — authenticated client, RLS-scoped
// SELECT-only policy. Bounded, ORDER BY business_id, occurred_at DESC, id:
// matches signals_business_id_occurred_at_idx EXACTLY.
export async function listRecentSignalsForBusiness(
  client: SupabaseClient,
  businessId: string,
  limit: number = SIGNALS_LIST_LIMIT,
): Promise<SignalRow[]> {
  const { data, error } = await client
    .from('signals')
    .select('*')
    .eq('business_id', businessId)
    .order('occurred_at', { ascending: false })
    .order('id', { ascending: true })
    .limit(limit)
  if (error) throw new Error(getErrorMessage(error))
  return ((data as unknown[]) ?? []).map(asSignalRow)
}

// §4.4 — the poller's edit-detection read: existing signals for a repo, to
// diff a 200 response's releases against by (external_id, content_hash).
// Service-role, bounded, explicit business_id predicate (§3.5).
//
// [Session 27-D · D3, MINOR-1] signals_watched_repo_id_idx (watched_repo_id)
// serves the FILTER's leading column ONLY — it is single-column and cannot
// serve the occurred_at sort. The trailing `.order('id', {ascending: true})`
// is the tiebreak that makes this bounded window deterministic across rows
// sharing an occurred_at: without it, two releases at the same timestamp
// could be returned in different relative order run to run, which matters
// here because this is a LIMITed read feeding the poller's diff, not an
// unbounded scan.
export async function listSignalsForWatchedRepo(
  watchedRepoId: string,
  businessId: string,
  limit: number = SIGNALS_LIST_LIMIT,
): Promise<SignalRow[]> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client
    .from('signals')
    .select('*')
    .eq('watched_repo_id', watchedRepoId)
    .eq('business_id', businessId)
    .order('occurred_at', { ascending: false })
    .order('id', { ascending: true })
    .limit(limit)
  if (error) throw new Error(getErrorMessage(error))
  return ((data as unknown[]) ?? []).map(asSignalRow)
}

export type InsertSignalResult =
  | { status: 'inserted'; signal: SignalRow }
  | { status: 'duplicate' }

// §4.3 — the poller's INSERT-only ingest path for a signal the app-layer
// diff (E2.7's orchestrator, against listSignalsForWatchedRepo's read)
// believes is genuinely new. Deliberately NOT upsertSignal: an upsert
// silently absorbs a conflicting write by updating it, which would make a
// concurrent duplicate delivery indistinguishable from a real edit. A plain
// INSERT lets the UNIQUE(business_id, source, external_id) index be the
// actual arbiter (§4.3 — "the index and not an application check", since a
// SELECT-then-INSERT is a TOCTOU race): a losing concurrent INSERT hits
// Postgres error code 23505, which the caller counts as `duplicates`, never
// as an error — CLAUDE.md's webhook-handler rule applied to a poller.
export async function insertSignal(insert: SignalInsert): Promise<InsertSignalResult> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client.from('signals').insert(insert).select().single()
  if (error) {
    if (error.code === '23505') return { status: 'duplicate' }
    throw new Error(getErrorMessage(error))
  }
  return { status: 'inserted', signal: asSignalRow(data) }
}

// §4.4/§6.4 — the poller's edit-in-place write: same external_id, a
// different content_hash (detected app-side by the orchestrator BEFORE
// calling this, so a byte-identical retry never reaches here at all — see
// lib/signals/orchestrator.ts's local sha256 replication of the generated
// column). A plain UPDATE by id, not an upsert: the row is known to already
// exist, and E2.1's guard_signals_identity_update trigger permits exactly
// these three columns (plus its own updated_at stamp) to change. Explicit
// business_id predicate (§3.5) even though `id` alone is unique.
export async function updateSignalContent(
  id: string,
  businessId: string,
  update: { title: UntrustedText; body: UntrustedText; body_truncated: boolean },
): Promise<SignalRow> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client
    .from('signals')
    .update(update)
    .eq('id', id)
    .eq('business_id', businessId)
    .select()
    .single()
  if (error) throw new Error(getErrorMessage(error))
  return asSignalRow(data)
}
