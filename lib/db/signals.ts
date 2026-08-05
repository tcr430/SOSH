import type { SupabaseClient } from '@supabase/supabase-js'
import type { SignalRow, SignalInsert } from './types'
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
// Service-role, bounded, matches signals_watched_repo_id_idx (watched_repo_id)
// EXACTLY. Explicit business_id predicate (§3.5).
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
    .limit(limit)
  if (error) throw new Error(getErrorMessage(error))
  return ((data as unknown[]) ?? []).map(asSignalRow)
}

// §4.3/§4.4 — the poller's ingestion write. UPSERT on
// UNIQUE(business_id, source, external_id), the arbiter: a retried QStash
// delivery or an overlapping tick's duplicate insert is absorbed here rather
// than by an app-level SELECT-then-INSERT (a TOCTOU race, §4.3). On
// conflict, only the columns signals.guard_signals_identity_update permits
// (title, body, body_truncated, updated_at) are ever touched by the
// conflict-update clause — business_id/watched_repo_id/external_id/
// created_at are never in it, matching the BEFORE UPDATE trigger's own
// guarantee at the app layer.
export async function upsertSignal(insert: SignalInsert): Promise<SignalRow> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client
    .from('signals')
    .upsert(insert, { onConflict: 'business_id,source,external_id' })
    .select()
    .single()
  if (error) throw new Error(getErrorMessage(error))
  return asSignalRow(data)
}
