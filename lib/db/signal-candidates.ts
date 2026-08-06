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

// §6.4/§6.5 — Stage B's scorer write. UPSERT on UNIQUE(signal_id), the
// arbiter §3.4 exists for: without it, ON CONFLICT (signal_id) has no
// target and every re-score would insert a duplicate row. Service-role —
// the scorer runs inside the same poller tick as the ingestion write,
// never from an authenticated path. Explicit business_id predicate is
// carried on the row itself (§3.5).
//
// Routed through the upsert_signal_candidate RPC
// (20260806090000_signal_candidates_guarded_upsert.sql), NOT a plain
// `.upsert()`: PostgREST's upsert cannot express a conditional
// `ON CONFLICT ... DO UPDATE ... WHERE` clause, and that WHERE
// (status = 'new') is what makes SIGNAL-DEDUP-STABLE-ON-EDIT's guarantee —
// a re-score can never resurrect a candidate a human has dismissed — true
// rather than merely intended (ADR §6.4). A `null` return is that guard's
// no-op signal (the row exists but is no longer 'new'), not an error; the
// caller must treat it as "nothing written," never retry it as a failure.
export async function upsertSignalCandidate(
  insert: SignalCandidateInsert,
): Promise<SignalCandidateRow | null> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client.rpc('upsert_signal_candidate', {
    p_business_id: insert.business_id,
    p_signal_id: insert.signal_id,
    p_score: insert.score,
    p_score_inputs: insert.score_inputs ?? {},
    p_occurred_at: insert.occurred_at,
  })
  if (error) throw new Error(getErrorMessage(error))
  const rows = (data as SignalCandidateRow[] | null) ?? []
  return rows[0] ?? null
}
