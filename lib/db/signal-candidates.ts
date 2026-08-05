import type { SupabaseClient } from '@supabase/supabase-js'
import type { SignalCandidateRow, SignalCandidateWithSignal, SignalCandidateInsert } from './types'
import { getErrorMessage } from './utils'

// ADR 0020 §10.1 — the ONLY module that touches signal_candidates. Every
// caller (Stage B's scorer, Session 28's Stage C reader) goes through here,
// never through a direct `.from('signal_candidates')` elsewhere.

const NEW_CANDIDATES_DEFAULT_LIMIT = 50

// ADR §13.1 — the EXACT signature the Session 28 contract promises. Do not
// rename this later; ADR 0021 builds against this name.
//
// Filter: business_id + status = 'new'. Order: score DESC, occurred_at DESC,
// id ASC — matches signal_candidates_feed_idx (business_id, score DESC,
// occurred_at DESC, id ASC) WHERE status = 'new' EXACTLY, so the partial
// index serves this query. Bound: explicit limit, default 50.
//
// §13.1's own join list also names `tag_name` from `signals` — that column
// does not exist on `signals` today (E2.1's migration was built verbatim
// from ADR §3.3's column list, which never included it; §5.3/§13.1's
// mentions of it are a drift against §3.3, recorded here rather than
// silently reconciled by inventing a migration in this step). This function
// joins only the columns that actually exist — title, body, html_url,
// occurred_at, author_is_bot. A future correction pass (or Session 28
// itself, when it first needs a distinct release-tag label) should add
// `signals.tag_name text` and extend the select below; until then, the
// join is short exactly that one field.
export async function listNewCandidates(
  client: SupabaseClient,
  businessId: string,
  limit: number = NEW_CANDIDATES_DEFAULT_LIMIT,
): Promise<SignalCandidateWithSignal[]> {
  const { data, error } = await client
    .from('signal_candidates')
    .select('*, signals(title, body, html_url, occurred_at, author_is_bot)')
    .eq('business_id', businessId)
    .eq('status', 'new')
    .order('score', { ascending: false })
    .order('occurred_at', { ascending: false })
    .order('id', { ascending: true })
    .limit(limit)
  if (error) throw new Error(getErrorMessage(error))
  // The read boundary that mints UntrustedText out of the joined signals
  // row (see the SignalCandidateWithSignal comment in lib/db/types.ts) —
  // Supabase returns plain JSON with no runtime brand, same as
  // lib/db/signals.ts's asSignalRow.
  return (data as SignalCandidateWithSignal[]) ?? []
}

// §6.4/§6.5 — Stage B's scorer write (built in a later step). UPSERT on
// UNIQUE(signal_id), the arbiter §3.4 exists for: without it, ON CONFLICT
// (signal_id) has no target and every re-score would insert a duplicate row.
// Service-role — the scorer runs inside the same poller tick as the
// ingestion write, never from an authenticated path. Explicit business_id
// predicate is carried on the row itself (§3.5).
//
// NOT guarded here by `WHERE status = 'new'` on the conflict-update clause
// (SIGNAL-DEDUP-STABLE-ON-EDIT's concurrency guard, ADR §6.5/§11.1) —
// Supabase's `.upsert()` cannot express a conditional ON CONFLICT ... WHERE
// clause, and building that guard is Stage B scorer work for the step that
// actually re-scores an edited signal, not this step's DB-layer surface.
export async function upsertSignalCandidate(
  insert: SignalCandidateInsert,
): Promise<SignalCandidateRow> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client
    .from('signal_candidates')
    .upsert(insert, { onConflict: 'signal_id' })
    .select()
    .single()
  if (error) throw new Error(getErrorMessage(error))
  return data as SignalCandidateRow
}
