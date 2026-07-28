import type { SupabaseClient } from '@supabase/supabase-js'
import { getErrorMessage } from './utils'
import type { PostEditSignalRow, PostEditSignalStatus, PostEditSignalClass } from './types'

function isPostgresError(e: unknown): e is { code: string; message: string } {
  return (
    typeof e === 'object' && e !== null &&
    'code' in e && typeof (e as { code: unknown }).code === 'string' &&
    'message' in e && typeof (e as { message: unknown }).message === 'string'
  )
}

// [silent-failure-hunter, C2.8 review MAJOR-1] Preserves the raw Postgres
// `.code` on the thrown Error (not just its message) — the orchestrator's
// isPermanentError() (lib/learning/orchestrator.ts) checks `'code' in err`
// to route a 23xxx constraint violation to immediate abandonment instead of
// burning LEARNING_MAX_ATTEMPTS retries on something that can never
// succeed. Losing `.code` here silently defeats that classification.
function dbError(e: unknown): Error {
  const err = new Error(isPostgresError(e) ? e.message : getErrorMessage(e))
  if (isPostgresError(e)) (err as Error & { code?: string }).code = e.code
  return err
}

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
//
// [Session 25-D correction, MAJOR-1] class='preference' is REQUIRED here,
// not optional filtering. Without it, correction- and inconclusive-classed
// human copy (evidence/grounding fixes, not taste) feeds the same summarizer
// whose output can land in a voice-directed dimension ('format'/'hook') —
// exactly the L-6 conflation this track exists to prevent. This is the one
// query-side lever that keeps that copy out; LEARN-VOICE-WRITE-TRIGGER
// cannot see it, because a summarizer row's pattern_key never matches a
// post_edit_signals row (ADR 0018 §5.3 amendment, §6.1 amendment).
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
    .eq('class', 'preference')
    .order('processed_at', { ascending: false })
    .limit(limit)
  if (since !== null) query = query.gt('processed_at', since)
  const { data, error } = await query
  if (error) throw new Error(getErrorMessage(error))
  return ((data as { human_content: string }[]) ?? []).map((row) => row.human_content)
}

// ADR 0018 §9.3 — atomic batch claim, exact shape of claimEmailOutboxBatch
// (lib/db/email-outbox.ts:62-69) → the claim_post_edit_signals RPC
// (FOR UPDATE SKIP LOCKED, pending → processing, supabase/migrations/
// 20260726010000_learning_capture.sql:231-246).
export async function claimPostEditSignals(
  client: SupabaseClient,
  batchSize: number,
): Promise<PostEditSignalRow[]> {
  const { data, error } = await client.rpc('claim_post_edit_signals', { batch_size: batchSize })
  if (error) throw dbError(error)
  return (data ?? []) as PostEditSignalRow[]
}

// ADR 0018 §9.1 — atomic status re-guard, exact shape of
// transitionEmailOutboxRow (lib/db/email-outbox.ts:71-116): SELECT current
// status → check LEGAL_TRANSITIONS → UPDATE guarded by
// .eq('status', currentStatus), so a concurrently-moved row updates zero
// rows (returns null) instead of clobbering a state this call no longer owns.
//
// [Session 25-D correction, MINOR-5, option (i) — PREFERRED per the
// Reviewer] `claim_post_edit_signals` (`20260726010000_learning_capture.sql:
// 231-246`) claims ONLY `status = 'pending'` — unlike its sibling
// `claim_deletion_requests` (`20260615200000_deletion_cron_state_machine.sql:
// 48-51`), it has NO `OR (status='failed' AND attempts < max)` reclaim
// clause. A prior version of this table kept `'failed'` reachable
// (`processing → failed → processing`) "for a future migration that adds
// the reclaim clause" — but a row a future writer parks at `'failed'` under
// THIS schema, as actually applied, is never claimed again and is stranded
// forever. Rather than service that trap, `'failed'` is removed from every
// reachable target here: the orchestrator already retries a transient
// failure by transitioning to `'pending'` (reclaimable under the CURRENT
// claim RPC, exactly like runEmailDrainTick's own sending→pending retry),
// which is the only transient-retry path this schema actually supports.
// `'failed'` remains a legal DB value (the table's CHECK constraint is
// unchanged — no migration needed for an app-layer guard), but no code path
// can transition a row INTO or OUT OF it anymore. ADR §9.4's prose is
// corrected to match in the same commit (ADR 0018 Amendment C).
const LEGAL_TRANSITIONS: Readonly<Record<PostEditSignalStatus, readonly PostEditSignalStatus[]>> = {
  pending:    ['processing'],
  processing: ['processed', 'pending', 'abandoned'],
  processed:  [],
  failed:     [],
  abandoned:  [],
}

export async function transitionPostEditSignal(
  client: SupabaseClient,
  rowId: string,
  next: {
    status: PostEditSignalStatus
    attempts?: number
    next_attempt_at?: string
    last_error?: string | null
    processed_at?: string | null
    class?: PostEditSignalClass | null
    pattern_key?: string | null
    signals?: Record<string, unknown> | null
  },
): Promise<PostEditSignalRow | null> {
  const { data: current, error: fetchError } = await client
    .from('post_edit_signals')
    .select('status')
    .eq('id', rowId)
    .single()

  if (fetchError) throw dbError(fetchError)
  if (!current) return null

  const currentStatus = (current as { status: PostEditSignalStatus }).status
  const allowed = LEGAL_TRANSITIONS[currentStatus]

  if (!allowed.includes(next.status)) {
    throw new Error(`Illegal post_edit_signals transition: ${currentStatus} → ${next.status}`)
  }

  const update: Record<string, unknown> = { status: next.status }
  if (next.attempts !== undefined) update.attempts = next.attempts
  if (next.next_attempt_at !== undefined) update.next_attempt_at = next.next_attempt_at
  if (next.last_error !== undefined) update.last_error = next.last_error
  if (next.processed_at !== undefined) update.processed_at = next.processed_at
  if (next.class !== undefined) update.class = next.class
  if (next.pattern_key !== undefined) update.pattern_key = next.pattern_key
  if (next.signals !== undefined) update.signals = next.signals

  const { data, error } = await client
    .from('post_edit_signals')
    .update(update)
    .eq('id', rowId)
    .eq('status', currentStatus)
    .select()
    .single()

  if (error) throw dbError(error)
  return (data as PostEditSignalRow) ?? null
}
