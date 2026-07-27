import type { SupabaseClient } from '@supabase/supabase-js'
import { getErrorMessage } from './utils'

// ADR 0018 §6.2 — the two-gate floor's signal-count gate: "≥
// LEARNING_SUMMARY_MIN_SIGNALS newly-processed signals since its last
// summary." `since = null` means no prior successful summarization exists
// (getLastSuccessfulCallAt returned null) — counts ALL processed signals
// ever, per ADR §6.2's own framing that the interval gate is trivially
// satisfied for a business's first-ever summarization.
export async function countProcessedSignalsSince(
  client: SupabaseClient,
  businessId: string,
  since: string | null,
): Promise<number> {
  let query = client
    .from('post_edit_signals')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId)
    .eq('status', 'processed')
  if (since !== null) query = query.gt('processed_at', since)
  const { count, error } = await query
  if (error) throw new Error(getErrorMessage(error))
  return count ?? 0
}

// ADR 0018 §6.1/§6.3 — the summarizer's "hard-capped excerpts of
// human-edited copy" input. Bounded by `limit` (defense-in-depth on top of
// the prompt-layer token cap), explicit business_id filter (§10.3 — this
// runs under service-role, which bypasses RLS), explicit ORDER BY matching
// no particular index (a background, at-most-weekly read; not a hot path
// worth a dedicated index). Returns RAW, unguarded human_content —
// callers MUST route it through neutralize() at render time
// (LEARN-SUMMARY-DATA-GUARDED); this function is a plain DB read and does
// no sanitization itself, matching lib/db's convention that guarding is the
// prompt layer's job, not the query layer's.
export async function listRecentHumanEditExcerpts(
  client: SupabaseClient,
  businessId: string,
  since: string | null,
  limit: number,
): Promise<string[]> {
  let query = client
    .from('post_edit_signals')
    .select('human_content')
    .eq('business_id', businessId)
    .eq('status', 'processed')
    .order('processed_at', { ascending: false })
    .limit(limit)
  if (since !== null) query = query.gt('processed_at', since)
  const { data, error } = await query
  if (error) throw new Error(getErrorMessage(error))
  return ((data as { human_content: string }[]) ?? []).map((row) => row.human_content)
}
