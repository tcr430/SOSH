import type { SupabaseClient } from '@supabase/supabase-js'
import type { SocialBackfillRunRow, Platform, BackfillRunStatus } from './types'
import { getErrorMessage } from './utils'

// ADR 0025 §9.1/§9.4/§6.3-6.5 (Session 32 I2.5). Every write is a
// SECURITY DEFINER RPC (20260913130000_social_backfill_runs_and_posts.sql)
// — service-role, lazy-imported, no client parameter, matching the
// lib/db/generation-budget.ts precedent. The one exception is
// getBackfillRunsForBusiness, which is member-facing (the onboarding
// progress page) and takes the caller's anon/RLS client instead.

// ADR §6.5 — inserts a queued run ONLY IF the account has no non-discarded
// run AND fewer than 3 runs total (BACKFILL-ONCE-PER-ACCOUNT); atomic, no
// read-then-write. Returns null when refused — not an error, the caller's
// "already has a live run" / "cap reached" signal.
export async function enqueueBackfillRun(
  businessId: string,
  socialAccountId: string,
  platform: Platform,
): Promise<SocialBackfillRunRow | null> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client.rpc('enqueue_backfill_run', {
    p_business_id: businessId,
    p_social_account_id: socialAccountId,
    p_platform: platform,
  })
  if (error) throw new Error(getErrorMessage(error))
  const rows = (data as SocialBackfillRunRow[] | null) ?? []
  return rows[0] ?? null
}

// ADR §6.5 — failed -> queued on the SAME row (never a fresh run, which
// would re-extract everything under a new import_run_id and double the
// memory). Returns null when the row isn't resumable (not 'failed', or
// error_code = 'caller_bug').
export async function resumeBackfillRun(runId: string): Promise<SocialBackfillRunRow | null> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client.rpc('resume_backfill_run', { p_run_id: runId })
  if (error) throw new Error(getErrorMessage(error))
  const rows = (data as SocialBackfillRunRow[] | null) ?? []
  return rows[0] ?? null
}

// ADR §6.4 — retires candidates (added in I2.6) and purges staging in ONE
// transaction. userId is the server-verified session user
// (supabase.auth.getUser() on the anon server client), never a form field;
// null is permitted ONLY for the disconnect/system path (I2.9), which has
// no authenticated session to name a user from. Returns null when the run
// doesn't exist or is already in a terminal state (ratified/discarded).
export async function discardBackfillRun(
  runId: string,
  userId: string | null,
): Promise<SocialBackfillRunRow | null> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client.rpc('discard_backfill_run', {
    p_run_id: runId,
    p_user_id: userId,
  })
  if (error) throw new Error(getErrorMessage(error))
  const rows = (data as SocialBackfillRunRow[] | null) ?? []
  return rows[0] ?? null
}

// ADR §6.1/§6.3 — the SIGNAL3-COST-CEILING-ATOMIC idiom: one conditional
// UPDATE, never read-then-write. Returns null when the reservation would
// cross ceiling_cents — the caller's "stop extracting, mark partial" signal.
export async function reserveBackfillSpend(
  runId: string,
  estimateCents: number,
): Promise<SocialBackfillRunRow | null> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client.rpc('reserve_backfill_spend', {
    p_run_id: runId,
    p_estimate_cents: estimateCents,
  })
  if (error) throw new Error(getErrorMessage(error))
  const rows = (data as SocialBackfillRunRow[] | null) ?? []
  return rows[0] ?? null
}

// Settles a reservation down to its actual cost (mirrors
// lib/db/generation-budget.ts's releaseGenerationPost shape).
export async function reconcileBackfillSpend(
  runId: string,
  reservedCents: number,
  actualCents: number,
): Promise<SocialBackfillRunRow | null> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client.rpc('reconcile_backfill_spend', {
    p_run_id: runId,
    p_reserved_cents: reservedCents,
    p_actual_cents: actualCents,
  })
  if (error) throw new Error(getErrorMessage(error))
  const rows = (data as SocialBackfillRunRow[] | null) ?? []
  return rows[0] ?? null
}

// ADR §9.1 — member-facing, for the onboarding progress page. Uses the
// caller's anon/RLS client (never service-role) — the table's one SELECT
// policy is the actual access boundary here, not this function. Bounded
// with an explicit ORDER BY matching social_backfill_runs_business_id_idx's
// scan pattern (business_id, then recency).
export async function getBackfillRunsForBusiness(
  client: SupabaseClient,
  businessId: string,
  limit = 10,
): Promise<SocialBackfillRunRow[]> {
  const { data, error } = await client
    .from('social_backfill_runs')
    .select('*')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(getErrorMessage(error))
  return (data as SocialBackfillRunRow[]) ?? []
}

// ADR §6.5 (Session 32 I2.8) — the orchestrator's own read of a single run
// by id, service-role (the cron tick has no authenticated session to scope
// an RLS-bound read to). Not a raw table type carrying any write risk — a
// plain SELECT, same shape as getBackfillRunsForBusiness above, just keyed
// by id and unbounded by business_id since service-role already bypasses
// RLS for this whole file.
export async function getBackfillRunById(runId: string): Promise<SocialBackfillRunRow | null> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client
    .from('social_backfill_runs')
    .select('*')
    .eq('id', runId)
    .maybeSingle()
  if (error) throw new Error(getErrorMessage(error))
  return (data as SocialBackfillRunRow | null) ?? null
}

// ADR §2.3 (Session 32 I2.8) — over record_backfill_fetch_progress
// (20260914010000_backfill_fetch_phase_rpcs.sql): an atomic conditional
// UPDATE incrementing both counters in one statement, guarded to
// status='fetching' so a progress write racing a cancellation is a no-op.
export async function recordBackfillFetchProgress(
  runId: string,
  postsFetchedDelta: number,
  platformPostsReadDelta: number,
): Promise<SocialBackfillRunRow | null> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client.rpc('record_backfill_fetch_progress', {
    p_run_id: runId,
    p_posts_fetched_delta: postsFetchedDelta,
    p_platform_posts_read_delta: platformPostsReadDelta,
  })
  if (error) throw new Error(getErrorMessage(error))
  const rows = (data as SocialBackfillRunRow[] | null) ?? []
  return rows[0] ?? null
}

// ADR §2.3/§6.5 (Session 32 I2.8) — over transition_backfill_run
// (20260914010000_backfill_fetch_phase_rpcs.sql), the ONE generic
// conditional-status-UPDATE reused for every fetch-phase edge (queued ->
// fetching, fetching -> extracting/unsupported/failed) and by I2.9/I2.13's
// later transitions. Returns null when the guard did not hold (the run was
// already moved elsewhere by a concurrent discard/disconnect) — the
// caller's "no-op, not an error" signal, same convention as every other
// conditional-UPDATE wrapper in this file.
export async function transitionBackfillRun(
  runId: string,
  fromStatuses: readonly BackfillRunStatus[],
  toStatus: BackfillRunStatus,
  errorCode: string | null = null,
): Promise<SocialBackfillRunRow | null> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client.rpc('transition_backfill_run', {
    p_run_id: runId,
    p_from_statuses: fromStatuses,
    p_to_status: toStatus,
    p_error_code: errorCode,
  })
  if (error) throw new Error(getErrorMessage(error))
  const rows = (data as SocialBackfillRunRow[] | null) ?? []
  return rows[0] ?? null
}

// ADR §4.1 (Session 32 I2.11) — over increment_backfill_passes_done,
// recorded AFTER each pass's own writes (never before).
export async function incrementBackfillPassesDone(runId: string): Promise<SocialBackfillRunRow | null> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client.rpc('increment_backfill_passes_done', { p_run_id: runId })
  if (error) throw new Error(getErrorMessage(error))
  const rows = (data as SocialBackfillRunRow[] | null) ?? []
  return rows[0] ?? null
}

// ADR §6.1 (Session 32 I2.11) — over mark_backfill_run_partial: a budget
// reservation refusal stops extracting; whatever memory was already
// written stays.
export async function markBackfillRunPartial(runId: string, reason: string): Promise<SocialBackfillRunRow | null> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client.rpc('mark_backfill_run_partial', { p_run_id: runId, p_reason: reason })
  if (error) throw new Error(getErrorMessage(error))
  const rows = (data as SocialBackfillRunRow[] | null) ?? []
  return rows[0] ?? null
}

// ADR §4.2 (Session 32 I2.11) — over stage_backfill_voice: writes NOTHING
// to brand_voices/brand_voice_variations, only this run row's own
// staged_voice + voice_status.
export async function stageBackfillVoice(
  runId: string,
  stagedVoice: Record<string, unknown>,
): Promise<SocialBackfillRunRow | null> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client.rpc('stage_backfill_voice', { p_run_id: runId, p_staged_voice: stagedVoice })
  if (error) throw new Error(getErrorMessage(error))
  const rows = (data as SocialBackfillRunRow[] | null) ?? []
  return rows[0] ?? null
}

// ADR §6.5/§6.6 (Session 32 I2.9) — the cron tick's own claim read: ONE run
// needing bounded work, oldest-updated first (matches
// social_backfill_runs_claim_idx's (status, updated_at) shape exactly). A
// concurrent tick racing the same row is not a correctness risk: the actual
// mutation is transitionBackfillRun's conditional UPDATE above, which
// simply no-ops (returns null) for whichever tick loses the race — this
// read never claims exclusivity itself.
export async function getNextBackfillRunForTick(): Promise<SocialBackfillRunRow | null> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client
    .from('social_backfill_runs')
    .select('*')
    .in('status', ['queued', 'fetching', 'extracting'])
    .order('updated_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(getErrorMessage(error))
  return (data as SocialBackfillRunRow | null) ?? null
}

// ADR §6.6 BACKFILL-LATENCY-BOUNDED (Session 32 I2.9) — over
// sweep_stalled_backfill_runs (20260914020000_backfill_cron_sweeps.sql):
// bulk conditional UPDATE, resumable (error_code='stalled', never
// 'caller_bug'). Returns the count of runs failed this sweep.
export async function sweepStalledBackfillRuns(stallMinutes: number): Promise<number> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client.rpc('sweep_stalled_backfill_runs', { p_stall_minutes: stallMinutes })
  if (error) throw new Error(getErrorMessage(error))
  return (data as number | null) ?? 0
}

// ADR §8.3 (Session 32 I2.9) — over sweep_expired_backfill_staging: purges
// social_backfill_posts rows for any run whose completed_at is older than
// ttlDays. Returns the count of staging rows deleted.
export async function sweepExpiredBackfillStaging(ttlDays: number): Promise<number> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client.rpc('sweep_expired_backfill_staging', { p_ttl_days: ttlDays })
  if (error) throw new Error(getErrorMessage(error))
  return (data as number | null) ?? 0
}

// ADR §8.3 (Session 32 I2.9) — over sweep_expired_staged_voice: nulls
// staged_voice for any run ratified more than ttlDays ago whose voice was
// never reviewed. Returns the count of runs nulled.
export async function sweepExpiredStagedVoice(ttlDays: number): Promise<number> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client.rpc('sweep_expired_staged_voice', { p_ttl_days: ttlDays })
  if (error) throw new Error(getErrorMessage(error))
  return (data as number | null) ?? 0
}

// ADR §6.8 BACKFILL-DISCONNECT-CANCELS (Session 32 I2.9) — the disconnect
// path's own read: the account's one LIVE (non-discarded) run, if any —
// mirrors social_backfill_runs_live_account_uq's own predicate exactly, so
// this can never return a run that index would treat as superseded.
export async function getLiveBackfillRunForAccount(socialAccountId: string): Promise<SocialBackfillRunRow | null> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client
    .from('social_backfill_runs')
    .select('*')
    .eq('social_account_id', socialAccountId)
    .neq('status', 'discarded')
    .maybeSingle()
  if (error) throw new Error(getErrorMessage(error))
  return (data as SocialBackfillRunRow | null) ?? null
}

// ADR §6.5 (Session 32 I2.9) — the callback route's reconnect check: a
// resumable failed run (error_code IS DISTINCT FROM 'caller_bug', mirroring
// resume_backfill_run's own guard) on this account, if any.
export async function getResumableFailedRunForAccount(socialAccountId: string): Promise<SocialBackfillRunRow | null> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client
    .from('social_backfill_runs')
    .select('*')
    .eq('social_account_id', socialAccountId)
    .eq('status', 'failed')
    .neq('error_code', 'caller_bug')
    .maybeSingle()
  if (error) throw new Error(getErrorMessage(error))
  return (data as SocialBackfillRunRow | null) ?? null
}

// ADR §4.1 step 2 (Session 32 I2.10) — over record_backfill_run_summary:
// writes the account-statistics summary and the weighting flag, guarded to
// status='extracting'. summary is jsonb-shaped by lib/backfill/stats.ts's
// BackfillStatsSummary — cadence and timing are NOT memory (ADR §4.1),
// this is the run row's own "what we learned" jsonb, never a *_memory row.
export async function recordBackfillRunSummary(
  runId: string,
  summary: Record<string, unknown>,
  weighting: 'weighted' | 'unweighted_no_metrics',
): Promise<SocialBackfillRunRow | null> {
  const { createServiceRoleClient } = await import('@/lib/supabase/service')
  const client = createServiceRoleClient()
  const { data, error } = await client.rpc('record_backfill_run_summary', {
    p_run_id: runId,
    p_summary: summary,
    p_weighting: weighting,
  })
  if (error) throw new Error(getErrorMessage(error))
  const rows = (data as SocialBackfillRunRow[] | null) ?? []
  return rows[0] ?? null
}
